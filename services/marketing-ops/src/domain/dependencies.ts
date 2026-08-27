import type { PoolClient } from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import { writeAudit } from './audit.js';
import type { CommandContext } from './context.js';
import type { ItemStatus } from './contracts.js';
import { writeDomainEvent } from './events.js';
import { executeIdempotentCommand } from './idempotency.js';

export interface ItemDependency {
  itemId: string;
  dependsOnItemId: string;
  predecessorTitle: string;
  predecessorStatus: ItemStatus;
  createdBy: string;
  createdAt: string;
  isBlocking: boolean;
}

export interface AddedItemDependency extends ItemDependency {
  itemVersion: number;
}

export interface RemovedItemDependency {
  itemId: string;
  dependsOnItemId: string;
  itemVersion: number;
  removed: true;
}

interface PairRow {
  id: string;
  campaign_id: string;
  status: ItemStatus;
  version: string | number;
  title: string;
  campaign_status: 'draft' | 'planned' | 'active' | 'completed' | 'archived';
  allowed: boolean;
}

interface DependencyRow {
  item_id: string;
  depends_on_item_id: string;
  predecessor_title: string;
  predecessor_status: ItemStatus;
  created_by: string;
  created_at: Date | string;
}

const uuid = z.string().uuid();

function validateIdentifiers(itemId: string, dependsOnItemId?: string): void {
  if (!uuid.safeParse(itemId).success || (
    dependsOnItemId !== undefined && !uuid.safeParse(dependsOnItemId).success
  )) {
    throw appError('validation_error', 400, 'Dependency identifiers must be UUIDs');
  }
}

function mapDependency(row: DependencyRow): ItemDependency {
  return {
    itemId: row.item_id,
    dependsOnItemId: row.depends_on_item_id,
    predecessorTitle: row.predecessor_title,
    predecessorStatus: row.predecessor_status,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    isBlocking: row.predecessor_status !== 'completed'
  };
}

async function loadPair(
  client: PoolClient,
  itemId: string,
  dependsOnItemId: string,
  operation: 'add' | 'remove'
): Promise<{ dependent: PairRow; predecessor: PairRow }> {
  const result = await client.query<PairRow>(`
    select
      item.id,
      item.campaign_id,
      item.status::text as status,
      item.version,
      item.title,
      campaign.status::text as campaign_status,
      marketing_ops_private.can_edit_campaign_item(item.id) as allowed
    from marketing_ops.campaign_items as item
    join marketing_ops.campaigns as campaign
      on campaign.tenant_id = item.tenant_id
      and campaign.id = item.campaign_id
    where item.id = any($1::uuid[])
  `, [[itemId, dependsOnItemId]]);
  const dependent = result.rows.find((row) => row.id === itemId);
  const predecessor = result.rows.find((row) => row.id === dependsOnItemId);
  if (!dependent || !predecessor) {
    throw appError('not_found', 404, 'Production item not found');
  }
  if (dependent.campaign_id !== predecessor.campaign_id) {
    throw appError(
      'dependency_campaign_mismatch',
      422,
      'Dependencies must stay in the same campaign'
    );
  }
  if (dependent.campaign_status === 'archived') {
    throw appError('campaign_archived', 409, 'Archived campaign is read-only');
  }
  if (!dependent.allowed || !predecessor.allowed) {
    throw appError('forbidden', 403, 'Campaign does not grant dependency authority');
  }
  if (dependent.status === 'completed' || dependent.status === 'cancelled') {
    throw appError('item_terminal', 409, 'Terminal production item is read-only');
  }
  if (
    operation === 'add' &&
    (predecessor.status === 'completed' || predecessor.status === 'cancelled')
  ) {
    throw appError(
      'dependency_terminal',
      409,
      'A new dependency requires a nonterminal predecessor'
    );
  }
  return { dependent, predecessor };
}

