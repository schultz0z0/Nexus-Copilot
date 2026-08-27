import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from './auth/actor.js';
import {
  createCampaignDraft,
  updateCampaign,
  updateCampaignDraft
} from './domain/campaigns.js';
import { hashCanonicalPayload } from './domain/hash.js';
import { createCampaignItemDraft, updateCampaignItemDraft } from './domain/items.js';
import { getCampaign, listCampaigns } from './domain/queries.js';

const pool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres' });
const actor: Actor = { userId: '11111111-1111-4111-8111-111111111111', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'member' };
afterAll(() => pool.end());

function context() {
  return { pool, actor, correlationId: randomUUID(), origin: 'rest' as const };
}

describe('idempotent draft domain', () => {
  it('hashes semantically identical objects equally', () => {
    expect(hashCanonicalPayload({ b: 2, a: { y: 2, x: 1 } })).toBe(hashCanonicalPayload({ a: { x: 1, y: 2 }, b: 2 }));
  });

  it('replays the same command and rejects a divergent payload', async () => {
    const idempotencyKey = randomUUID();
    const first = await createCampaignDraft(context(), { name: 'Idempotent campaign', idempotencyKey });
    const replay = await createCampaignDraft(context(), { name: 'Idempotent campaign', idempotencyKey });
    expect(replay.id).toBe(first.id);
    await expect(createCampaignDraft(context(), { name: 'Different campaign', idempotencyKey })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const counts = await pool.query(`
      select
        (select count(*)::int from marketing_ops.campaigns where id = $1) as campaigns,
        (select count(*)::int from marketing_ops.audit_events where entity_id = $1) as audits,
        (select count(*)::int from marketing_ops.domain_events where aggregate_id = $1) as events
    `, [first.id]);
    expect(counts.rows[0]).toEqual({ campaigns: 1, audits: 1, events: 1 });
  });

  it('creates a name-only draft with the creator as primary owner', async () => {
    const campaign = await createCampaignDraft(context(), {
      name: 'Progressive draft',
      idempotencyKey: randomUUID()
    });
    const owner = await pool.query(`
      select member_role::text as "memberRole", is_primary as "isPrimary"
      from marketing_ops.campaign_members
      where campaign_id = $1 and user_id = $2
    `, [campaign.id, actor.userId]);
    expect(campaign).toMatchObject({ name: 'Progressive draft', status: 'draft', version: 1 });
    expect(owner.rows[0]).toEqual({ memberRole: 'owner', isPrimary: true });
  });

  it('rejects stale versions without modifying the campaign', async () => {
    const campaign = await createCampaignDraft(context(), { name: 'Versioned campaign', idempotencyKey: randomUUID() });
    const updated = await updateCampaignDraft(context(), campaign.id, 1, { name: 'Version two', idempotencyKey: randomUUID() });
    expect(updated.version).toBe(2);
    await expect(updateCampaignDraft(context(), campaign.id, 1, { name: 'Stale write', idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'version_conflict' });
    const row = await pool.query('select name, version::int from marketing_ops.campaigns where id = $1', [campaign.id]);
    expect(row.rows[0]).toMatchObject({ name: 'Version two', version: 2 });
  });

  it('patches the complete operational shape and returns the current version on conflict', async () => {
    const campaign = await createCampaignDraft(context(), {
      name: 'Complete patch campaign',
      idempotencyKey: randomUUID()
    });
    const updated = await updateCampaign(context(), campaign.id, campaign.version, {
      name: 'Complete campaign',
      objective: 'Increase awareness',
      referenceType: 'product',
      referenceKey: 'product-2026',
      referenceTitleSnapshot: 'Product 2026',
      referenceDocumentId: null,
      audience: 'Marketing leaders',
      startsOn: '2026-08-01',
      endsOn: '2026-08-31',
      primaryChannel: 'email',
      secondaryChannels: ['instagram', 'linkedin'],
      briefing: 'Operational briefing',
      notes: 'Weekly follow-up',
      idempotencyKey: randomUUID()
    });
    expect(updated).toMatchObject({
      name: 'Complete campaign',
      objective: 'Increase awareness',
      referenceType: 'product',
      primaryChannel: 'email',
      secondaryChannels: ['instagram', 'linkedin'],
      version: 2
    });
    await expect(updateCampaign(context(), campaign.id, 1, {
      notes: 'Stale patch',
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({
      code: 'version_conflict',
      details: { currentVersion: 2 }
    });
  });

  it('persists only the canonical course reference verified by the RAG adapter', async () => {
    const campaign = await createCampaignDraft(context(), {
      name: 'Course reference campaign',
      idempotencyKey: randomUUID()
    });
    const documentId = '22222222-2222-4222-8222-222222222222';
    const verifyCourseReference = vi.fn().mockResolvedValue({
      referenceKey: 'ENS-123',
      title: 'Curso oficial ENS',
      documentId,
      verifiedAt: '2026-07-14T12:45:00.000Z'
    });
    const updated = await updateCampaign(
      { ...context(), courseReferences: { verifyCourseReference } },
      campaign.id,
      campaign.version,
      {
        referenceType: 'course',
        referenceKey: 'ENS-123',
        referenceTitleSnapshot: 'Titulo enviado pelo cliente',
        referenceDocumentId: documentId,
        idempotencyKey: randomUUID()
      }
    );
    expect(updated).toMatchObject({
      referenceType: 'course',
      referenceKey: 'ENS-123',
      referenceTitleSnapshot: 'Curso oficial ENS',
      referenceDocumentId: documentId,
      referenceVerifiedAt: '2026-07-14T12:45:00.000Z',
      version: 2
    });
    expect(verifyCourseReference).toHaveBeenCalledWith(documentId, 'ENS-123');
  });

  it('searches and combines operational campaign filters with stable pagination', async () => {
    const uniqueSearchToken = `alpha-${randomUUID().slice(0, 8)}`;
    const campaign = await createCampaignDraft(context(), {
      name: `Searchable ${uniqueSearchToken} Campaign`,
      idempotencyKey: randomUUID()
    });
    await updateCampaign(context(), campaign.id, campaign.version, {
      referenceType: 'initiative',
      referenceTitleSnapshot: `Nexus Initiative ${uniqueSearchToken}`,
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
      primaryChannel: 'linkedin',
      secondaryChannels: ['email'],
      idempotencyKey: randomUUID()
    });

    const result = await listCampaigns(context(), {
      q: uniqueSearchToken,
      referenceType: 'initiative',
      channel: 'email',
      responsibleId: actor.userId,
      periodFrom: '2026-09-15',
      periodTo: '2026-09-20',
      limit: 1
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: campaign.id,
      name: `Searchable ${uniqueSearchToken} Campaign`,
      responsibles: [{ userId: actor.userId, isPrimary: true }],
      attention: []
    });
    expect(result.nextCursor).toBeNull();
    expect(await getCampaign(context(), campaign.id)).toMatchObject({
      id: campaign.id,
      referenceTitleSnapshot: `Nexus Initiative ${uniqueSearchToken}`
    });
  });

  it('creates and version-updates a campaign item', async () => {
    const campaign = await createCampaignDraft(context(), { name: 'Item campaign', idempotencyKey: randomUUID() });
    const item = await createCampaignItemDraft(context(), campaign.id, { kind: 'task', title: 'Draft', content: { text: 'one' }, idempotencyKey: randomUUID() });
    const updated = await updateCampaignItemDraft(context(), campaign.id, item.id, 1, { title: 'Draft two', content: { text: 'two' }, idempotencyKey: randomUUID() });
    expect(updated).toMatchObject({ id: item.id, version: 2, title: 'Draft two' });
  });

  it('rolls back entity, audit, event and idempotency on an injected failure', async () => {
    const idempotencyKey = randomUUID();
    const correlationId = randomUUID();
    await expect(createCampaignDraft({
      ...context(),
      correlationId,
      faultInjector: async (point: string) => { if (point === 'after_entity') throw new Error('injected failure'); }
    }, { name: 'Atomic campaign', idempotencyKey })).rejects.toThrow('injected failure');
    const counts = await pool.query(`
      select
        (select count(*)::int from marketing_ops.campaigns where name = 'Atomic campaign') as campaigns,
        (select count(*)::int from marketing_ops.audit_events where correlation_id = $1) as audits,
        (select count(*)::int from marketing_ops.domain_events where correlation_id = $1) as events,
        (select count(*)::int from marketing_ops.idempotency_records where idempotency_key = $2) as idempotency
    `, [correlationId, idempotencyKey]);
    expect(counts.rows[0]).toEqual({ campaigns: 0, audits: 0, events: 0, idempotency: 0 });
  });
});
