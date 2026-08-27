import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import { writeAudit } from './audit.js';
import type { CommandContext } from './context.js';
import {
  assertTransitionAllowed,
  CampaignInputSchema,
  CampaignPatchSchema,
  validatePlanningReadiness,
  type CampaignChannel,
  type CampaignInput,
  type CampaignParticipantAuthority,
  type CampaignPatch,
  type CampaignPlanningReadiness,
  type CampaignStatus,
  type ReferenceType
} from './contracts.js';
import { writeDomainEvent } from './events.js';
import { executeIdempotentCommand } from './idempotency.js';

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  courseSlug: string | null;
  objective: string | null;
  referenceType: ReferenceType | null;
  referenceKey: string | null;
  referenceTitleSnapshot: string | null;
  referenceDocumentId: string | null;
  referenceVerifiedAt: string | null;
  audience: string | null;
  startsOn: string | null;
  endsOn: string | null;
  primaryChannel: CampaignChannel | null;
  secondaryChannels: CampaignChannel[];
  briefing: string | null;
  notes: string | null;
  status: CampaignStatus;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CampaignReferenceVerifier {
  verifyCourseReference(documentId: string, referenceKey: string): Promise<{
    referenceKey: string;
    title: string;
    documentId: string;
    verifiedAt: string;
  }>;
}

export interface CampaignCommandContext extends CommandContext {
  courseReferences?: CampaignReferenceVerifier;
}

export interface ResolvedCampaignReference {
  input: CampaignInput;
  verifiedAt: string | null;
}

const VerifiedReferenceSchema = z.object({
  referenceKey: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  documentId: z.string().uuid(),
  verifiedAt: z.string().datetime()
}).passthrough();

export interface CampaignRow {
  id: string;
  tenant_id: string;
  name: string;
  course_slug: string | null;
  objective: string | null;
  reference_type: ReferenceType | null;
  reference_key: string | null;
  reference_title_snapshot: string | null;
  reference_document_id: string | null;
  reference_verified_at: Date | string | null;
  audience: string | null;
  starts_on: Date | string | null;
  ends_on: Date | string | null;
  primary_channel: CampaignChannel | null;
  secondary_channels: CampaignChannel[];
  briefing: string | null;
  notes: string | null;
  status: CampaignStatus;
  version: string | number;
  created_by: string;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
}

interface CampaignAuthorityRow extends CampaignRow {
  participant_member_role: CampaignParticipantAuthority['memberRole'] | null;
  participant_is_primary: boolean | null;
  has_primary_owner: boolean;
}

export interface CreateCampaignDraftInput extends Partial<CampaignInput> {
  name: string;
  courseSlug?: string;
  idempotencyKey: string;
}

export type UpdateCampaignInput = CampaignPatch & { idempotencyKey: string };

const timestamp = (value: Date | string): string => new Date(value).toISOString();
const nullableTimestamp = (value: Date | string | null): string | null =>
  value === null ? null : timestamp(value);
const nullableDate = (value: Date | string | null): string | null => {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
};

const parsePgArray = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    if (value === '{}') return [];
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^"|"$/g, '')) as T[];
  }
  return [];
};

export function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    courseSlug: row.course_slug,
    objective: row.objective,
    referenceType: row.reference_type,
    referenceKey: row.reference_key,
    referenceTitleSnapshot: row.reference_title_snapshot,
    referenceDocumentId: row.reference_document_id,
    referenceVerifiedAt: nullableTimestamp(row.reference_verified_at),
    audience: row.audience,
    startsOn: nullableDate(row.starts_on),
    endsOn: nullableDate(row.ends_on),
    primaryChannel: row.primary_channel,
    secondaryChannels: parsePgArray<CampaignChannel>(row.secondary_channels),
    briefing: row.briefing,
    notes: row.notes,
    status: row.status,
    version: Number(row.version),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    archivedAt: nullableTimestamp(row.archived_at)
  };
}

