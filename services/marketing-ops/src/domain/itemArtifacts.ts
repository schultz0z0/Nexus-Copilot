import type { PoolClient } from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import type {
  ArtifactAccessLink,
  ArtifactClient,
  ArtifactMetadata
} from '../integrations/artifactClient.js';
import { writeAudit } from './audit.js';
import type { CommandContext } from './context.js';
import { writeDomainEvent } from './events.js';
import { executeIdempotentCommand } from './idempotency.js';
import {
  validateArtifactMetadata,
  validateMaterialFile,
  type MaterialFileInput
} from './materials.js';

export interface ItemArtifact {
  id: string;
  itemId: string;
  campaignId: string;
  assetId: string | null;
  artifactId: string;
  artifactOwnerId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdBy: string;
  createdAt: string;
}

export interface ItemArtifactMutation {
  artifact: ItemArtifact;
  itemVersion: number;
}

export interface ItemArtifactRemoval {
  artifactLinkId: string;
  itemVersion: number;
}

export interface ItemArtifactUploadInput extends MaterialFileInput {
  assetId?: string;
}

export interface LinkExistingItemArtifactInput {
  artifactId: string;
  assetId?: string;
}

export interface ItemArtifactCommandContext extends CommandContext {
  artifacts: ArtifactClient;
}

interface ItemAuthorityRow {
  id: string;
  campaign_id: string;
  status: 'draft' | 'ready' | 'in_review' | 'completed' | 'cancelled';
  version: string | number;
  campaign_status: 'draft' | 'planned' | 'active' | 'completed' | 'archived';
  participant_role: 'owner' | 'editor' | 'viewer' | null;
}

interface ItemArtifactRow {
  id: string;
  campaign_id: string;
  item_id: string;
  asset_id: string | null;
  artifact_id: string;
  artifact_owner_id: string;
  filename: string;
  content_type: string;
  size_bytes: string | number;
  sha256: string;
  created_by: string;
  created_at: Date | string;
}

const LinkInputSchema = z.object({
  artifactId: z.string().uuid(),
  assetId: z.string().uuid().optional()
}).strict();

const OptionalAssetSchema = z.string().uuid().optional();

function mapArtifact(row: ItemArtifactRow): ItemArtifact {
  return {
    id: row.id,
    itemId: row.item_id,
    campaignId: row.campaign_id,
    assetId: row.asset_id,
    artifactId: row.artifact_id,
    artifactOwnerId: row.artifact_owner_id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString()
  };
}

