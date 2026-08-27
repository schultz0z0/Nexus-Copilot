import type { PoolClient } from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import { writeAudit } from './audit.js';
import type { CommandContext } from './context.js';
import { writeDomainEvent } from './events.js';
import { executeIdempotentCommand } from './idempotency.js';

export const ParticipantRoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

export const AddParticipantSchema = z.object({
  userId: z.string().uuid(),
  memberRole: ParticipantRoleSchema,
  isPrimary: z.boolean().default(false)
}).strict().superRefine((input, context) => {
  if (input.isPrimary && input.memberRole !== 'owner') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['isPrimary'],
      message: 'Only an owner can be the primary campaign owner'
    });
  }
});

export const UpdateParticipantSchema = z.object({
  memberRole: ParticipantRoleSchema.optional(),
  isPrimary: z.boolean().optional()
}).strict().superRefine((input, context) => {
  if (Object.keys(input).length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Participant update must include a role or primary flag'
    });
  }
  if (input.isPrimary && input.memberRole && input.memberRole !== 'owner') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['isPrimary'],
      message: 'Only an owner can be the primary campaign owner'
    });
  }
});

const CandidateQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  limit: z.number().int().min(1).max(100).default(25)
}).strict();

export interface CampaignParticipant {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  memberRole: ParticipantRole;
  isPrimary: boolean;
}

export interface ParticipantCandidate {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  tenantRole: 'member' | 'manager' | 'admin';
}

export interface ParticipantMutationResult {
  participant: CampaignParticipant;
  campaignVersion: number;
}

export interface ParticipantRemovalResult {
  removedUserId: string;
  campaignVersion: number;
}

interface ParticipantRecord {
  user_id: string;
  member_role: ParticipantRole;
  is_primary: boolean;
}

interface CampaignVersionRow {
  id: string;
  version: string | number;
}

async function listParticipantsInClient(
  client: PoolClient,
  campaignId: string
): Promise<CampaignParticipant[]> {
  const result = await client.query<CampaignParticipant>(`
    select
      user_id as "userId",
      display_name as "displayName",
      avatar_url as "avatarUrl",
      member_role::text as "memberRole",
      is_primary as "isPrimary"
    from marketing_ops_private.list_campaign_participants($1)
  `, [campaignId]);
  if (result.rows.length === 0) {
    const campaign = await client.query('select id from marketing_ops.campaigns where id = $1', [campaignId]);
    if (!campaign.rows[0]) throw appError('not_found', 404, 'Campaign not found');
  }
  return result.rows;
}

function assertParticipantManagementAuthority(
  context: CommandContext,
  participants: CampaignParticipant[],
  ownersOnly: boolean
): void {
  if (ownersOnly) {
    authorize(context.actor, 'participant.owner.manage');
    return;
  }
  authorize(context.actor, 'participant.manage');
  if (context.actor.role === 'manager' || context.actor.role === 'admin') return;
  const actorParticipant = participants.find((participant) =>
    participant.userId === context.actor.userId
  );
  if (!(actorParticipant?.memberRole === 'owner' && actorParticipant.isPrimary)) {
    throw appError('forbidden', 403, 'Primary campaign owner is required to manage participants');
  }
}

async function participantRecord(
  client: PoolClient,
  campaignId: string,
  userId: string,
  lockRow = false
): Promise<ParticipantRecord | null> {
  const result = await client.query<ParticipantRecord>(`
    select user_id, member_role::text as member_role, is_primary
    from marketing_ops.campaign_members
    where campaign_id = $1 and user_id = $2
    ${lockRow ? 'for update' : ''}
  `, [campaignId, userId]);
  return result.rows[0] ?? null;
}

