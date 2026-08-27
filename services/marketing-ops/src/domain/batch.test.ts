import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor.js';
import { executeProductionBatch } from './batch.js';
import { createCampaignDraft } from './campaigns.js';
import { createProductionItem, getProductionItem, updateProductionItem } from './items.js';

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
const admin: Actor = {
  userId: '33333333-3333-4333-8333-333333333333',
  tenantId: member.tenantId,
  tenantSlug: 'ens',
  role: 'admin'
};

afterAll(() => pool.end());

const context = (actor: Actor = manager) => ({
  pool,
  actor,
  correlationId: randomUUID(),
  origin: 'rest' as const
});

async function batchItems(count = 3) {
  const campaign = await createCampaignDraft(context(member), {
    name: `Batch ${randomUUID()}`,
    idempotencyKey: randomUUID()
  });
  return Promise.all(Array.from({ length: count }, (_, index) =>
    createProductionItem(context(member), campaign.id, {
      kind: 'task',
      title: `Batch item ${index}`,
      assigneeUserId: member.userId,
      startsAt: '2026-08-01T12:00:00.000Z',
      dueAt: '2026-08-02T12:00:00.000Z',
      idempotencyKey: randomUUID()
    })
  ));
}

describe('safe production batch actions', () => {
  it('executes every reversible action in deterministic item order', async () => {
    const [priorityItem, assigneeItem, scheduleItem] = await batchItems();
    const priority = await executeProductionBatch(context(), {
      items: [{ itemId: priorityItem!.id, version: priorityItem!.version }],
      action: { type: 'priority', priority: 'urgent' },
      idempotencyKey: randomUUID()
    });
    const assignee = await executeProductionBatch(context(), {
      items: [{ itemId: assigneeItem!.id, version: assigneeItem!.version }],
      action: { type: 'reassign', assigneeUserId: admin.userId },
      idempotencyKey: randomUUID()
    });
    const schedule = await executeProductionBatch(context(), {
      items: [{ itemId: scheduleItem!.id, version: scheduleItem!.version }],
      action: {
        type: 'reschedule',
        startsAt: '2026-08-04T12:00:00.000Z',
        dueAt: '2026-08-05T12:00:00.000Z'
      },
      idempotencyKey: randomUUID()
    });

    expect(priority.results[0]).toMatchObject({
      ok: true,
      item: { priority: 'urgent', version: 2 }
    });
    expect(assignee.results[0]).toMatchObject({
      ok: true,
      item: { assigneeUserId: admin.userId, version: 2 }
    });
    expect(schedule.results[0]).toMatchObject({
      ok: true,
      item: {
        startsAt: '2026-08-04T12:00:00.000Z',
        dueAt: '2026-08-05T12:00:00.000Z',
        version: 2
      }
    });
  });

  it('reports partial version failures explicitly and replays without a second update', async () => {
    const [first, stale] = await batchItems(2);
    await updateProductionItem(context(member), stale!.id, stale!.version, {
      priority: 'high',
      idempotencyKey: randomUUID()
    });
    const idempotencyKey = randomUUID();
    const input = {
      items: [
        { itemId: stale!.id, version: stale!.version },
        { itemId: first!.id, version: first!.version }
      ],
      action: { type: 'priority' as const, priority: 'urgent' as const },
      idempotencyKey
    };

    const response = await executeProductionBatch(context(), input);
    const replay = await executeProductionBatch(context(), input);
    const firstAfter = await getProductionItem(context(member), first!.id);

    expect(response.results.map((result) => result.itemId)).toEqual(
      [first!.id, stale!.id].sort()
    );
    expect(response).toMatchObject({ succeeded: 1, failed: 1 });
    expect(response.results.find((result) => result.itemId === first!.id)).toMatchObject({
      ok: true
    });
    expect(response.results.find((result) => result.itemId === stale!.id)).toMatchObject({
      ok: false,
      error: { code: 'version_conflict', status: 409, currentVersion: 2 }
    });
    expect(replay).toEqual(response);
    expect(firstAfter).toMatchObject({ priority: 'urgent', version: 2 });
  });

  it('fails closed for members, duplicate items, and idempotency-key payload changes', async () => {
    const [item] = await batchItems(1);
    await expect(executeProductionBatch(context(member), {
      items: [{ itemId: item!.id, version: item!.version }],
      action: { type: 'priority', priority: 'high' },
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: 'forbidden', status: 403 });

    await expect(executeProductionBatch(context(), {
      items: [
        { itemId: item!.id, version: item!.version },
        { itemId: item!.id, version: item!.version }
      ],
      action: { type: 'priority', priority: 'high' },
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: 'validation_error', status: 400 });

    const idempotencyKey = randomUUID();
    await executeProductionBatch(context(), {
      items: [{ itemId: item!.id, version: item!.version }],
      action: { type: 'priority', priority: 'high' },
      idempotencyKey
    });
    await expect(executeProductionBatch(context(), {
      items: [{ itemId: item!.id, version: item!.version }],
      action: { type: 'priority', priority: 'low' },
      idempotencyKey
    })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
  });
});
