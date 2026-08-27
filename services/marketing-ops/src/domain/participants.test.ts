import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor.js';
import { createCampaignDraft } from './campaigns.js';
import {
  AddParticipantSchema,
  UpdateParticipantSchema,
  addParticipant,
  listParticipantCandidates,
  listParticipants,
  removeParticipant,
  updateParticipant
} from './participants.js';

const pool = new pg.Pool({
  connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
});
const memberId = '11111111-1111-4111-8111-111111111111';
const managerId = '22222222-2222-4222-8222-222222222222';
const adminId = '33333333-3333-4333-8333-333333333333';
const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const actor = (userId: string, role: Actor['role']): Actor => ({
  userId,
  tenantId,
  tenantSlug: 'ens',
  role
});
const context = (currentActor: Actor) => ({
  pool,
  actor: currentActor,
  correlationId: randomUUID(),
  origin: 'rest' as const
});

afterAll(() => pool.end());

describe('participant input contracts', () => {
  it('validates participant input and primary-owner consistency', () => {
    expect(AddParticipantSchema.parse({
      userId: managerId,
      memberRole: 'owner',
      isPrimary: true
    })).toEqual({ userId: managerId, memberRole: 'owner', isPrimary: true });
    expect(() => AddParticipantSchema.parse({
      userId: managerId,
      memberRole: 'editor',
      isPrimary: true
    })).toThrow();
    expect(() => UpdateParticipantSchema.parse({})).toThrow();
  });
});

describe('campaign participants', () => {
  it('moves primary ownership atomically and protects the last primary owner', async () => {
    const campaign = await createCampaignDraft(context(actor(memberId, 'member')), {
      name: 'Primary transfer campaign',
      idempotencyKey: randomUUID()
    });
    const idempotencyKey = randomUUID();
    const added = await addParticipant(context(actor(managerId, 'manager')), campaign.id, 1, {
      userId: managerId,
      memberRole: 'owner',
      isPrimary: true,
      idempotencyKey
    });
    const replayed = await addParticipant(context(actor(managerId, 'manager')), campaign.id, 1, {
      userId: managerId,
      memberRole: 'owner',
      isPrimary: true,
      idempotencyKey
    });
    expect(added.campaignVersion).toBe(2);
    expect(replayed).toEqual(added);
    const primaryOwners = await pool.query<{ user_id: string }>(`
      select user_id
      from marketing_ops.campaign_members
      where campaign_id = $1 and member_role = 'owner' and is_primary
    `, [campaign.id]);
    expect(primaryOwners.rows.map((row) => row.user_id)).toEqual([managerId]);
    await expect(removeParticipant(
      context(actor(managerId, 'manager')),
      campaign.id,
      managerId,
      2,
      randomUUID()
    )).rejects.toMatchObject({ code: 'primary_owner_required' });
  });

  it('allows a primary owner to manage viewer and editor participants', async () => {
    const campaign = await createCampaignDraft(context(actor(memberId, 'member')), {
      name: 'Owner participant campaign',
      idempotencyKey: randomUUID()
    });
    const added = await addParticipant(context(actor(memberId, 'member')), campaign.id, 1, {
      userId: managerId,
      memberRole: 'viewer',
      isPrimary: false,
      idempotencyKey: randomUUID()
    });
    const updated = await updateParticipant(context(actor(memberId, 'member')), campaign.id, managerId, 2, {
      memberRole: 'editor',
      idempotencyKey: randomUUID()
    });
    const removed = await removeParticipant(
      context(actor(memberId, 'member')),
      campaign.id,
      managerId,
      3,
      randomUUID()
    );
    expect(added.participant.memberRole).toBe('viewer');
    expect(updated.participant.memberRole).toBe('editor');
    expect(removed.campaignVersion).toBe(4);
  });

  it('allows only manager or admin to create or alter owners', async () => {
    const campaign = await createCampaignDraft(context(actor(memberId, 'member')), {
      name: 'Owner authority campaign',
      idempotencyKey: randomUUID()
    });
    await expect(addParticipant(context(actor(memberId, 'member')), campaign.id, 1, {
      userId: managerId,
      memberRole: 'owner',
      isPrimary: false,
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: 'forbidden' });
    const added = await addParticipant(context(actor(adminId, 'admin')), campaign.id, 1, {
      userId: managerId,
      memberRole: 'owner',
      isPrimary: false,
      idempotencyKey: randomUUID()
    });
    expect(added.participant).toMatchObject({ userId: managerId, memberRole: 'owner' });
  });

  it('lists safe participant and candidate projections without profile secrets', async () => {
    const campaign = await createCampaignDraft(context(actor(memberId, 'member')), {
      name: 'Participant directory campaign',
      idempotencyKey: randomUUID()
    });
    const participants = await listParticipants(context(actor(memberId, 'member')), campaign.id);
    const candidates = await listParticipantCandidates(
      context(actor(memberId, 'member')),
      campaign.id,
      { q: '', limit: 25 }
    );
    expect(participants[0]).toMatchObject({ userId: memberId, memberRole: 'owner', isPrimary: true });
    expect(participants[0]).not.toHaveProperty('email');
    expect(participants.every((participant) => !participant.displayName.includes('@'))).toBe(true);
    expect(candidates.some((candidate) => candidate.userId === managerId)).toBe(true);
    expect(candidates[0]).not.toHaveProperty('email');
    expect(candidates[0]).not.toHaveProperty('metadata');
    expect(candidates.every((candidate) => !candidate.displayName.includes('@'))).toBe(true);
  });

  it('fails closed for a same-tenant member who does not participate', async () => {
    const campaign = await createCampaignDraft(context(actor(managerId, 'manager')), {
      name: 'Nonparticipant visibility campaign',
      idempotencyKey: randomUUID()
    });
    await expect(listParticipants(
      context(actor(memberId, 'member')),
      campaign.id
    )).rejects.toMatchObject({ code: 'not_found' });
    await expect(addParticipant(context(actor(memberId, 'member')), campaign.id, 1, {
      userId: adminId,
      memberRole: 'viewer',
      isPrimary: false,
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: 'not_found' });
  });
});