const editableFields = (campaign: Campaign): CampaignInput => ({
  name: campaign.name,
  objective: campaign.objective,
  referenceType: campaign.referenceType,
  referenceKey: campaign.referenceKey,
  referenceTitleSnapshot: campaign.referenceTitleSnapshot,
  referenceDocumentId: campaign.referenceDocumentId,
  audience: campaign.audience,
  startsOn: campaign.startsOn,
  endsOn: campaign.endsOn,
  primaryChannel: campaign.primaryChannel,
  secondaryChannels: campaign.secondaryChannels,
  briefing: campaign.briefing,
  notes: campaign.notes
});

export async function resolveCampaignReference(
  input: CampaignInput,
  options: {
    referenceTouched: boolean;
    previousVerifiedAt: string | null;
    verifier?: CampaignReferenceVerifier;
  }
): Promise<ResolvedCampaignReference> {
  if (!options.referenceTouched) {
    return { input, verifiedAt: options.previousVerifiedAt };
  }
  if (input.referenceType !== 'course' || !input.referenceKey || !input.referenceDocumentId) {
    return { input, verifiedAt: null };
  }
  if (!options.verifier) {
    throw appError('dependency_unavailable', 503, 'RAG course verification is unavailable');
  }
  const verifiedResult = await options.verifier.verifyCourseReference(
    input.referenceDocumentId,
    input.referenceKey
  );
  const verified = VerifiedReferenceSchema.safeParse(verifiedResult);
  if (!verified.success) {
    throw appError('dependency_invalid_response', 502, 'RAG verifier returned invalid course metadata');
  }
  if (
    verified.data.documentId !== input.referenceDocumentId ||
    verified.data.referenceKey !== input.referenceKey
  ) {
    throw appError('reference_not_verified', 422, 'Course reference identity does not match');
  }
  return {
    input: {
      ...input,
      referenceKey: verified.data.referenceKey,
      referenceTitleSnapshot: verified.data.title,
      referenceDocumentId: verified.data.documentId
    },
    verifiedAt: verified.data.verifiedAt
  };
}

const participantAuthority = (
  row: CampaignAuthorityRow
): CampaignParticipantAuthority | null => row.participant_member_role
  ? { memberRole: row.participant_member_role, isPrimary: row.participant_is_primary === true }
  : null;

const planningReadiness = (
  campaign: Campaign,
  hasPrimaryOwner: boolean,
  referenceVerifiedAt = campaign.referenceVerifiedAt
): CampaignPlanningReadiness => ({
  name: campaign.name,
  objective: campaign.objective,
  referenceType: campaign.referenceType,
  referenceKey: campaign.referenceKey,
  referenceTitleSnapshot: campaign.referenceTitleSnapshot,
  referenceDocumentId: campaign.referenceDocumentId,
  referenceVerifiedAt,
  startsOn: campaign.startsOn,
  endsOn: campaign.endsOn,
  hasPrimaryOwner
});

const CAMPAIGN_AUTHORITY_SQL = `
  select campaign.*,
    participant.member_role::text as participant_member_role,
    participant.is_primary as participant_is_primary,
    exists (
      select 1
      from marketing_ops.campaign_members as primary_owner
      where primary_owner.campaign_id = campaign.id
        and primary_owner.tenant_id = campaign.tenant_id
        and primary_owner.member_role = 'owner'
        and primary_owner.is_primary
    ) as has_primary_owner
  from marketing_ops.campaigns as campaign
  left join marketing_ops.campaign_members as participant
    on participant.campaign_id = campaign.id
    and participant.tenant_id = campaign.tenant_id
    and participant.user_id = auth.uid()
  where campaign.id = $1
`;