async function lockParticipantAggregate(
  client: PoolClient,
  campaignId: string,
  expectedVersion: number,
  ownersOnly: boolean
): Promise<CampaignVersionRow> {
  const helper = ownersOnly
    ? 'can_administer_campaign_participants'
    : 'can_manage_campaign';
  const permission = await client.query<{ allowed: boolean }>(
    `select marketing_ops_private.${helper}($1) as allowed`,
    [campaignId]
  );
  if (permission.rows[0]?.allowed !== true) {
    throw appError('forbidden', 403, 'Campaign does not grant participant management authority');
  }
  const campaign = await client.query<CampaignVersionRow>(`
    select id, version
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
  return row;
}

async function incrementCampaignVersion(
  client: PoolClient,
  context: CommandContext,
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

async function projectedParticipant(
  client: PoolClient,
  campaignId: string,
  userId: string
): Promise<CampaignParticipant> {
  const participants = await listParticipantsInClient(client, campaignId);
  const participant = participants.find((candidate) => candidate.userId === userId);
  if (!participant) throw appError('participant_not_found', 404, 'Campaign participant not found');
  return participant;
}

export async function listParticipants(
  context: CommandContext,
  campaignId: string
): Promise<CampaignParticipant[]> {
  authorize(context.actor, 'campaign.read');
  return withActorTransaction(context.pool, context.actor, context.correlationId, (client) =>
    listParticipantsInClient(client, campaignId)
  );
}

export async function listParticipantCandidates(
  context: CommandContext,
  campaignId: string,
  input: { q?: string; limit?: number }
): Promise<ParticipantCandidate[]> {
  const query = CandidateQuerySchema.parse(input);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const participants = await listParticipantsInClient(client, campaignId);
    assertParticipantManagementAuthority(context, participants, false);
    const result = await client.query<ParticipantCandidate>(`
      select
        user_id as "userId",
        display_name as "displayName",
        avatar_url as "avatarUrl",
        tenant_role::text as "tenantRole"
      from marketing_ops_private.list_campaign_participant_candidates($1, $2, $3)
    `, [campaignId, query.q || null, query.limit]);
    return result.rows;
  });
}

export async function addParticipant(
  context: CommandContext,
  campaignId: string,
  expectedVersion: number,
  input: z.input<typeof AddParticipantSchema> & { idempotencyKey: string }
): Promise<ParticipantMutationResult> {
  const { idempotencyKey, ...candidate } = input;
  const participantInput = AddParticipantSchema.parse(candidate);
  const ownersOnly = participantInput.memberRole === 'owner' || participantInput.isPrimary;

  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const participants = await listParticipantsInClient(client, campaignId);
    assertParticipantManagementAuthority(context, participants, ownersOnly);
    return executeIdempotentCommand(
      client,
      context,
      `campaign.participant.add:${campaignId}`,
      idempotencyKey,
      { campaignId, expectedVersion, ...participantInput },
      async () => {
        await lockParticipantAggregate(client, campaignId, expectedVersion, ownersOnly);
        const existing = await participantRecord(client, campaignId, participantInput.userId, true);
        if (existing) {
          throw appError('participant_exists', 409, 'User already participates in campaign');
        }
        const eligible = await client.query<{ allowed: boolean }>(
          'select marketing_ops_private.is_campaign_participant_candidate($1, $2) as allowed',
          [campaignId, participantInput.userId]
        );
        if (eligible.rows[0]?.allowed !== true) {
          throw appError('participant_not_found', 404, 'Active tenant participant candidate not found');
        }
        if (participantInput.isPrimary) {
          await client.query(`
            update marketing_ops.campaign_members
            set is_primary = false
            where campaign_id = $1 and is_primary
          `, [campaignId]);
        }
        await client.query(`
          insert into marketing_ops.campaign_members (
            tenant_id, campaign_id, user_id, member_role, is_primary, created_by
          ) values ($1, $2, $3, $4, $5, $6)
        `, [
          context.actor.tenantId,
          campaignId,
          participantInput.userId,
          participantInput.memberRole,
          participantInput.isPrimary,
          context.actor.userId
        ]);
        const campaignVersion = await incrementCampaignVersion(client, context, campaignId);
        const participant = await projectedParticipant(client, campaignId, participantInput.userId);
        await writeAudit(client, context, 'campaign', campaignId, 'participant.added', null, {
          participant,
          campaignVersion
        });
        await writeDomainEvent(client, context, 'campaign', campaignId, 'marketing_ops.campaign.participant_added.v1', {
          campaignId,
          participant,
          campaignVersion
        });
        return { participant, campaignVersion };
      }
    );
  });
}

export async function updateParticipant(
  context: CommandContext,
  campaignId: string,
  userId: string,
  expectedVersion: number,
  input: z.input<typeof UpdateParticipantSchema> & { idempotencyKey: string }
): Promise<ParticipantMutationResult> {
  const { idempotencyKey, ...candidate } = input;
  const patch = UpdateParticipantSchema.parse(candidate);

  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const participants = await listParticipantsInClient(client, campaignId);
    const visibleTarget = participants.find((participant) => participant.userId === userId);
    const ownersOnly = visibleTarget?.memberRole === 'owner' || patch.memberRole === 'owner' || patch.isPrimary === true;
    assertParticipantManagementAuthority(context, participants, ownersOnly);
    return executeIdempotentCommand(
      client,
      context,
      `campaign.participant.update:${campaignId}:${userId}`,
      idempotencyKey,
      { campaignId, userId, expectedVersion, patch },
      async () => {
        const beforeProbe = await participantRecord(client, campaignId, userId);
        if (!beforeProbe) throw appError('participant_not_found', 404, 'Campaign participant not found');
        const requiresAdmin = beforeProbe.member_role === 'owner' || patch.memberRole === 'owner' || patch.isPrimary === true;
        await lockParticipantAggregate(client, campaignId, expectedVersion, requiresAdmin);
        const before = await participantRecord(client, campaignId, userId, true);
        if (!before) throw appError('participant_not_found', 404, 'Campaign participant not found');
        const actualRequiresAdmin = before.member_role === 'owner' || patch.memberRole === 'owner' || patch.isPrimary === true;
        if (actualRequiresAdmin && !requiresAdmin) {
          await lockParticipantAggregate(client, campaignId, expectedVersion, true);
        }
        const nextRole = patch.memberRole ?? before.member_role;
        const nextPrimary = patch.isPrimary ?? before.is_primary;
        if (nextPrimary && nextRole !== 'owner') {
          throw appError('participant_role_invalid', 422, 'Primary participant must be an owner');
        }
        if (before.is_primary && (!nextPrimary || nextRole !== 'owner')) {
          throw appError('primary_owner_required', 409, 'Transfer primary ownership before changing this participant');
        }
        if (nextPrimary && !before.is_primary) {
          await client.query(`
            update marketing_ops.campaign_members
            set is_primary = false
            where campaign_id = $1 and is_primary
          `, [campaignId]);
        }
        const mutation = await client.query(`
          update marketing_ops.campaign_members
          set member_role = $3, is_primary = $4
          where campaign_id = $1 and user_id = $2
        `, [campaignId, userId, nextRole, nextPrimary]);
        if (mutation.rowCount !== 1) {
          throw appError('forbidden', 403, 'Participant update was rejected');
        }
        const campaignVersion = await incrementCampaignVersion(client, context, campaignId);
        const participant = await projectedParticipant(client, campaignId, userId);
        await writeAudit(client, context, 'campaign', campaignId, 'participant.updated', {
          userId: before.user_id,
          memberRole: before.member_role,
          isPrimary: before.is_primary
        }, { participant, campaignVersion });
        await writeDomainEvent(client, context, 'campaign', campaignId, 'marketing_ops.campaign.participant_updated.v1', {
          campaignId,
          participant,
          campaignVersion
        });
        return { participant, campaignVersion };
      }
    );
  });
}

export async function removeParticipant(
  context: CommandContext,
  campaignId: string,
  userId: string,
  expectedVersion: number,
  idempotencyKey: string
): Promise<ParticipantRemovalResult> {
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const participants = await listParticipantsInClient(client, campaignId);
    const visibleTarget = participants.find((participant) => participant.userId === userId);
    assertParticipantManagementAuthority(context, participants, visibleTarget?.memberRole === 'owner');
    return executeIdempotentCommand(
      client,
      context,
      `campaign.participant.remove:${campaignId}:${userId}`,
      idempotencyKey,
      { campaignId, userId, expectedVersion },
      async () => {
        const beforeProbe = await participantRecord(client, campaignId, userId);
        if (!beforeProbe) throw appError('participant_not_found', 404, 'Campaign participant not found');
        const requiresAdmin = beforeProbe.member_role === 'owner';
        await lockParticipantAggregate(
          client,
          campaignId,
          expectedVersion,
          requiresAdmin
        );
        const before = await participantRecord(client, campaignId, userId, true);
        if (!before) throw appError('participant_not_found', 404, 'Campaign participant not found');
        if (before.member_role === 'owner' && !requiresAdmin) {
          await lockParticipantAggregate(client, campaignId, expectedVersion, true);
        }
        if (before.is_primary) {
          throw appError('primary_owner_required', 409, 'Transfer primary ownership before removing this participant');
        }
        const mutation = await client.query(`
          delete from marketing_ops.campaign_members
          where campaign_id = $1 and user_id = $2
        `, [campaignId, userId]);
        if (mutation.rowCount !== 1) {
          throw appError('forbidden', 403, 'Participant removal was rejected');
        }
        const campaignVersion = await incrementCampaignVersion(client, context, campaignId);
        await writeAudit(client, context, 'campaign', campaignId, 'participant.removed', {
          userId: before.user_id,
          memberRole: before.member_role,
          isPrimary: before.is_primary
        }, { campaignVersion });
        await writeDomainEvent(client, context, 'campaign', campaignId, 'marketing_ops.campaign.participant_removed.v1', {
          campaignId,
          userId,
          campaignVersion
        });
        return { removedUserId: userId, campaignVersion };
      }
    );
  });
}
