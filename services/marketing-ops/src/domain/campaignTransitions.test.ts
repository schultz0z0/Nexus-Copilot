import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor.js';
import {
  archiveCampaign,
  createCampaignDraft,
  transitionCampaign,
  updateCampaign
} from './campaigns.js';

const pool = new pg.Pool({
  connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
});
const member: Actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantSlug: 'ens',
  role: 'member'
};
const manager: Actor = {
  userId: '22222222-2222-4222-8222-222222222222',
  tenantId: member.tenantId,
  tenantSlug: 'ens',
  role: 'manager'
};

afterAll(() => pool.end());

const context = (actor: Actor) => ({
  pool,
  actor,
  correlationId: randomUUID(),
  origin: 'rest' as const
});

async function readyDraft() {
  const draft = await createCampaignDraft(context(member), {
    name: 'Transition campaign',
    idempotencyKey: randomUUID()
  });
  return updateCampaign(context(member), draft.id, draft.version, {
    objective: 'Launch a verified product',
    referenceType: 'product',
    referenceTitleSnapshot: 'ENS Product',
    startsOn: '2026-08-01',
    endsOn: '2026-08-31',
    idempotencyKey: randomUUID()
  });
}

describe('campaign status commands', () => {
  it('advances a ready campaign through the normal state path', async () => {
    const draft = await readyDraft();
    const planned = await transitionCampaign(
      context(member), draft.id, draft.version, 'planned', randomUUID()
    );
    const active = await transitionCampaign(
      context(member), planned.id, planned.version, 'active', randomUUID()
    );
    const completed = await transitionCampaign(
      context(member), active.id, active.version, 'completed', randomUUID()
    );
    expect(completed).toMatchObject({ status: 'completed', version: 5 });
  });

  it('fails with stable readiness details before planning an incomplete draft', async () => {
    const draft = await createCampaignDraft(context(member), {
      name: 'Incomplete transition campaign',
      idempotencyKey: randomUUID()
    });
    await expect(transitionCampaign(
      context(member), draft.id, draft.version, 'planned', randomUUID()
    )).rejects.toMatchObject({
      code: 'campaign_requirements_missing',
      details: {
        fields: expect.arrayContaining([
          'objective', 'referenceType', 'referenceTitleSnapshot', 'startsOn', 'endsOn'
        ])
      }
    });
  });

  it('denies member reopen and allows manager reopen', async () => {
    const draft = await readyDraft();
    const planned = await transitionCampaign(
      context(member), draft.id, draft.version, 'planned', randomUUID()
    );
    await expect(transitionCampaign(
      context(member), planned.id, planned.version, 'draft', randomUUID()
    )).rejects.toMatchObject({ code: 'forbidden' });
    const reopened = await transitionCampaign(
      context(manager), planned.id, planned.version, 'draft', randomUUID()
    );
    expect(reopened).toMatchObject({ status: 'draft', version: planned.version + 1 });
  });

  it('archives any nonarchived state only through manager authority', async () => {
    const draft = await createCampaignDraft(context(member), {
      name: 'Archive campaign',
      idempotencyKey: randomUUID()
    });
    await expect(archiveCampaign(
      context(member), draft.id, draft.version, randomUUID()
    )).rejects.toMatchObject({ code: 'forbidden' });
    const archived = await archiveCampaign(
      context(manager), draft.id, draft.version, randomUUID()
    );
    expect(archived).toMatchObject({ status: 'archived', version: 2 });
    expect(archived.archivedAt).not.toBeNull();
    await expect(transitionCampaign(
      context(manager), archived.id, archived.version, 'completed', randomUUID()
    )).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});
