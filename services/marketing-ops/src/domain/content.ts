import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import { writeAudit } from './audit.js';
import type { CommandContext } from './context.js';
import { writeDomainEvent } from './events.js';
import { executeIdempotentCommand } from './idempotency.js';

const MAX_CONTENT_BODY_BYTES = 1_048_576;
const MAX_CONTENT_METADATA_BYTES = 16_384;

const ContentAssetInputSchema = z.object({
  assetKind: z.string().trim().min(1).max(64)
    .regex(/^[a-z][a-z0-9_-]*$/),
  title: z.string().trim().min(1).max(200)
}).strict();

const ContentVersionInputSchema = z.object({
  body: z.string().max(MAX_CONTENT_BODY_BYTES).nullable(),
  metadata: z.record(z.unknown()),
  freeze: z.boolean()
}).strict().superRefine((input, context) => {
  let encoded: string;
  try {
    encoded = JSON.stringify(input.metadata);
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['metadata'],
      message: 'Content metadata must be JSON serializable'
    });
    return;
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_CONTENT_METADATA_BYTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['metadata'],
      message: 'Content metadata cannot exceed 16384 bytes'
    });
  }
  if (input.body !== null &&
      Buffer.byteLength(input.body, 'utf8') > MAX_CONTENT_BODY_BYTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['body'],
      message: 'Content body cannot exceed 1048576 bytes'
    });
  }
});

export interface ContentAsset {
  id: string;
  itemId: string;
  campaignId: string;
  assetKind: string;
  title: string;
  currentVersionNumber: number;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedContentAsset extends ContentAsset {
  itemVersion: number;
}

export interface ContentVersion {
  assetId: string;
  versionNumber: number;
  body: string | null;
  metadata: Record<string, unknown>;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  frozenAt: string | null;
}

export interface CreatedContentVersion extends ContentVersion {
  assetVersion: number;
  itemId: string;
}

export interface CreateContentAssetInput {
  assetKind: string;
  title: string;
  idempotencyKey: string;
}

export interface CreateContentVersionInput {
  body: string | null;
  metadata: Record<string, unknown>;
  freeze: boolean;
  idempotencyKey: string;
}

interface ItemAuthorityRow {
  id: string;
  campaign_id: string;
  status: 'draft' | 'ready' | 'in_review' | 'completed' | 'cancelled';
  version: string | number;
  campaign_status: 'draft' | 'planned' | 'active' | 'completed' | 'archived';
  allowed: boolean;
}

interface AssetRow {
  id: string;
  campaign_id: string;
  item_id: string;
  asset_kind: string;
  title: string;
  current_version_number: number;
  version: string | number;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface VersionRow {
  asset_id: string;
  version_number: number;
  body: string | null;
  metadata: Record<string, unknown>;
  content_hash: string;
  created_by: string;
  created_at: Date | string;
  frozen_at: Date | string | null;
  asset_version?: string | number;
}

function validationError(error: z.ZodError): never {
  throw appError('validation_error', 400, 'Content validation failed', {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message
    }))
  });
}

