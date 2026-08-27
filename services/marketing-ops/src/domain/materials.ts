import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import type { ArtifactAccessLink, ArtifactClient, ArtifactMetadata } from '../integrations/artifactClient.js';
import { writeAudit } from './audit.js';
import type { CommandContext } from './context.js';
import { writeDomainEvent } from './events.js';
import { executeIdempotentCommand } from './idempotency.js';

export const MAX_CAMPAIGN_MATERIAL_BYTES = 25 * 1024 * 1024;
export const CampaignMaterialSourceSchema = z.enum(['upload', 'existing_artifact']);
export const LinkExistingMaterialSchema = z.object({ artifactId: z.string().uuid() }).strict();

const approvedTypes = new Map<string, readonly string[]>([
  ['.pdf', ['application/pdf']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.txt', ['text/plain']],
  ['.csv', ['text/csv']],
  ['.png', ['image/png']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.webp', ['image/webp']]
]);

export interface MaterialFileInput {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface ValidatedMaterialFile extends MaterialFileInput {
  size: number;
  sha256: string;
}

export interface CampaignMaterial {
  id: string;
  campaignId: string;
  artifactId: string;
  artifactOwnerId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  source: z.infer<typeof CampaignMaterialSourceSchema>;
  createdBy: string;
  createdAt: string;
}

export interface MaterialMutationResult {
  material: CampaignMaterial;
  campaignVersion: number;
}

export interface MaterialRemovalResult {
  materialId: string;
  campaignVersion: number;
}

export interface MaterialCommandContext extends CommandContext {
  artifacts: ArtifactClient;
}

interface CampaignAuthorityRow {
  status: string;
  participant_role: 'owner' | 'editor' | 'viewer' | null;
}

interface CampaignVersionRow {
  version: string | number;
}

interface MaterialRow {
  id: string;
  campaign_id: string;
  artifact_id: string;
  artifact_owner_id: string;
  filename: string;
  content_type: string;
  size_bytes: string | number;
  sha256: string;
  source: z.infer<typeof CampaignMaterialSourceSchema>;
  created_by: string;
  created_at: Date | string;
}

function normalizeFilename(value: string): string {
  const raw = basename(String(value ?? '').replace(/\\/g, '/')).trim();
  const filename = raw
    .replace(/[\r\n"]/g, '')
    .replace(/[^\w.\-=+ ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  if (!filename || filename === '.' || filename === '..') {
    throw appError('material_type_not_allowed', 422, 'Material filename is invalid');
  }
  return filename;
}

function normalizeContentType(value: string): string {
  return String(value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function assertApprovedDescriptor(filename: string, contentType: string, size: number): void {
  const extension = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
    : '';
  if (!approvedTypes.get(extension)?.includes(contentType)) {
    throw appError('material_type_not_allowed', 422, 'Material type is not allowed');
  }
  if (size <= 0) throw appError('material_empty', 422, 'Material cannot be empty');
  if (size > MAX_CAMPAIGN_MATERIAL_BYTES) {
    throw appError('material_too_large', 413, 'Material exceeds 25 MiB');
  }
}

export function validateMaterialFile(input: MaterialFileInput): ValidatedMaterialFile {
  const filename = normalizeFilename(input.filename);
  const contentType = normalizeContentType(input.contentType);
  const bytes = Buffer.from(input.bytes);
  assertApprovedDescriptor(filename, contentType, bytes.byteLength);
  return {
    filename,
    contentType,
    bytes,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
}

export function validateArtifactMetadata(metadata: ArtifactMetadata): ArtifactMetadata {
  const filename = normalizeFilename(metadata.filename);
  const contentType = normalizeContentType(metadata.contentType);
  assertApprovedDescriptor(filename, contentType, metadata.size);
  if (!z.string().uuid().safeParse(metadata.id).success ||
      !metadata.ownerId.trim() || metadata.ownerId.length > 200 ||
      !/^[a-f0-9]{64}$/.test(metadata.sha256)) {
    throw appError('dependency_invalid_response', 502, 'Artifact metadata is invalid');
  }
  return { ...metadata, filename, contentType };
}

function mapMaterial(row: MaterialRow): CampaignMaterial {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    artifactId: row.artifact_id,
    artifactOwnerId: row.artifact_owner_id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    source: row.source,
    createdBy: row.created_by,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

async function assertMaterialManagementAuthority(
  client: PoolClient,
  context: MaterialCommandContext,
  campaignId: string
): Promise<void> {
  authorize(context.actor, 'material.manage');
  const result = await client.query<CampaignAuthorityRow>(`
    select campaign.status::text,
           participant.member_role::text as participant_role
    from marketing_ops.campaigns as campaign
    left join marketing_ops.campaign_members as participant
      on participant.campaign_id = campaign.id
      and participant.tenant_id = campaign.tenant_id
      and participant.user_id = $2
    where campaign.id = $1
  `, [campaignId, context.actor.userId]);
  const campaign = result.rows[0];
  if (!campaign) throw appError('not_found', 404, 'Campaign not found');
  if (campaign.status === 'archived') {
    throw appError('campaign_read_only', 409, 'Archived campaign is read-only');
  }
  if (context.actor.role === 'manager' || context.actor.role === 'admin') return;
  if (campaign.participant_role !== 'owner' && campaign.participant_role !== 'editor') {
    throw appError('forbidden', 403, 'Campaign edit authority is required to manage materials');
  }
}

async function lockMaterialAggregate(
  client: PoolClient,
  campaignId: string,
  expectedVersion: number
): Promise<void> {
  const permission = await client.query<{ allowed: boolean }>(
    'select marketing_ops_private.can_edit_campaign($1) as allowed',
    [campaignId]
  );
  if (permission.rows[0]?.allowed !== true) {
    throw appError('forbidden', 403, 'Campaign does not grant material management authority');
  }
  const campaign = await client.query<CampaignVersionRow>(`
    select version
    from marketing_ops.campaigns
    where id = $1
    for update
  `, [campaignId]);
  const row = campaign.rows[0];
  if (!row) throw appError('not_found', 404, 'Campaign not found');
  const currentVersion = Number(row.version);
  if (currentVersion !== expectedVersion) {
    throw appError('version_conflict', 409, 'Campaign version is stale', { currentVersion });
  }
}

async function incrementCampaignVersion(
  client: PoolClient,
  context: MaterialCommandContext,
  campaignId: string
): Promise<number> {
  const result = await client.query<{ version: string | number }>(`
    update marketing_ops.campaigns
    set version = version + 1, updated_by = $2
    where id = $1
    returning version
  `, [campaignId, context.actor.userId]);
  if (!result.rows[0]) throw appError('not_found', 404, 'Campaign not found');
  return Number(result.rows[0].version);
}

async function insertMaterial(
  client: PoolClient,
  context: MaterialCommandContext,
  campaignId: string,
  metadata: ArtifactMetadata,
  source: z.infer<typeof CampaignMaterialSourceSchema>
): Promise<CampaignMaterial> {
  const existing = await client.query<{ id: string }>(`
    select id
    from marketing_ops.campaign_materials
    where campaign_id = $1 and artifact_id = $2 and unlinked_at is null
  `, [campaignId, metadata.id]);
  if (existing.rows[0]) throw appError('material_exists', 409, 'Artifact is already linked to campaign');
  const result = await client.query<MaterialRow>(`
    insert into marketing_ops.campaign_materials (
      tenant_id, campaign_id, artifact_id, artifact_owner_id, filename,
      content_type, size_bytes, sha256, source, created_by
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    returning *
  `, [
    context.actor.tenantId,
    campaignId,
    metadata.id,
    metadata.ownerId,
    metadata.filename,
    metadata.contentType,
    metadata.size,
    metadata.sha256,
    source,
    context.actor.userId
  ]);
  if (!result.rows[0]) throw appError('forbidden', 403, 'Material link was rejected');
  return mapMaterial(result.rows[0]);
}

async function listMaterialsInClient(client: PoolClient, campaignId: string): Promise<CampaignMaterial[]> {
  const result = await client.query<MaterialRow>(`
    select *
    from marketing_ops.campaign_materials
    where campaign_id = $1 and unlinked_at is null
    order by created_at desc, id
  `, [campaignId]);
  if (result.rows.length === 0) {
    const campaign = await client.query('select id from marketing_ops.campaigns where id = $1', [campaignId]);
    if (!campaign.rows[0]) throw appError('not_found', 404, 'Campaign not found');
  }
  return result.rows.map(mapMaterial);
}

async function materialByIdInClient(
  client: PoolClient,
  campaignId: string,
  materialId: string,
  lockRow = false
): Promise<CampaignMaterial> {
  const result = await client.query<MaterialRow>(`
    select *
    from marketing_ops.campaign_materials
    where id = $1 and campaign_id = $2 and unlinked_at is null
    ${lockRow ? 'for update' : ''}
  `, [materialId, campaignId]);
  if (!result.rows[0]) throw appError('material_not_found', 404, 'Campaign material not found');
  return mapMaterial(result.rows[0]);
}

async function recordMaterialLinked(
  client: PoolClient,
  context: MaterialCommandContext,
  campaignId: string,
  material: CampaignMaterial,
  campaignVersion: number
): Promise<void> {
  await writeAudit(client, context, 'campaign', campaignId, 'material.linked', null, {
    material,
    campaignVersion
  });
  await writeDomainEvent(client, context, 'campaign', campaignId, 'marketing_ops.campaign.material_linked.v1', {
    campaignId,
    material,
    campaignVersion
  });
}

export async function attachUploadedMaterial(
  context: MaterialCommandContext,
  campaignId: string,
  expectedVersion: number,
  input: MaterialFileInput,
  idempotencyKey: string
): Promise<MaterialMutationResult> {
  const file = validateMaterialFile(input);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    await assertMaterialManagementAuthority(client, context, campaignId);
    let uploadedArtifactId: string | null = null;
    try {
      return await executeIdempotentCommand(
        client,
        context,
        `campaign.material.upload:${campaignId}`,
        idempotencyKey,
        {
          campaignId,
          expectedVersion,
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
          let uploaded: ArtifactMetadata;
          try {
            uploaded = validateArtifactMetadata(rawUploaded);
          } catch {
            throw appError('dependency_invalid_response', 502, 'Uploaded artifact metadata is invalid');
          }
          if (uploaded.ownerId !== context.actor.userId ||
              uploaded.filename !== file.filename ||
              uploaded.contentType !== file.contentType ||
              uploaded.size !== file.size ||
              uploaded.sha256 !== file.sha256 ||
              uploaded.source !== 'marketing_ops') {
            throw appError('dependency_invalid_response', 502, 'Uploaded artifact metadata does not match the file');
          }
          await context.faultInjector?.('material.after_upload');
          await lockMaterialAggregate(client, campaignId, expectedVersion);
          const material = await insertMaterial(client, context, campaignId, uploaded, 'upload');
          const campaignVersion = await incrementCampaignVersion(client, context, campaignId);
          await recordMaterialLinked(client, context, campaignId, material, campaignVersion);
          return { material, campaignVersion };
        }
      );
    } catch (error) {
      if (uploadedArtifactId) {
        try {
          await context.artifacts.delete(uploadedArtifactId);
        } catch {
          throw appError('artifact_compensation_failed', 502, 'Artifact cleanup failed after persistence error');
        }
      }
      throw error;
    }
  });
}

export async function linkExistingMaterial(
  context: MaterialCommandContext,
  campaignId: string,
  expectedVersion: number,
  artifactId: string,
  idempotencyKey: string
): Promise<MaterialMutationResult> {
  const parsedArtifactId = z.string().uuid().parse(artifactId);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    await assertMaterialManagementAuthority(client, context, campaignId);
    return executeIdempotentCommand(
      client,
      context,
      `campaign.material.link:${campaignId}`,
      idempotencyKey,
      { campaignId, expectedVersion, artifactId: parsedArtifactId },
      async () => {
        const metadata = validateArtifactMetadata(await context.artifacts.getMetadata(parsedArtifactId));
        if (metadata.ownerId !== context.actor.userId) {
          throw appError('artifact_not_owned', 403, 'Artifact belongs to another user');
        }
        await lockMaterialAggregate(client, campaignId, expectedVersion);
        const material = await insertMaterial(client, context, campaignId, metadata, 'existing_artifact');
        const campaignVersion = await incrementCampaignVersion(client, context, campaignId);
        await recordMaterialLinked(client, context, campaignId, material, campaignVersion);
        return { material, campaignVersion };
      }
    );
  });
}

export async function listMaterials(
  context: MaterialCommandContext,
  campaignId: string
): Promise<CampaignMaterial[]> {
  authorize(context.actor, 'material.read');
  return withActorTransaction(context.pool, context.actor, context.correlationId, (client) =>
    listMaterialsInClient(client, campaignId)
  );
}

export async function createMaterialAccessLink(
  context: MaterialCommandContext,
  campaignId: string,
  materialId: string
): Promise<ArtifactAccessLink> {
  authorize(context.actor, 'material.read');
  const material = await withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    (client) => materialByIdInClient(client, campaignId, materialId)
  );
  return context.artifacts.createAccessLink(material.artifactId, material.artifactOwnerId, 300);
}

export async function unlinkMaterial(
  context: MaterialCommandContext,
  campaignId: string,
  materialId: string,
  expectedVersion: number,
  idempotencyKey: string
): Promise<MaterialRemovalResult> {
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    await assertMaterialManagementAuthority(client, context, campaignId);
    return executeIdempotentCommand(
      client,
      context,
      `campaign.material.unlink:${campaignId}:${materialId}`,
      idempotencyKey,
      { campaignId, materialId, expectedVersion },
      async () => {
        await lockMaterialAggregate(client, campaignId, expectedVersion);
        const material = await materialByIdInClient(client, campaignId, materialId, true);
        const mutation = await client.query(`
          update marketing_ops.campaign_materials
          set unlinked_by = $3, unlinked_at = now()
          where id = $1 and campaign_id = $2 and unlinked_at is null
        `, [materialId, campaignId, context.actor.userId]);
        if (mutation.rowCount !== 1) throw appError('forbidden', 403, 'Material unlink was rejected');
        const campaignVersion = await incrementCampaignVersion(client, context, campaignId);
        await writeAudit(client, context, 'campaign', campaignId, 'material.unlinked', {
          materialId: material.id,
          artifactId: material.artifactId
        }, { campaignVersion });
        await writeDomainEvent(client, context, 'campaign', campaignId, 'marketing_ops.campaign.material_unlinked.v1', {
          campaignId,
          materialId: material.id,
          artifactId: material.artifactId,
          campaignVersion
        });
        return { materialId, campaignVersion };
      }
    );
  });
}
