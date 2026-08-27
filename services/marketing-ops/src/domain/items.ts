import type { PoolClient } from 'pg';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import { writeAudit } from './audit.js';
import type { CommandContext } from './context.js';
import {
  assertItemTransitionAllowed,
  ItemKindSchema,
  ProductionItemInputSchema,
  ProductionItemPatchSchema,
  type ItemChannel,
  type ItemKind,
  type ItemPriority,
  type ItemStatus,
  type ParsedProductionItemInput,
  type ProductionItemInput,
  type ProductionItemPatch
} from './contracts.js';
import { writeDomainEvent } from './events.js';
import { executeIdempotentCommand } from './idempotency.js';

export interface ProductionItem {
  id: string;
  tenantId: string;
  campaignId: string;
  kind: ItemKind;
  title: string;
  assigneeUserId: string | null;
  priority: ItemPriority;
  channel: ItemChannel | null;
  description: string | null;
  startsAt: string | null;
  dueAt: string | null;
  metadata: Record<string, unknown>;
  content: unknown;
  status: ItemStatus;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
}

export type CampaignItem = ProductionItem;

interface ItemRow {
  id: string;
  tenant_id: string;
  campaign_id: string;
  kind: ItemKind;
  title: string;
  assignee_user_id: string | null;
  priority: ItemPriority;
  channel: ItemChannel | null;
  description: string | null;
  starts_at: Date | string | null;
  due_at: Date | string | null;
  metadata: Record<string, unknown>;
  content: unknown;
  status: ItemStatus;
  version: string | number;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
}

interface ItemAuthorityRow extends ItemRow {
  campaign_status: 'draft' | 'planned' | 'active' | 'completed' | 'archived';
  participant_member_role: 'owner' | 'editor' | 'viewer' | null;
  has_content_version: boolean;
  has_incomplete_dependency: boolean;
}

interface CampaignMutationRow {
  id: string;
  status: 'draft' | 'planned' | 'active' | 'completed' | 'archived';
  allowed: boolean;
}

export type CreateProductionItemInput = ProductionItemInput & { idempotencyKey: string };
export type UpdateProductionItemInput = ProductionItemPatch & { idempotencyKey: string };

const EDITORIAL_KINDS = new Set<ItemKind>([
  'email', 'whatsapp', 'post', 'creative', 'review'
]);

const timestamp = (value: Date | string): string => new Date(value).toISOString();
const nullableTimestamp = (value: Date | string | null): string | null =>
  value === null ? null : timestamp(value);

export function mapProductionItem(row: ItemRow): ProductionItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    campaignId: row.campaign_id,
    kind: row.kind,
    title: row.title,
    assigneeUserId: row.assignee_user_id,
    priority: row.priority,
    channel: row.channel,
    description: row.description,
    startsAt: nullableTimestamp(row.starts_at),
    dueAt: nullableTimestamp(row.due_at),
    metadata: row.metadata,
    content: row.content,
    status: row.status,
    version: Number(row.version),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    completedAt: nullableTimestamp(row.completed_at),
    cancelledAt: nullableTimestamp(row.cancelled_at)
  };
}

function validationError(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return appError('validation_error', 400, 'Production item validation failed', {
    issues: issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message
    }))
  });
}

function parseCreateInput(input: CreateProductionItemInput): ParsedProductionItemInput {
  const { idempotencyKey: _idempotencyKey, ...candidate } = input;
  const parsed = ProductionItemInputSchema.safeParse(candidate);
  if (!parsed.success) throw validationError(parsed.error.issues);
  return parsed.data;
}

function parsePatchInput(input: UpdateProductionItemInput): ProductionItemPatch {
  const { idempotencyKey: _idempotencyKey, ...candidate } = input;
  const parsed = ProductionItemPatchSchema.safeParse(candidate);
  if (!parsed.success) throw validationError(parsed.error.issues);
  return parsed.data;
}

function editableFields(item: ProductionItem): ParsedProductionItemInput {
  return {
    kind: item.kind,
    title: item.title,
    assigneeUserId: item.assigneeUserId,
    priority: item.priority,
    channel: item.channel,
    description: item.description,
    startsAt: item.startsAt,
    dueAt: item.dueAt,
    metadata: item.metadata
  };
}