function mapAsset(row: AssetRow): ContentAsset {
  return {
    id: row.id,
    itemId: row.item_id,
    campaignId: row.campaign_id,
    assetKind: row.asset_kind,
    title: row.title,
    currentVersionNumber: Number(row.current_version_number),
    version: Number(row.version),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function getContentAsset(
  context: CommandContext,
  assetId: string
): Promise<ContentAsset> {
  authorize(context.actor, 'content.read');
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => mapAsset(await visibleAsset(client, assetId))
  );
}

function mapVersion(row: VersionRow): ContentVersion {
  return {
    assetId: row.asset_id,
    versionNumber: Number(row.version_number),
    body: row.body,
    metadata: row.metadata,
    contentHash: row.content_hash,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    frozenAt: row.frozen_at === null ? null : new Date(row.frozen_at).toISOString()
  };
}

async function loadItemAuthority(
  client: PoolClient,
  itemId: string,
  mutation: boolean
): Promise<ItemAuthorityRow> {
  const result = await client.query<ItemAuthorityRow>(`
    select
      item.id,
      item.campaign_id,
      item.status::text as status,
      item.version,
      campaign.status::text as campaign_status,
      ${mutation
    ? 'marketing_ops_private.can_edit_campaign_item(item.id)'
    : 'true'} as allowed
    from marketing_ops.campaign_items as item
    join marketing_ops.campaigns as campaign
      on campaign.tenant_id = item.tenant_id
      and campaign.id = item.campaign_id
    where item.id = $1
  `, [itemId]);
  const row = result.rows[0];
  if (!row) throw appError('not_found', 404, 'Production item not found');
  if (!mutation) return row;
  if (row.campaign_status === 'archived') {
    throw appError('campaign_archived', 409, 'Archived campaign is read-only');
  }
  if (row.status === 'completed' || row.status === 'cancelled') {
    throw appError('item_terminal', 409, 'Terminal production item is read-only');
  }
  if (!row.allowed) {
    throw appError('forbidden', 403, 'Campaign does not grant content authority');
  }
  return row;
}

async function bumpItemVersion(
  client: PoolClient,
  context: CommandContext,
  itemId: string,
  expectedVersion: number
): Promise<number> {
  const updated = await client.query<{ version: string | number }>(`
    update marketing_ops.campaign_items
    set version = version + 1, updated_by = $2
    where id = $1
      and version = $3
      and status not in ('completed', 'cancelled')
    returning version
  `, [itemId, context.actor.userId, expectedVersion]);
  if (updated.rows[0]) return Number(updated.rows[0].version);
  const current = await client.query<{ version: string | number; status: string }>(
    'select version, status::text as status from marketing_ops.campaign_items where id = $1',
    [itemId]
  );
  const row = current.rows[0];
  if (!row) throw appError('not_found', 404, 'Production item not found');
  if (row.status === 'completed' || row.status === 'cancelled') {
    throw appError('item_terminal', 409, 'Terminal production item is read-only');
  }
  throw appError('version_conflict', 409, 'Production item version is stale', {
    currentVersion: Number(row.version)
  });
}

async function visibleAsset(
  client: PoolClient,
  assetId: string
): Promise<AssetRow & { item_status: string; allowed: boolean }> {
  const result = await client.query<AssetRow & {
    item_status: string;
    allowed: boolean;
  }>(`
    select
      asset.*,
      item.status::text as item_status,
      marketing_ops_private.can_edit_content_asset(asset.id) as allowed
    from marketing_ops.content_assets as asset
    join marketing_ops.campaign_items as item
      on item.tenant_id = asset.tenant_id
      and item.campaign_id = asset.campaign_id
      and item.id = asset.item_id
    where asset.id = $1
  `, [assetId]);
  const row = result.rows[0];
  if (!row) throw appError('not_found', 404, 'Content asset not found');
  if (row.item_status === 'completed' || row.item_status === 'cancelled') {
    throw appError('item_terminal', 409, 'Terminal production item content is read-only');
  }
  if (!row.allowed) {
    throw appError('forbidden', 403, 'Campaign does not grant content authority');
  }
  return row;
}

function mapPersistenceError(error: unknown): never {
  const databaseError = error as { constraint?: string };
  if (databaseError.constraint === 'content_versions_nonterminal_item') {
    throw appError('item_terminal', 409, 'Terminal production item content is read-only');
  }
  if (databaseError.constraint === 'content_versions_hash_match') {
    throw appError('content_hash_mismatch', 409, 'Content hash does not match the body');
  }
  throw error;
}

export async function createContentAsset(
  context: CommandContext,
  itemId: string,
  expectedItemVersion: number,
  input: CreateContentAssetInput
): Promise<CreatedContentAsset> {
  authorize(context.actor, 'content.manage');
  const parsed = ContentAssetInputSchema.safeParse({
    assetKind: input.assetKind,
    title: input.title
  });
  if (!parsed.success) return validationError(parsed.error);

  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      const item = await loadItemAuthority(client, itemId, true);
      return executeIdempotentCommand(
        client,
        context,
        `content_asset.create:${itemId}`,
        input.idempotencyKey,
        { itemId, expectedItemVersion, ...parsed.data },
        async () => {
          const inserted = await client.query<AssetRow>(`
            insert into marketing_ops.content_assets (
              tenant_id,
              campaign_id,
              item_id,
              asset_kind,
              title,
              created_by,
              updated_by
            ) values ($1, $2, $3, $4, $5, $6, $6)
            returning *
          `, [
            context.actor.tenantId,
            item.campaign_id,
            itemId,
            parsed.data.assetKind,
            parsed.data.title,
            context.actor.userId
          ]);
          const row = inserted.rows[0];
          if (!row) throw appError('forbidden', 403, 'Content asset creation was rejected');
          const itemVersion = await bumpItemVersion(
            client,
            context,
            itemId,
            expectedItemVersion
          );
          const created = { ...mapAsset(row), itemVersion };
          await writeAudit(
            client,
            context,
            'campaign_item',
            itemId,
            'content_asset.created',
            null,
            created
          );
          await writeDomainEvent(
            client,
            context,
            'campaign_item',
            itemId,
            'marketing_ops.content_asset.created.v1',
            {
              itemId,
              assetId: created.id,
              assetKind: created.assetKind,
              itemVersion
            }
          );
          return created;
        }
      );
    }
  );
}

