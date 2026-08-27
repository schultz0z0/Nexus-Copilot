import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor.js';
import { archiveCampaign, createCampaignDraft } from './campaigns.js';
import {
  cancelProductionItem,
  createProductionItem,
  getProductionItem,
  transitionProductionItem,
  updateProductionItem
} from './items.js';

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
const otherTenant: Actor = {
  userId: '44444444-4444-4444-8444-444444444444',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenantSlug: 'other',
  role: 'member'
};

afterAll(() => pool.end());

const context = (actor: Actor = member) => ({
  pool,
  actor,
  correlationId: randomUUID(),
  origin: 'rest' as const
});

async function campaign(name = 'Phase 3 item campaign') {
  return createCampaignDraft(context(), {
    name: `${name} ${randomUUID()}`,
    idempotencyKey: randomUUID()
  });
}

async function readyTask(campaignId: string) {
  return createProductionItem(context(), campaignId, {
    kind: 'task',
    title: 'Preparar material',
    assigneeUserId: member.userId,
    priority: 'high',
    channel: 'email',
    description: 'Material de abertura',
    startsAt: '2026-08-01T12:00:00.000Z',
    dueAt: '2026-08-02T12:00:00.000Z',
    metadata: { checklist: true },
    idempotencyKey: randomUUID()
  });
}