async function loadCampaignAuthority(
  client: PoolClient,
  id: string,
  lockRow: boolean
): Promise<CampaignAuthorityRow | null> {
  const result = await client.query<CampaignAuthorityRow>(
    lockRow ? `${CAMPAIGN_AUTHORITY_SQL} for update of campaign` : CAMPAIGN_AUTHORITY_SQL,
    [id]
  );
  return result.rows[0] ?? null;
}

async function visibleCampaign(client: PoolClient, id: string): Promise<CampaignAuthorityRow> {
  const row = await loadCampaignAuthority(client, id, false);
  if (!row) throw appError('not_found', 404, 'Campaign not found');
  return row;
}

async function lockCampaign(client: PoolClient, id: string): Promise<CampaignAuthorityRow> {
  await visibleCampaign(client, id);
  const permission = await client.query<{ allowed: boolean }>(
    'select marketing_ops_private.can_edit_campaign($1) as allowed',
    [id]
  );
  if (permission.rows[0]?.allowed !== true) {
    throw appError('forbidden', 403, 'Campaign does not grant mutation authority');
  }
  const row = await loadCampaignAuthority(client, id, true);
  if (!row) throw appError('not_found', 404, 'Campaign not found');
  return row;
}

function assertExpectedVersion(row: CampaignAuthorityRow, expectedVersion: number): void {
  const currentVersion = Number(row.version);
  if (currentVersion !== expectedVersion) {
    throw appError('version_conflict', 409, 'Campaign version is stale', { currentVersion });
  }
}

function assertCurrentEditAuthority(
  context: CommandContext,
  row: CampaignAuthorityRow
): void {
  if (context.actor.role === 'manager' || context.actor.role === 'admin') return;
  const participant = participantAuthority(row);
  if (participant?.memberRole === 'owner' || participant?.memberRole === 'editor') return;
  throw appError('forbidden', 403, 'Campaign does not grant mutation authority');
}

function assertCurrentStatusAuthority(
  context: CommandContext,
  row: CampaignAuthorityRow,
  operation: 'transition' | 'archive'
): void {
  if (operation === 'archive') {
    authorize(context.actor, 'campaign.archive');
    return;
  }
  authorize(context.actor, 'campaign.transition');
  if (context.actor.role === 'member') {
    const participant = participantAuthority(row);
    if (!(participant?.memberRole === 'owner' && participant.isPrimary)) {
      throw appError('forbidden', 403, 'Primary campaign owner is required to change status', {
        permission: 'campaign.transition'
      });
    }
  }
}