function assertMergedPatch(before: ProductionItem, patch: ProductionItemPatch): void {
  const parsed = ProductionItemInputSchema.safeParse({
    ...editableFields(before),
    ...patch
  });
  if (!parsed.success) throw validationError(parsed.error.issues);
}

function persistenceError(error: unknown): never {
  const databaseError = error as { code?: string; constraint?: string };
  if (
    databaseError.constraint === 'campaign_items_assignee_authorized' ||
    databaseError.constraint === 'campaign_items_assignee_fk'
  ) {
    throw appError(
      'assignee_not_authorized',
      422,
      'Production item assignee must be active and authorized for the campaign'
    );
  }
  throw error;
}

async function visibleCampaignForMutation(
  client: PoolClient,
  campaignId: string
): Promise<CampaignMutationRow> {
  const result = await client.query<CampaignMutationRow>(`
    select
      campaign.id,
      campaign.status::text as status,
      marketing_ops_private.can_edit_campaign(campaign.id) as allowed
    from marketing_ops.campaigns as campaign
    where campaign.id = $1
  `, [campaignId]);
  const campaign = result.rows[0];
  if (!campaign) throw appError('not_found', 404, 'Campaign not found');
  if (campaign.status === 'archived') {
    throw appError('campaign_archived', 409, 'Archived campaign is read-only');
  }
  if (!campaign.allowed) {
    throw appError('forbidden', 403, 'Campaign does not grant item mutation authority');
  }
  return campaign;
}

const ITEM_AUTHORITY_SQL = `
  select
    item.*,
    campaign.status::text as campaign_status,
    participant.member_role::text as participant_member_role,
    exists (
      select 1
      from marketing_ops.content_assets as asset
      join marketing_ops.content_versions as content_version
        on content_version.tenant_id = asset.tenant_id
        and content_version.asset_id = asset.id
      where asset.tenant_id = item.tenant_id
        and asset.item_id = item.id
    ) as has_content_version,
    exists (
      select 1
      from marketing_ops.item_dependencies as dependency
      join marketing_ops.campaign_items as predecessor
        on predecessor.tenant_id = dependency.tenant_id
        and predecessor.campaign_id = dependency.campaign_id
        and predecessor.id = dependency.depends_on_item_id
      where dependency.tenant_id = item.tenant_id
        and dependency.item_id = item.id
        and predecessor.status <> 'completed'
    ) as has_incomplete_dependency
  from marketing_ops.campaign_items as item
  join marketing_ops.campaigns as campaign
    on campaign.tenant_id = item.tenant_id
    and campaign.id = item.campaign_id
  left join marketing_ops.campaign_members as participant
    on participant.tenant_id = item.tenant_id
    and participant.campaign_id = item.campaign_id
    and participant.user_id = auth.uid()
  where item.id = $1
`;

async function loadItemAuthority(
  client: PoolClient,
  itemId: string,
  lockRow: boolean
): Promise<ItemAuthorityRow | null> {
  const result = await client.query<ItemAuthorityRow>(
    lockRow ? `${ITEM_AUTHORITY_SQL} for update of item` : ITEM_AUTHORITY_SQL,
    [itemId]
  );
  return result.rows[0] ?? null;
}

async function visibleItem(client: PoolClient, itemId: string): Promise<ItemAuthorityRow> {
  const row = await loadItemAuthority(client, itemId, false);
  if (!row) throw appError('not_found', 404, 'Production item not found');
  return row;
}

async function lockEditableItem(client: PoolClient, itemId: string): Promise<ItemAuthorityRow> {
  const visible = await visibleItem(client, itemId);
  if (visible.campaign_status === 'archived') {
    throw appError('campaign_archived', 409, 'Archived campaign is read-only');
  }
  if (visible.status === 'completed' || visible.status === 'cancelled') {
    throw appError('item_terminal', 409, 'Terminal production item is read-only');
  }
  const permission = await client.query<{ allowed: boolean }>(
    'select marketing_ops_private.can_edit_campaign_item($1) as allowed',
    [itemId]
  );
  if (permission.rows[0]?.allowed !== true) {
    throw appError('forbidden', 403, 'Campaign does not grant item mutation authority');
  }
  const row = await loadItemAuthority(client, itemId, true);
  if (!row) throw appError('not_found', 404, 'Production item not found');
  return row;
}