describe('production item CRUD', () => {
  it('creates, reads, audits, emits, and replays one canonical item', async () => {
    const parent = await campaign('Create item');
    const idempotencyKey = randomUUID();
    const input = {
      kind: 'email' as const,
      title: '  E-mail inicial  ',
      assigneeUserId: member.userId,
      priority: 'urgent' as const,
      channel: 'email' as const,
      description: '  Conteúdo confidencial  ',
      startsAt: '2026-08-01T09:00:00-03:00',
      dueAt: '2026-08-01T10:00:00-03:00',
      metadata: { subject: 'Oferta ENS' },
      idempotencyKey
    };

    const created = await createProductionItem(context(), parent.id, input);
    const replay = await createProductionItem(context(), parent.id, input);
    const read = await getProductionItem(context(), created.id);

    expect(created).toMatchObject({
      campaignId: parent.id,
      kind: 'email',
      title: 'E-mail inicial',
      status: 'draft',
      assigneeUserId: member.userId,
      priority: 'urgent',
      channel: 'email',
      description: 'Conteúdo confidencial',
      startsAt: '2026-08-01T12:00:00.000Z',
      dueAt: '2026-08-01T13:00:00.000Z',
      metadata: { subject: 'Oferta ENS' },
      version: 1
    });
    expect(replay.id).toBe(created.id);
    expect(read).toEqual(created);

    const evidence = await pool.query<{
      items: number; audits: number; events: number; serialized_audit: string;
    }>(`
      select
        (select count(*)::int from marketing_ops.campaign_items where id = $1) as items,
        (select count(*)::int from marketing_ops.audit_events where entity_id = $1) as audits,
        (select count(*)::int from marketing_ops.domain_events where aggregate_id = $1) as events,
        (select coalesce(jsonb_agg(after_state)::text, '[]')
          from marketing_ops.audit_events where entity_id = $1) as serialized_audit
    `, [created.id]);
    expect(evidence.rows[0]).toMatchObject({ items: 1, audits: 1, events: 1 });
    expect(evidence.rows[0]?.serialized_audit).not.toContain('Conteúdo confidencial');
    expect(evidence.rows[0]?.serialized_audit).not.toContain('Oferta ENS');
  });

  it('rejects invalid contracts, archived campaigns, and unauthorized assignees', async () => {
    const parent = await campaign('Validation item');
    await expect(createProductionItem(context(), parent.id, {
      kind: 'unknown',
      title: 'Invalid kind',
      idempotencyKey: randomUUID()
    } as never)).rejects.toMatchObject({ code: 'validation_error', status: 400 });

    await expect(createProductionItem(context(), parent.id, {
      kind: 'task',
      title: 'Invalid period',
      startsAt: '2026-08-02T12:00:00.000Z',
      dueAt: '2026-08-01T12:00:00.000Z',
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: 'validation_error', status: 400 });

    await expect(createProductionItem(context(), parent.id, {
      kind: 'task',
      title: 'Cross-tenant assignee',
      assigneeUserId: otherTenant.userId,
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: 'assignee_not_authorized', status: 422 });

    const archived = await archiveCampaign(
      context(manager), parent.id, parent.version, randomUUID()
    );
    expect(archived.status).toBe('archived');
    await expect(createProductionItem(context(manager), parent.id, {
      kind: 'task',
      title: 'Archived campaign item',
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: 'campaign_archived', status: 409 });
  });

  it('patches the complete editable shape and rejects stale or terminal writes', async () => {
    const parent = await campaign('Patch item');
    const item = await readyTask(parent.id);
    const updated = await updateProductionItem(context(), item.id, item.version, {
      title: '  Material revisado  ',
      priority: 'urgent',
      startsAt: '2026-08-03T12:00:00.000Z',
      dueAt: '2026-08-04T12:00:00.000Z',
      metadata: { revised: true },
      idempotencyKey: randomUUID()
    });
    expect(updated).toMatchObject({
      title: 'Material revisado',
      priority: 'urgent',
      startsAt: '2026-08-03T12:00:00.000Z',
      dueAt: '2026-08-04T12:00:00.000Z',
      metadata: { revised: true },
      version: 2
    });

    await expect(updateProductionItem(context(), item.id, item.version, {
      title: 'Stale',
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({
      code: 'version_conflict',
      status: 409,
      details: { currentVersion: 2 }
    });

    await expect(updateProductionItem(context(), updated.id, updated.version, {
      startsAt: '2026-08-05T12:00:00.000Z',
      dueAt: '2026-08-04T12:00:00.000Z',
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: 'validation_error', status: 400 });

    const cancelled = await cancelProductionItem(
      context(), updated.id, updated.version, randomUUID()
    );
    await expect(updateProductionItem(context(), cancelled.id, cancelled.version, {
      title: 'Terminal write',
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: 'item_terminal', status: 409 });
  });

  it('hides cross-tenant item identity', async () => {
    const parent = await campaign('Tenant isolation');
    const item = await readyTask(parent.id);
    await expect(getProductionItem(context(otherTenant), item.id))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});

describe('production item state machine', () => {
  it('applies every reversible edge and the normal completion path', async () => {
    const parent = await campaign('Transition item');
    const draft = await readyTask(parent.id);
    const ready = await transitionProductionItem(
      context(), draft.id, draft.version, 'ready', randomUUID()
    );
    const reopenedDraft = await transitionProductionItem(
      context(), ready.id, ready.version, 'draft', randomUUID()
    );
    const readyAgain = await transitionProductionItem(
      context(), reopenedDraft.id, reopenedDraft.version, 'ready', randomUUID()
    );
    const review = await transitionProductionItem(
      context(), readyAgain.id, readyAgain.version, 'in_review', randomUUID()
    );
    const returned = await transitionProductionItem(
      context(), review.id, review.version, 'ready', randomUUID()
    );
    const reviewAgain = await transitionProductionItem(
      context(), returned.id, returned.version, 'in_review', randomUUID()
    );
    const completed = await transitionProductionItem(
      context(), reviewAgain.id, reviewAgain.version, 'completed', randomUUID()
    );

    expect(completed).toMatchObject({ status: 'completed', version: 8 });
    expect(completed.completedAt).not.toBeNull();
    await expect(transitionProductionItem(
      context(), completed.id, completed.version, 'in_review', randomUUID()
    )).rejects.toMatchObject({ code: 'invalid_item_transition', status: 409 });
  });

  it('cancels from every nonterminal state and keeps cancellation terminal', async () => {
    const parent = await campaign('Cancel item');

    const draft = await readyTask(parent.id);
    const draftCancelled = await cancelProductionItem(
      context(), draft.id, draft.version, randomUUID()
    );
    expect(draftCancelled.cancelledAt).not.toBeNull();

    const second = await readyTask(parent.id);
    const ready = await transitionProductionItem(
      context(), second.id, second.version, 'ready', randomUUID()
    );
    expect((await cancelProductionItem(
      context(), ready.id, ready.version, randomUUID()
    )).status).toBe('cancelled');

    const third = await readyTask(parent.id);
    const thirdReady = await transitionProductionItem(
      context(), third.id, third.version, 'ready', randomUUID()
    );
    const review = await transitionProductionItem(
      context(), thirdReady.id, thirdReady.version, 'in_review', randomUUID()
    );
    expect((await cancelProductionItem(
      context(), review.id, review.version, randomUUID()
    )).status).toBe('cancelled');

    await expect(cancelProductionItem(
      context(), draftCancelled.id, draftCancelled.version, randomUUID()
    )).rejects.toMatchObject({ code: 'invalid_item_transition', status: 409 });
  });

  it('enforces readiness, editorial content, dependencies, authority, and replay', async () => {
    const parent = await campaign('Readiness item');
    const incomplete = await createProductionItem(context(), parent.id, {
      kind: 'task',
      title: 'Incomplete',
      idempotencyKey: randomUUID()
    });
    await expect(transitionProductionItem(
      context(), incomplete.id, incomplete.version, 'ready', randomUUID()
    )).rejects.toMatchObject({
      code: 'item_requirements_missing',
      status: 422,
      details: { fields: expect.arrayContaining(['assigneeUserId', 'dueAt']) }
    });

    const email = await createProductionItem(context(), parent.id, {
      kind: 'email',
      title: 'Editorial',
      assigneeUserId: member.userId,
      dueAt: '2026-08-02T12:00:00.000Z',
      idempotencyKey: randomUUID()
    });
    const emailReady = await transitionProductionItem(
      context(), email.id, email.version, 'ready', randomUUID()
    );
    await expect(transitionProductionItem(
      context(), emailReady.id, emailReady.version, 'in_review', randomUUID()
    )).rejects.toMatchObject({ code: 'item_content_required', status: 422 });

    const task = await readyTask(parent.id);
    await expect(transitionProductionItem(
      context(otherTenant), task.id, task.version, 'ready', randomUUID()
    )).rejects.toMatchObject({ code: 'not_found', status: 404 });

    const key = randomUUID();
    const first = await transitionProductionItem(
      context(), task.id, task.version, 'ready', key
    );
    const replay = await transitionProductionItem(
      context(), task.id, task.version, 'ready', key
    );
    expect(replay).toEqual(first);

    const evidence = await pool.query(`
      select
        (select count(*)::int from marketing_ops.audit_events
          where entity_id = $1 and action = 'campaign_item.status_changed') as audits,
        (select count(*)::int from marketing_ops.domain_events
          where aggregate_id = $1 and event_type = 'marketing_ops.campaign_item.status_changed.v1') as events
    `, [task.id]);
    expect(evidence.rows[0]).toEqual({ audits: 1, events: 1 });
  });
});