export async function createCampaignDraft(
  context: CampaignCommandContext,
  input: CreateCampaignDraftInput
): Promise<Campaign> {
  authorize(context.actor, 'campaign.create');
  const campaignInput = CampaignInputSchema.parse({
    name: input.name,
    objective: input.objective ?? null,
    referenceType: input.referenceType ?? null,
    referenceKey: input.referenceKey ?? null,
    referenceTitleSnapshot: input.referenceTitleSnapshot ?? null,
    referenceDocumentId: input.referenceDocumentId ?? null,
    audience: input.audience ?? null,
    startsOn: input.startsOn ?? null,
    endsOn: input.endsOn ?? null,
    primaryChannel: input.primaryChannel ?? null,
    secondaryChannels: input.secondaryChannels ?? [],
    briefing: input.briefing ?? null,
    notes: input.notes ?? null
  });
  const courseSlug = input.courseSlug?.trim() || null;

  return withActorTransaction(context.pool, context.actor, context.correlationId, (client) =>
    executeIdempotentCommand(
      client,
      context,
      'campaign.create',
      input.idempotencyKey,
      { ...campaignInput, courseSlug },
      async () => {
        const resolvedReference = await resolveCampaignReference(campaignInput, {
          referenceTouched: true,
          previousVerifiedAt: null,
          ...(context.courseReferences ? { verifier: context.courseReferences } : {})
        });
        const persistedInput = resolvedReference.input;
        const campaignId = randomUUID();
        await client.query(`
          insert into marketing_ops.campaigns (
            id, tenant_id, name, course_slug, objective, reference_type, reference_key,
            reference_title_snapshot, reference_document_id, reference_verified_at,
            audience, starts_on, ends_on, primary_channel, secondary_channels, briefing,
            notes, created_by, updated_by
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15::marketing_ops.campaign_channel[], $16, $17, $18, $18
          )
        `, [
          campaignId, context.actor.tenantId, persistedInput.name, courseSlug,
          persistedInput.objective, persistedInput.referenceType, persistedInput.referenceKey,
          persistedInput.referenceTitleSnapshot, persistedInput.referenceDocumentId,
          resolvedReference.verifiedAt, persistedInput.audience, persistedInput.startsOn,
          persistedInput.endsOn, persistedInput.primaryChannel, persistedInput.secondaryChannels,
          persistedInput.briefing, persistedInput.notes, context.actor.userId
        ]);
        await context.faultInjector?.('after_entity');
        await client.query(`
          insert into marketing_ops.campaign_members (
            tenant_id, campaign_id, user_id, member_role, created_by
          ) values ($1, $2, $3, 'owner', $3)
        `, [context.actor.tenantId, campaignId, context.actor.userId]);

        const result = await client.query<CampaignRow>(`
          select * from marketing_ops.campaigns where id = $1
        `, [campaignId]);
        const campaign = mapCampaign(result.rows[0]!);
        await writeAudit(client, context, 'campaign', campaign.id, 'campaign.created', null, campaign);
        await writeDomainEvent(
          client,
          context,
          'campaign',
          campaign.id,
          'marketing_ops.campaign.created.v1',
          campaign
        );
        return campaign;
      }
    )
  );
}