function assertExpectedVersion(row: ItemAuthorityRow, expectedVersion: number): void {
  const currentVersion = Number(row.version);
  if (currentVersion !== expectedVersion) {
    throw appError('version_conflict', 409, 'Production item version is stale', {
      currentVersion
    });
  }
}

function assertTransitionAuthority(context: CommandContext, row: ItemAuthorityRow): void {
  authorize(context.actor, 'item.transition');
  if (context.actor.role === 'manager' || context.actor.role === 'admin') return;
  if (
    row.assignee_user_id === context.actor.userId ||
    row.participant_member_role === 'owner'
  ) return;
  throw appError(
    'forbidden',
    403,
    'Member must be the assignee or a campaign owner to transition the item'
  );
}

function assertTransitionReadiness(row: ItemAuthorityRow, to: ItemStatus): void {
  if (to === 'ready') {
    const missingFields: string[] = [];
    if (!row.title.trim()) missingFields.push('title');
    if (!row.assignee_user_id) missingFields.push('assigneeUserId');
    if (!row.due_at) missingFields.push('dueAt');
    if (missingFields.length > 0) {
      throw appError(
        'item_requirements_missing',
        422,
        'Production item is missing required readiness fields',
        { fields: missingFields }
      );
    }
  }
  if (to === 'in_review' && EDITORIAL_KINDS.has(row.kind) && !row.has_content_version) {
    throw appError(
      'item_content_required',
      422,
      'Editorial production item requires a content version before review'
    );
  }
  if (to === 'completed' && row.has_incomplete_dependency) {
    throw appError(
      'item_blocked',
      409,
      'Production item has incomplete dependencies'
    );
  }
}

async function createItemCommand(
  context: CommandContext,
  campaignId: string,
  parsed: ParsedProductionItemInput,
  idempotencyKey: string,
  legacyContent: unknown
): Promise<ProductionItem> {
  try {
    return await withActorTransaction(
      context.pool,
      context.actor,
      context.correlationId,
      async (client) => {
        await visibleCampaignForMutation(client, campaignId);
        return executeIdempotentCommand(
          client,
          context,
          `campaign_item.create:${campaignId}`,
          idempotencyKey,
          { campaignId, ...parsed, legacyContent },
          async () => {
            const result = await client.query<ItemRow>(`
              insert into marketing_ops.campaign_items (
                tenant_id, campaign_id, kind, title, assignee_user_id, priority,
                channel, description, starts_at, due_at, metadata, content,
                created_by, updated_by
              )
              values (
                $1, $2, $3::marketing_ops.item_kind, $4, $5,
                $6::marketing_ops.item_priority, $7::marketing_ops.item_channel,
                $8, $9::timestamptz, $10::timestamptz, $11::jsonb, $12::jsonb,
                $13, $13
              )
              returning *
            `, [
              context.actor.tenantId,
              campaignId,
              parsed.kind,
              parsed.title,
              parsed.assigneeUserId,
              parsed.priority,
              parsed.channel,
              parsed.description,
              parsed.startsAt,
              parsed.dueAt,
              JSON.stringify(parsed.metadata),
              JSON.stringify(legacyContent),
              context.actor.userId
            ]);
            const row = result.rows[0];
            if (!row) throw appError('not_found', 404, 'Campaign not found');
            const created = mapProductionItem(row);
            await context.faultInjector?.('after_entity');
            await writeAudit(
              client,
              context,
              'campaign_item',
              created.id,
              'campaign_item.created',
              null,
              created
            );
            await writeDomainEvent(
              client,
              context,
              'campaign_item',
              created.id,
              'marketing_ops.campaign_item.created.v1',
              created
            );
            return created;
          }
        );
      }
    );
  } catch (error) {
    return persistenceError(error);
  }
}