export async function listContentAssets(
  context: CommandContext,
  itemId: string
): Promise<ContentAsset[]> {
  authorize(context.actor, 'content.read');
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      await loadItemAuthority(client, itemId, false);
      const result = await client.query<AssetRow>(`
        select *
        from marketing_ops.content_assets
        where item_id = $1
        order by updated_at desc, id
      `, [itemId]);
      return result.rows.map(mapAsset);
    }
  );
}

export async function createContentVersion(
  context: CommandContext,
  assetId: string,
  expectedAssetVersion: number,
  input: CreateContentVersionInput
): Promise<CreatedContentVersion> {
  authorize(context.actor, 'content.manage');
  const parsed = ContentVersionInputSchema.safeParse({
    body: input.body,
    metadata: input.metadata,
    freeze: input.freeze
  });
  if (!parsed.success) return validationError(parsed.error);
  const contentHash = createHash('sha256')
    .update(parsed.data.body ?? '')
    .digest('hex');

  try {
    return await withActorTransaction(
      context.pool,
      context.actor,
      context.correlationId,
      async (client) => {
        const asset = await visibleAsset(client, assetId);
        return executeIdempotentCommand(
          client,
          context,
          `content_version.create:${assetId}`,
          input.idempotencyKey,
          {
            assetId,
            expectedAssetVersion,
            bodyHash: contentHash,
            metadata: parsed.data.metadata,
            freeze: parsed.data.freeze
          },
          async () => {
            const result = await client.query<VersionRow>(`
              select *
              from marketing_ops_private.create_content_version(
                $1::uuid,
                $2::bigint,
                $3::text,
                $4::jsonb,
                $5::text,
                $6::boolean
              )
            `, [
              assetId,
              expectedAssetVersion,
              parsed.data.body,
              JSON.stringify(parsed.data.metadata),
              contentHash,
              parsed.data.freeze
            ]);
            const row = result.rows[0];
            if (!row) {
              const current = await client.query<{ version: string | number }>(
                'select version from marketing_ops.content_assets where id = $1',
                [assetId]
              );
              if (!current.rows[0]) {
                throw appError('not_found', 404, 'Content asset not found');
              }
              throw appError('version_conflict', 409, 'Content asset version is stale', {
                currentVersion: Number(current.rows[0].version)
              });
            }
            const created: CreatedContentVersion = {
              ...mapVersion(row),
              assetVersion: Number(row.asset_version),
              itemId: asset.item_id
            };
            await writeAudit(
              client,
              context,
              'campaign_item',
              asset.item_id,
              'content_version.created',
              null,
              {
                assetId,
                versionNumber: created.versionNumber,
                assetVersion: created.assetVersion,
                contentHash,
                frozenAt: created.frozenAt,
                body: parsed.data.body,
                metadata: parsed.data.metadata
              }
            );
            await writeDomainEvent(
              client,
              context,
              'campaign_item',
              asset.item_id,
              'marketing_ops.content_version.created.v1',
              {
                itemId: asset.item_id,
                assetId,
                versionNumber: created.versionNumber,
                assetVersion: created.assetVersion,
                contentHash,
                frozen: created.frozenAt !== null
              }
            );
            return created;
          }
        );
      }
    );
  } catch (error) {
    return mapPersistenceError(error);
  }
}

export async function listContentVersions(
  context: CommandContext,
  assetId: string
): Promise<ContentVersion[]> {
  authorize(context.actor, 'content.read');
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      const asset = await client.query('select id from marketing_ops.content_assets where id = $1', [
        assetId
      ]);
      if (!asset.rows[0]) throw appError('not_found', 404, 'Content asset not found');
      const result = await client.query<VersionRow>(`
        select *
        from marketing_ops.content_versions
        where asset_id = $1
        order by version_number desc
      `, [assetId]);
      return result.rows.map(mapVersion);
    }
  );
}