export async function updateCampaign(
  context: CampaignCommandContext,
  id: string,
  expectedVersion: number,
  input: UpdateCampaignInput
): Promise<Campaign> {
  authorize(context.actor, 'campaign.update');
  const { idempotencyKey, ...candidatePatch } = input;
  const patch = CampaignPatchSchema.parse(candidatePatch);
  const referenceTouched = [
    'referenceType',
    'referenceKey',
    'referenceTitleSnapshot',
    'referenceDocumentId'
  ].some((field) => Object.prototype.hasOwnProperty.call(patch, field));

  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const preflight = await visibleCampaign(client, id);
    assertCurrentEditAuthority(context, preflight);
    return executeIdempotentCommand(
      client,
      context,
      `campaign.update:${id}`,
      idempotencyKey,
      { id, expectedVersion, patch },
      async () => {
        const preflightCampaign = mapCampaign(preflight);
        const preflightMerged = CampaignInputSchema.parse({
          ...editableFields(preflightCampaign),
          ...patch
        });
        const resolvedReference = await resolveCampaignReference(preflightMerged, {
          referenceTouched,
          previousVerifiedAt: preflightCampaign.referenceVerifiedAt,
          ...(context.courseReferences ? { verifier: context.courseReferences } : {})
        });
        const beforeRow = await lockCampaign(client, id);
        assertExpectedVersion(beforeRow, expectedVersion);
        const before = mapCampaign(beforeRow);
        const merged = resolvedReference.input;
        const nextVerifiedAt = resolvedReference.verifiedAt;
        const candidate = { ...before, ...merged };

        if (candidate.status === 'planned' || candidate.status === 'active' || candidate.status === 'completed') {
          validatePlanningReadiness(planningReadiness(
            candidate,
            beforeRow.has_primary_owner,
            nextVerifiedAt
          ));
        }

        const persistedPatch = referenceTouched
          ? {
              ...patch,
              referenceType: merged.referenceType,
              referenceKey: merged.referenceKey,
              referenceTitleSnapshot: merged.referenceTitleSnapshot,
              referenceDocumentId: merged.referenceDocumentId
            }
          : patch;
        const result = await client.query<CampaignRow>(`
          with patch as (select $2::jsonb as payload)
          update marketing_ops.campaigns as campaign
          set
            name = case when patch.payload ? 'name' then patch.payload ->> 'name' else campaign.name end,
            objective = case when patch.payload ? 'objective' then patch.payload ->> 'objective' else campaign.objective end,
            reference_type = case when patch.payload ? 'referenceType'
              then (patch.payload ->> 'referenceType')::marketing_ops.reference_type else campaign.reference_type end,
            reference_key = case when patch.payload ? 'referenceKey'
              then patch.payload ->> 'referenceKey' else campaign.reference_key end,
            reference_title_snapshot = case when patch.payload ? 'referenceTitleSnapshot'
              then patch.payload ->> 'referenceTitleSnapshot' else campaign.reference_title_snapshot end,
            reference_document_id = case when patch.payload ? 'referenceDocumentId'
              then (patch.payload ->> 'referenceDocumentId')::uuid else campaign.reference_document_id end,
            reference_verified_at = $5::timestamptz,
            audience = case when patch.payload ? 'audience' then patch.payload ->> 'audience' else campaign.audience end,
            starts_on = case when patch.payload ? 'startsOn'
              then (patch.payload ->> 'startsOn')::date else campaign.starts_on end,
            ends_on = case when patch.payload ? 'endsOn'
              then (patch.payload ->> 'endsOn')::date else campaign.ends_on end,
            primary_channel = case when patch.payload ? 'primaryChannel'
              then (patch.payload ->> 'primaryChannel')::marketing_ops.campaign_channel else campaign.primary_channel end,
            secondary_channels = case when patch.payload ? 'secondaryChannels'
              then array(
                select channel.value::marketing_ops.campaign_channel
                from jsonb_array_elements_text(patch.payload -> 'secondaryChannels') as channel(value)
              ) else campaign.secondary_channels end,
            briefing = case when patch.payload ? 'briefing' then patch.payload ->> 'briefing' else campaign.briefing end,
            notes = case when patch.payload ? 'notes' then patch.payload ->> 'notes' else campaign.notes end,
            version = campaign.version + 1,
            updated_by = $3
          from patch
          where campaign.id = $1 and campaign.version = $4
          returning campaign.*
        `, [id, JSON.stringify(persistedPatch), context.actor.userId, expectedVersion, nextVerifiedAt]);
        if (!result.rows[0]) {
          throw appError('version_conflict', 409, 'Campaign version is stale', {
            currentVersion: before.version
          });
        }
        const updated = mapCampaign(result.rows[0]);
        await writeAudit(client, context, 'campaign', id, 'campaign.updated', before, updated);
        await writeDomainEvent(
          client,
          context,
          'campaign',
          id,
          'marketing_ops.campaign.updated.v1',
          updated
        );
        return updated;
      }
    );
  });
}

export async function appendCampaignNote(
  context: CampaignCommandContext,
  id: string,
  expectedVersion: number,
  note: string,
  idempotencyKey: string
): Promise<Campaign> {
  authorize(context.actor, 'campaign.update');
  const parsedNote = z.string().trim().min(1).max(2_000).parse(note);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const preflight = await visibleCampaign(client, id);
    assertCurrentEditAuthority(context, preflight);
    return executeIdempotentCommand(
      client,
      context,
      `campaign.note_add:${id}`,
      idempotencyKey,
      { id, expectedVersion, note: parsedNote },
      async () => {
        const beforeRow = await lockCampaign(client, id);
        assertExpectedVersion(beforeRow, expectedVersion);
        const before = mapCampaign(beforeRow);
        const notes = appendCampaignNoteText(before.notes, parsedNote);
        const result = await client.query<CampaignRow>(`
          update marketing_ops.campaigns
          set notes = $2, version = version + 1, updated_by = $3
          where id = $1 and version = $4
          returning *
        `, [id, notes, context.actor.userId, expectedVersion]);
        if (!result.rows[0]) {
          throw appError('version_conflict', 409, 'Campaign version is stale', {
            currentVersion: before.version
          });
        }
        const updated = mapCampaign(result.rows[0]);
        await writeAudit(client, context, 'campaign', id, 'campaign.note_added',
          { version: before.version }, { version: updated.version, noteAdded: true });
        await writeDomainEvent(
          client,
          context,
          'campaign',
          id,
          'marketing_ops.campaign.note_added.v1',
          { campaignId: id, version: updated.version }
        );
        return updated;
      }
    );
  });
}