export async function createProductionItem(
  context: CommandContext,
  campaignId: string,
  input: CreateProductionItemInput
): Promise<ProductionItem> {
  authorize(context.actor, 'item.create');
  const parsed = parseCreateInput(input);
  return createItemCommand(context, campaignId, parsed, input.idempotencyKey, {});
}

export async function getProductionItem(
  context: CommandContext,
  itemId: string
): Promise<ProductionItem> {
  authorize(context.actor, 'item.read');
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => mapProductionItem(await visibleItem(client, itemId))
  );
}

async function updateItemCommand(
  context: CommandContext,
  itemId: string,
  expectedVersion: number,
  patch: ProductionItemPatch,
  idempotencyKey: string,
  legacyContent?: unknown
): Promise<ProductionItem> {
  try {
    return await withActorTransaction(
      context.pool,
      context.actor,
      context.correlationId,
      async (client) => {
        const preflight = await visibleItem(client, itemId);
        if (preflight.campaign_status === 'archived') {
          throw appError('campaign_archived', 409, 'Archived campaign is read-only');
        }
        return executeIdempotentCommand(
          client,
          context,
          `campaign_item.update:${itemId}`,
          idempotencyKey,
          { itemId, expectedVersion, patch, legacyContent },
          async () => {
            const beforeRow = await lockEditableItem(client, itemId);
            assertExpectedVersion(beforeRow, expectedVersion);
            const before = mapProductionItem(beforeRow);
            assertMergedPatch(before, patch);
            const persistedPatch = JSON.stringify(patch);
            const result = await client.query<ItemRow>(`
              with patch_payload as (select $2::jsonb as payload)
              update marketing_ops.campaign_items as item
              set
                kind = case when patch_payload.payload ? 'kind'
                  then (patch_payload.payload ->> 'kind')::marketing_ops.item_kind
                  else item.kind end,
                title = case when patch_payload.payload ? 'title'
                  then patch_payload.payload ->> 'title' else item.title end,
                assignee_user_id = case when patch_payload.payload ? 'assigneeUserId'
                  then (patch_payload.payload ->> 'assigneeUserId')::uuid
                  else item.assignee_user_id end,
                priority = case when patch_payload.payload ? 'priority'
                  then (patch_payload.payload ->> 'priority')::marketing_ops.item_priority
                  else item.priority end,
                channel = case when patch_payload.payload ? 'channel'
                  then (patch_payload.payload ->> 'channel')::marketing_ops.item_channel
                  else item.channel end,
                description = case when patch_payload.payload ? 'description'
                  then patch_payload.payload ->> 'description' else item.description end,
                starts_at = case when patch_payload.payload ? 'startsAt'
                  then (patch_payload.payload ->> 'startsAt')::timestamptz else item.starts_at end,
                due_at = case when patch_payload.payload ? 'dueAt'
                  then (patch_payload.payload ->> 'dueAt')::timestamptz else item.due_at end,
                metadata = case when patch_payload.payload ? 'metadata'
                  then patch_payload.payload -> 'metadata' else item.metadata end,
                content = case when $5::boolean then $6::jsonb else item.content end,
                version = item.version + 1,
                updated_by = $3
              from patch_payload
              where item.id = $1 and item.version = $4
              returning item.*
            `, [
              itemId,
              persistedPatch,
              context.actor.userId,
              expectedVersion,
              legacyContent !== undefined,
              JSON.stringify(legacyContent ?? null)
            ]);
            const row = result.rows[0];
            if (!row) {
              throw appError('version_conflict', 409, 'Production item version is stale', {
                currentVersion: before.version
              });
            }
            const updated = mapProductionItem(row);
            await context.faultInjector?.('after_entity');
            await writeAudit(
              client,
              context,
              'campaign_item',
              itemId,
              'campaign_item.updated',
              before,
              updated
            );
            await writeDomainEvent(
              client,
              context,
              'campaign_item',
              itemId,
              'marketing_ops.campaign_item.updated.v1',
              {
                itemId,
                version: updated.version,
                changedFields: Object.keys(patch).sort()
              }
            );
            return updated;
          }
        );
      }
    );
  } catch (error) {
    return persistenceError(error);
  }
}