async function bumpItemVersion(
  client: PoolClient,
  context: CommandContext,
  itemId: string,
  expectedVersion: number
): Promise<number> {
  const updated = await client.query<{ version: string | number }>(`
    update marketing_ops.campaign_items
    set
      version = version + 1,
      updated_by = $2
    where id = $1
      and version = $3
      and status not in ('completed', 'cancelled')
    returning version
  `, [itemId, context.actor.userId, expectedVersion]);
  if (updated.rows[0]) return Number(updated.rows[0].version);

  const current = await client.query<{ version: string | number; status: ItemStatus }>(
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

function mapPersistenceError(error: unknown): never {
  const databaseError = error as {
    code?: string;
    constraint?: string;
    message?: string;
  };
  switch (databaseError.constraint) {
    case 'item_dependencies_pkey':
      throw appError('dependency_exists', 409, 'Dependency already exists');
    case 'item_dependencies_not_self':
      throw appError('dependency_self', 422, 'An item cannot depend on itself');
    case 'item_dependencies_same_campaign':
    case 'item_dependencies_item_fk':
    case 'item_dependencies_predecessor_fk':
      throw appError(
        'dependency_campaign_mismatch',
        422,
        'Dependencies must stay in the same tenant and campaign'
      );
    case 'item_dependencies_active_items':
      throw appError(
        'dependency_terminal',
        409,
        'Dependencies require nonterminal items'
      );
    case 'item_dependencies_acyclic':
      throw appError('dependency_cycle', 409, 'Dependency edge would create a cycle');
    default:
      throw error;
  }
}

export async function addItemDependency(
  context: CommandContext,
  itemId: string,
  dependsOnItemId: string,
  expectedVersion: number,
  idempotencyKey: string
): Promise<AddedItemDependency> {
  authorize(context.actor, 'dependency.manage');
  validateIdentifiers(itemId, dependsOnItemId);
  if (itemId === dependsOnItemId) {
    throw appError('dependency_self', 422, 'An item cannot depend on itself');
  }
  try {
    return await withActorTransaction(
      context.pool,
      context.actor,
      context.correlationId,
      async (client) => {
        await loadPair(client, itemId, dependsOnItemId, 'add');
        return executeIdempotentCommand(
          client,
          context,
          `item_dependency.add:${itemId}`,
          idempotencyKey,
          { itemId, dependsOnItemId, expectedVersion },
          async () => {
            const inserted = await client.query<{ item_id: string }>(`
              insert into marketing_ops.item_dependencies (
                tenant_id, campaign_id, item_id, depends_on_item_id, created_by
              )
              select tenant_id, campaign_id, id, $2, $3
              from marketing_ops.campaign_items
              where id = $1
              returning item_id
            `, [itemId, dependsOnItemId, context.actor.userId]);
            if (!inserted.rows[0]) {
              throw appError('not_found', 404, 'Production item not found');
            }
            const itemVersion = await bumpItemVersion(
              client,
              context,
              itemId,
              expectedVersion
            );
            const dependencyResult = await client.query<DependencyRow>(`
              select
                dependency.item_id,
                dependency.depends_on_item_id,
                predecessor.title as predecessor_title,
                predecessor.status::text as predecessor_status,
                dependency.created_by,
                dependency.created_at
              from marketing_ops.item_dependencies as dependency
              join marketing_ops.campaign_items as predecessor
                on predecessor.tenant_id = dependency.tenant_id
                and predecessor.campaign_id = dependency.campaign_id
                and predecessor.id = dependency.depends_on_item_id
              where dependency.item_id = $1
                and dependency.depends_on_item_id = $2
            `, [itemId, dependsOnItemId]);
            const dependency = mapDependency(dependencyResult.rows[0]!);
            const added = { ...dependency, itemVersion };
            await writeAudit(
              client,
              context,
              'campaign_item',
              itemId,
              'item_dependency.added',
              null,
              added
            );
            await writeDomainEvent(
              client,
              context,
              'campaign_item',
              itemId,
              'marketing_ops.item_dependency.added.v1',
              {
                itemId,
                dependsOnItemId,
                itemVersion
              }
            );
            return added;
          }
        );
      }
    );
  } catch (error) {
    return mapPersistenceError(error);
  }
}

export async function listItemDependencies(
  context: CommandContext,
  itemId: string
): Promise<ItemDependency[]> {
  authorize(context.actor, 'dependency.read');
  validateIdentifiers(itemId);
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      const visible = await client.query(
        'select id from marketing_ops.campaign_items where id = $1',
        [itemId]
      );
      if (!visible.rows[0]) throw appError('not_found', 404, 'Production item not found');
      const result = await client.query<DependencyRow>(`
        select
          dependency.item_id,
          dependency.depends_on_item_id,
          predecessor.title as predecessor_title,
          predecessor.status::text as predecessor_status,
          dependency.created_by,
          dependency.created_at
        from marketing_ops.item_dependencies as dependency
        join marketing_ops.campaign_items as predecessor
          on predecessor.tenant_id = dependency.tenant_id
          and predecessor.campaign_id = dependency.campaign_id
          and predecessor.id = dependency.depends_on_item_id
        where dependency.item_id = $1
        order by dependency.created_at, dependency.depends_on_item_id
      `, [itemId]);
      return result.rows.map(mapDependency);
    }
  );
}

export async function removeItemDependency(
  context: CommandContext,
  itemId: string,
  dependsOnItemId: string,
  expectedVersion: number,
  idempotencyKey: string
): Promise<RemovedItemDependency> {
  authorize(context.actor, 'dependency.manage');
  validateIdentifiers(itemId, dependsOnItemId);
  try {
    return await withActorTransaction(
      context.pool,
      context.actor,
      context.correlationId,
      async (client) => {
        await loadPair(client, itemId, dependsOnItemId, 'remove');
        return executeIdempotentCommand(
          client,
          context,
          `item_dependency.remove:${itemId}`,
          idempotencyKey,
          { itemId, dependsOnItemId, expectedVersion },
          async () => {
            const deleted = await client.query<{
              item_id: string;
              depends_on_item_id: string;
            }>(`
              delete from marketing_ops.item_dependencies
              where item_id = $1 and depends_on_item_id = $2
              returning item_id, depends_on_item_id
            `, [itemId, dependsOnItemId]);
            if (!deleted.rows[0]) {
              throw appError('dependency_not_found', 404, 'Dependency not found');
            }
            const itemVersion = await bumpItemVersion(
              client,
              context,
              itemId,
              expectedVersion
            );
            const removed: RemovedItemDependency = {
              itemId,
              dependsOnItemId,
              itemVersion,
              removed: true
            };
            await writeAudit(
              client,
              context,
              'campaign_item',
              itemId,
              'item_dependency.removed',
              { itemId, dependsOnItemId },
              null
            );
            await writeDomainEvent(
              client,
              context,
              'campaign_item',
              itemId,
              'marketing_ops.item_dependency.removed.v1',
              removed
            );
            return removed;
          }
        );
      }
    );
  } catch (error) {
    return mapPersistenceError(error);
  }
}