export function appendCampaignNoteText(current: string | null, note: string): string {
  const parsedNote = z.string().trim().min(1).max(2_000).parse(note);
  const notes = current ? `${current}\n\n${parsedNote}` : parsedNote;
  if (notes.length > 10_000) {
    throw appError('validation_error', 400, 'Campaign notes cannot exceed 10000 characters');
  }
  return notes;
}

async function changeCampaignStatus(
  context: CommandContext,
  id: string,
  expectedVersion: number,
  to: CampaignStatus,
  idempotencyKey: string,
  operation: 'transition' | 'archive'
): Promise<Campaign> {
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const preflight = await visibleCampaign(client, id);
    assertCurrentStatusAuthority(context, preflight, operation);
    return executeIdempotentCommand(
      client,
      context,
      `campaign.${operation}:${id}`,
      idempotencyKey,
      { id, expectedVersion, to },
      async () => {
        const visible = await visibleCampaign(client, id);
        assertTransitionAllowed(
          context.actor,
          participantAuthority(visible),
          visible.status,
          to
        );

        const beforeRow = await lockCampaign(client, id);
        assertExpectedVersion(beforeRow, expectedVersion);
        assertTransitionAllowed(
          context.actor,
          participantAuthority(beforeRow),
          beforeRow.status,
          to
        );
        const before = mapCampaign(beforeRow);
        if (to === 'planned' || to === 'active') {
          validatePlanningReadiness(planningReadiness(before, beforeRow.has_primary_owner));
        }

        const result = await client.query<CampaignRow>(`
          update marketing_ops.campaigns
          set status = $2::marketing_ops.campaign_status,
              archived_at = case when $2::text = 'archived' then now() else null end,
              version = version + 1,
              updated_by = $3
          where id = $1 and version = $4
          returning *
        `, [id, to, context.actor.userId, expectedVersion]);
        if (!result.rows[0]) {
          throw appError('version_conflict', 409, 'Campaign version is stale', {
            currentVersion: before.version
          });
        }
        const updated = mapCampaign(result.rows[0]);
        const action = to === 'archived' ? 'campaign.archived' : 'campaign.status_changed';
        const eventType = to === 'archived'
          ? 'marketing_ops.campaign.archived.v1'
          : 'marketing_ops.campaign.status_changed.v1';
        await writeAudit(client, context, 'campaign', id, action, before, updated);
        await writeDomainEvent(client, context, 'campaign', id, eventType, {
          campaignId: id,
          from: before.status,
          to: updated.status,
          version: updated.version
        });
        return updated;
      }
    );
  });
}

export async function transitionCampaign(
  context: CommandContext,
  id: string,
  expectedVersion: number,
  to: CampaignStatus,
  idempotencyKey: string
): Promise<Campaign> {
  return changeCampaignStatus(context, id, expectedVersion, to, idempotencyKey, 'transition');
}

export async function archiveCampaign(
  context: CommandContext,
  id: string,
  expectedVersion: number,
  idempotencyKey: string
): Promise<Campaign> {
  return changeCampaignStatus(context, id, expectedVersion, 'archived', idempotencyKey, 'archive');
}

export async function updateCampaignDraft(
  context: CampaignCommandContext,
  id: string,
  expectedVersion: number,
  input: { name: string; idempotencyKey: string }
): Promise<Campaign> {
  return updateCampaign(context, id, expectedVersion, input);
}