export async function updateProductionItem(
  context: CommandContext,
  itemId: string,
  expectedVersion: number,
  input: UpdateProductionItemInput
): Promise<ProductionItem> {
  authorize(context.actor, 'item.update');
  const patch = parsePatchInput(input);
  return updateItemCommand(
    context,
    itemId,
    expectedVersion,
    patch,
    input.idempotencyKey
  );
}

export async function transitionProductionItem(
  context: CommandContext,
  itemId: string,
  expectedVersion: number,
  to: ItemStatus,
  idempotencyKey: string
): Promise<ProductionItem> {
  authorize(context.actor, 'item.transition');
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      const preflight = await visibleItem(client, itemId);
      assertTransitionAuthority(context, preflight);
      return executeIdempotentCommand(
        client,
        context,
        `campaign_item.transition:${itemId}`,
        idempotencyKey,
        { itemId, expectedVersion, to },
        async () => {
          assertItemTransitionAllowed(preflight.status, to);
          const beforeRow = await lockEditableItem(client, itemId);
          assertExpectedVersion(beforeRow, expectedVersion);
          assertTransitionAuthority(context, beforeRow);
          assertItemTransitionAllowed(beforeRow.status, to);
          assertTransitionReadiness(beforeRow, to);
          const before = mapProductionItem(beforeRow);
          const result = await client.query<ItemRow>(`
            update marketing_ops.campaign_items
            set
              status = $2::marketing_ops.item_status,
              completed_at = case when $2::text = 'completed' then now() else null end,
              cancelled_at = case when $2::text = 'cancelled' then now() else null end,
              version = version + 1,
              updated_by = $3
            where id = $1 and version = $4
            returning *
          `, [itemId, to, context.actor.userId, expectedVersion]);
          const row = result.rows[0];
          if (!row) {
            throw appError('version_conflict', 409, 'Production item version is stale', {
              currentVersion: before.version
            });
          }
          const updated = mapProductionItem(row);
          const action = to === 'cancelled'
            ? 'campaign_item.cancelled'
            : 'campaign_item.status_changed';
          const eventType = to === 'cancelled'
            ? 'marketing_ops.campaign_item.cancelled.v1'
            : 'marketing_ops.campaign_item.status_changed.v1';
          await writeAudit(client, context, 'campaign_item', itemId, action, before, updated);
          await writeDomainEvent(client, context, 'campaign_item', itemId, eventType, {
            itemId,
            from: before.status,
            to,
            version: updated.version
          });
          return updated;
        }
      );
    }
  );
}

export async function cancelProductionItem(
  context: CommandContext,
  itemId: string,
  expectedVersion: number,
  idempotencyKey: string
): Promise<ProductionItem> {
  authorize(context.actor, 'item.cancel');
  return transitionProductionItem(
    context,
    itemId,
    expectedVersion,
    'cancelled',
    idempotencyKey
  );
}

export async function createCampaignItemDraft(
  context: CommandContext,
  campaignId: string,
  input: { kind: string; title?: string; content: unknown; idempotencyKey: string }
): Promise<CampaignItem> {
  authorize(context.actor, 'item.create');
  const kind = ItemKindSchema.safeParse(input.kind.trim());
  if (!kind.success) {
    throw appError('validation_error', 400, 'Legacy campaign item kind is invalid');
  }
  const parsed = parseCreateInput({
    kind: kind.data,
    title: input.title?.trim() || kind.data,
    idempotencyKey: input.idempotencyKey
  });
  return createItemCommand(
    context,
    campaignId,
    parsed,
    input.idempotencyKey,
    input.content
  );
}

export async function updateCampaignItemDraft(
  context: CommandContext,
  campaignId: string,
  itemId: string,
  expectedVersion: number,
  input: { title?: string; content: unknown; idempotencyKey: string }
): Promise<CampaignItem> {
  authorize(context.actor, 'item.update');
  const item = await getProductionItem(context, itemId);
  if (item.campaignId !== campaignId) {
    throw appError('not_found', 404, 'Production item not found');
  }
  const patch = ProductionItemPatchSchema.parse({
    title: input.title ?? item.title
  });
  return updateItemCommand(
    context,
    itemId,
    expectedVersion,
    patch,
    input.idempotencyKey,
    input.content
  );
}