async function assertItemAuthority(
  client: PoolClient,
  context: CommandContext,
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
      participant.member_role::text as participant_role
    from marketing_ops.campaign_items as item
    join marketing_ops.campaigns as campaign
      on campaign.tenant_id = item.tenant_id
      and campaign.id = item.campaign_id
    left join marketing_ops.campaign_members as participant
      on participant.tenant_id = item.tenant_id
      and participant.campaign_id = item.campaign_id
      and participant.user_id = $2
    where item.id = $1
  `, [itemId, context.actor.userId]);
  const row = result.rows[0];
  if (!row) throw appError('not_found', 404, 'Production item not found');
  if (!mutation) return row;
  if (row.campaign_status === 'archived') {
    throw appError('campaign_archived', 409, 'Archived campaign is read-only');
  }
  if (row.status === 'completed' || row.status === 'cancelled') {
    throw appError('item_terminal', 409, 'Terminal production item is read-only');
  }
  if (context.actor.role === 'manager' || context.actor.role === 'admin') return row;
  if (row.participant_role !== 'owner' && row.participant_role !== 'editor') {
    throw appError('forbidden', 403, 'Campaign edit authority is required');
  }
  return row;
}

async function acquireItemMutationLock(
  client: PoolClient,
  itemId: string
): Promise<void> {
  const permission = await client.query<{ allowed: boolean }>(
    'select marketing_ops_private.can_edit_campaign_item($1) as allowed',
    [itemId]
  );
  if (permission.rows[0]?.allowed !== true) {
    throw appError('forbidden', 403, 'Campaign does not grant artifact authority');
  }
}

async function validateAssetForItem(
  client: PoolClient,
  itemId: string,
  assetId?: string
): Promise<string | null> {
  if (!assetId) return null;
  const result = await client.query<{ item_id: string }>(
    'select item_id from marketing_ops.content_assets where id = $1',
    [assetId]
  );
  if (result.rows[0]?.item_id !== itemId) {
    throw appError(
      'artifact_asset_mismatch',
      422,
      'Artifact content asset must belong to the same item'
    );
  }
  return assetId;
}

async function bumpItemVersion(
  client: PoolClient,
  context: ItemArtifactCommandContext,
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

async function insertArtifactLink(
  client: PoolClient,
  context: ItemArtifactCommandContext,
  item: ItemAuthorityRow,
  metadata: ArtifactMetadata,
  assetId: string | null
): Promise<ItemArtifact> {
  const inserted = await client.query<ItemArtifactRow>(`
    insert into marketing_ops.item_artifacts (
      tenant_id,
      campaign_id,
      item_id,
      asset_id,
      artifact_id,
      artifact_owner_id,
      filename,
      content_type,
      size_bytes,
      sha256,
      created_by
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    returning *
  `, [
    context.actor.tenantId,
    item.campaign_id,
    item.id,
    assetId,
    metadata.id,
    metadata.ownerId,
    metadata.filename,
    metadata.contentType,
    metadata.size,
    metadata.sha256,
    context.actor.userId
  ]);
  const row = inserted.rows[0];
  if (!row) throw appError('forbidden', 403, 'Artifact link was rejected');
  return mapArtifact(row);
}

async function recordArtifactLinked(
  client: PoolClient,
  context: ItemArtifactCommandContext,
  artifact: ItemArtifact,
  itemVersion: number
): Promise<void> {
  await writeAudit(
    client,
    context,
    'campaign_item',
    artifact.itemId,
    'item_artifact.linked',
    null,
    { ...artifact, itemVersion }
  );
  await writeDomainEvent(
    client,
    context,
    'campaign_item',
    artifact.itemId,
    'marketing_ops.item_artifact.linked.v1',
    {
      itemId: artifact.itemId,
      artifactLinkId: artifact.id,
      artifactId: artifact.artifactId,
      assetId: artifact.assetId,
      itemVersion
    }
  );
}

function mapPersistenceError(error: unknown): never {
  const databaseError = error as { constraint?: string };
  if (databaseError.constraint === 'item_artifacts_item_unique') {
    throw appError('artifact_exists', 409, 'Artifact is already linked to the item');
  }
  if (databaseError.constraint === 'item_artifacts_asset_fk') {
    throw appError(
      'artifact_asset_mismatch',
      422,
      'Artifact content asset must belong to the same item'
    );
  }
  throw error;
}

export async function attachUploadedItemArtifact(
  context: ItemArtifactCommandContext,
  itemId: string,
  expectedItemVersion: number,
  input: ItemArtifactUploadInput,
  idempotencyKey: string
): Promise<ItemArtifactMutation> {
  authorize(context.actor, 'item_artifact.manage');
  const file = validateMaterialFile(input);
  const asset = OptionalAssetSchema.safeParse(input.assetId);
  if (!asset.success) {
    throw appError('validation_error', 400, 'Artifact asset ID must be a UUID');
  }

  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      const item = await assertItemAuthority(client, context, itemId, true);
      let uploadedArtifactId: string | null = null;
      try {
        return await executeIdempotentCommand(
          client,
          context,
          `item_artifact.upload:${itemId}`,
          idempotencyKey,
          {
            itemId,
            expectedItemVersion,
            assetId: asset.data ?? null,
            filename: file.filename,
            contentType: file.contentType,
            size: file.size,
            sha256: file.sha256
          },
          async () => {
            const rawUploaded = await context.artifacts.upload({
              ownerId: context.actor.userId,
              filename: file.filename,
              contentType: file.contentType,
              bytes: file.bytes
            });
            if (z.string().uuid().safeParse(rawUploaded.id).success) {
              uploadedArtifactId = rawUploaded.id;
            }
            const uploaded = validateArtifactMetadata(rawUploaded);
            if (
              uploaded.ownerId !== context.actor.userId ||
              uploaded.filename !== file.filename ||
              uploaded.contentType !== file.contentType ||
              uploaded.size !== file.size ||
              uploaded.sha256 !== file.sha256 ||
              uploaded.source !== 'marketing_ops'
            ) {
              throw appError(
                'dependency_invalid_response',
                502,
                'Uploaded artifact metadata does not match the file'
              );
            }
            await context.faultInjector?.('item_artifact.after_upload');
            await acquireItemMutationLock(client, itemId);
            const assetId = await validateAssetForItem(client, itemId, asset.data);
            const artifact = await insertArtifactLink(
              client,
              context,
              item,
              uploaded,
              assetId
            );
            const itemVersion = await bumpItemVersion(
              client,
              context,
              itemId,
              expectedItemVersion
            );
            await recordArtifactLinked(client, context, artifact, itemVersion);
            return { artifact, itemVersion };
          }
        );
      } catch (error) {
        const databaseError = error as { constraint?: string };
        if (
          uploadedArtifactId &&
          databaseError.constraint !== 'item_artifacts_item_unique'
        ) {
          try {
            await context.artifacts.delete(uploadedArtifactId);
          } catch {
            throw appError(
              'artifact_compensation_failed',
              502,
              'Artifact cleanup failed after persistence error'
            );
          }
        }
        return mapPersistenceError(error);
      }
    }
  );
}

export async function linkExistingItemArtifact(
  context: ItemArtifactCommandContext,
  itemId: string,
  expectedItemVersion: number,
  input: LinkExistingItemArtifactInput,
  idempotencyKey: string
): Promise<ItemArtifactMutation> {
  authorize(context.actor, 'item_artifact.manage');
  const parsed = LinkInputSchema.safeParse(input);
  if (!parsed.success) {
    throw appError('validation_error', 400, 'Artifact link input is invalid');
  }
  try {
    return await withActorTransaction(
      context.pool,
      context.actor,
      context.correlationId,
      async (client) => {
        const item = await assertItemAuthority(client, context, itemId, true);
        return executeIdempotentCommand(
          client,
          context,
          `item_artifact.link:${itemId}`,
          idempotencyKey,
          { itemId, expectedItemVersion, ...parsed.data },
          async () => {
            const metadata = validateArtifactMetadata(
              await context.artifacts.getOwnedMetadata(
                parsed.data.artifactId,
                context.actor.userId
              )
            );
            await acquireItemMutationLock(client, itemId);
            const assetId = await validateAssetForItem(
              client,
              itemId,
              parsed.data.assetId
            );
            const artifact = await insertArtifactLink(
              client,
              context,
              item,
              metadata,
              assetId
            );
            const itemVersion = await bumpItemVersion(
              client,
              context,
              itemId,
              expectedItemVersion
            );
            await recordArtifactLinked(client, context, artifact, itemVersion);
            return { artifact, itemVersion };
          }
        );
      }
    );
  } catch (error) {
    return mapPersistenceError(error);
  }
}

export async function listItemArtifacts(
  context: CommandContext,
  itemId: string
): Promise<ItemArtifact[]> {
  authorize(context.actor, 'item_artifact.read');
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      await assertItemAuthority(client, context, itemId, false);
      const result = await client.query<ItemArtifactRow>(`
        select *
        from marketing_ops.item_artifacts
        where item_id = $1 and unlinked_at is null
        order by created_at desc, id
      `, [itemId]);
      return result.rows.map(mapArtifact);
    }
  );
}

async function activeArtifactById(
  client: PoolClient,
  itemId: string,
  artifactLinkId: string
): Promise<ItemArtifact> {
  const result = await client.query<ItemArtifactRow>(`
    select *
    from marketing_ops.item_artifacts
    where id = $1 and item_id = $2 and unlinked_at is null
  `, [artifactLinkId, itemId]);
  if (!result.rows[0]) {
    throw appError('artifact_link_not_found', 404, 'Item artifact link not found');
  }
  return mapArtifact(result.rows[0]);
}

export async function createItemArtifactAccessLink(
  context: ItemArtifactCommandContext,
  itemId: string,
  artifactLinkId: string
): Promise<ArtifactAccessLink> {
  authorize(context.actor, 'item_artifact.read');
  const artifact = await withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      await assertItemAuthority(client, context, itemId, false);
      return activeArtifactById(client, itemId, artifactLinkId);
    }
  );
  return context.artifacts.createAccessLink(
    artifact.artifactId,
    artifact.artifactOwnerId,
    300
  );
}

export async function unlinkItemArtifact(
  context: ItemArtifactCommandContext,
  itemId: string,
  artifactLinkId: string,
  expectedItemVersion: number,
  idempotencyKey: string
): Promise<ItemArtifactRemoval> {
  authorize(context.actor, 'item_artifact.manage');
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      await assertItemAuthority(client, context, itemId, true);
      return executeIdempotentCommand(
        client,
        context,
        `item_artifact.unlink:${itemId}:${artifactLinkId}`,
        idempotencyKey,
        { itemId, artifactLinkId, expectedItemVersion },
        async () => {
          await acquireItemMutationLock(client, itemId);
          const artifact = await activeArtifactById(client, itemId, artifactLinkId);
          const updated = await client.query(`
            update marketing_ops.item_artifacts
            set unlinked_by = $3, unlinked_at = now()
            where id = $1 and item_id = $2 and unlinked_at is null
          `, [artifactLinkId, itemId, context.actor.userId]);
          if (updated.rowCount !== 1) {
            throw appError('artifact_link_not_found', 404, 'Item artifact link not found');
          }
          const itemVersion = await bumpItemVersion(
            client,
            context,
            itemId,
            expectedItemVersion
          );
          await writeAudit(
            client,
            context,
            'campaign_item',
            itemId,
            'item_artifact.unlinked',
            {
              artifactLinkId,
              artifactId: artifact.artifactId,
              assetId: artifact.assetId
            },
            { itemVersion }
          );
          await writeDomainEvent(
            client,
            context,
            'campaign_item',
            itemId,
            'marketing_ops.item_artifact.unlinked.v1',
            {
              itemId,
              artifactLinkId,
              artifactId: artifact.artifactId,
              assetId: artifact.assetId,
              itemVersion
            }
          );
          return { artifactLinkId, itemVersion };
        }
      );
    }
  );
}
