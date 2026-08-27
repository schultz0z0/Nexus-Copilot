import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor.js';
import { createCampaignDraft } from './campaigns.js';
import {
  addItemDependency,
  listItemDependencies,
  removeItemDependency
} from './dependencies.js';
import {
  cancelProductionItem,
  createProductionItem,
  getProductionItem,
  transitionProductionItem
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

async function createCampaign(actor: Actor = member) {
  return createCampaignDraft(context(actor), {
    name: `Dependency campaign ${randomUUID()}`,
    idempotencyKey: randomUUID()
  });
}

async function createTask(campaignId: string, actor: Actor = member) {
  return createProductionItem(context(actor), campaignId, {
    kind: 'task',
    title: `Dependency task ${randomUUID()}`,
    assigneeUserId: actor.userId,
    dueAt: '2027-08-01T12:00:00.000Z',
    idempotencyKey: randomUUID()
  });
}

describe('item dependency commands', () => {
  it('adds, lists, removes, audits, emits, versions, and replays one edge', async () => {
    const campaign = await createCampaign();
    const dependent = await createTask(campaign.id);
    const predecessor = await createTask(campaign.id);
    const addKey = randomUUID();

    const added = await addItemDependency(
      context(),
      dependent.id,
      predecessor.id,
      dependent.version,
      addKey
    );
    const replay = await addItemDependency(
      context(),
      dependent.id,
      predecessor.id,
      dependent.version,
      addKey
    );
    const listed = await listItemDependencies(context(), dependent.id);

    expect(added).toMatchObject({
      itemId: dependent.id,
      dependsOnItemId: predecessor.id,
      itemVersion: 2,
      isBlocking: true
    });
    expect(replay).toEqual(added);
    expect(listed).toEqual([
      expect.objectContaining({
        itemId: dependent.id,
        dependsOnItemId: predecessor.id,
        predecessorTitle: predecessor.title,
        predecessorStatus: 'draft',
        isBlocking: true
      })
    ]);

    await expect(removeItemDependency(
      context(),
      dependent.id,
      predecessor.id,
      1,
      randomUUID()
    )).rejects.toMatchObject({
      code: 'version_conflict',
      status: 409,
      details: { currentVersion: 2 }
    });
    expect(await listItemDependencies(context(), dependent.id)).toHaveLength(1);

    const removeKey = randomUUID();
    const removed = await removeItemDependency(
      context(),
      dependent.id,
      predecessor.id,
      2,
      removeKey
    );
    const removedReplay = await removeItemDependency(
      context(),
      dependent.id,
      predecessor.id,
      2,
      removeKey
    );
    expect(removed).toMatchObject({
      itemId: dependent.id,
      dependsOnItemId: predecessor.id,
      itemVersion: 3,
      removed: true
    });
    expect(removedReplay).toEqual(removed);
    expect(await listItemDependencies(context(), dependent.id)).toEqual([]);

    const evidence = await pool.query<{
      dependency_count: number;
      audit_count: number;
      event_count: number;
    }>(`
      select
        (select count(*)::int from marketing_ops.item_dependencies
          where item_id = $1 and depends_on_item_id = $2) as dependency_count,
        (select count(*)::int from marketing_ops.audit_events
          where entity_id = $1
            and action in ('item_dependency.added', 'item_dependency.removed')) as audit_count,
        (select count(*)::int from marketing_ops.domain_events
          where aggregate_id = $1
            and event_type like 'marketing_ops.item_dependency.%') as event_count
    `, [dependent.id, predecessor.id]);
    expect(evidence.rows[0]).toEqual({
      dependency_count: 0,
      audit_count: 2,
      event_count: 2
    });
    expect((await getProductionItem(context(), dependent.id)).version).toBe(3);
  });

  it('rejects self, duplicate, cross-campaign, cross-tenant, terminal, and unauthorized edges', async () => {
    const campaign = await createCampaign();
    const dependent = await createTask(campaign.id);
    const predecessor = await createTask(campaign.id);

    await expect(addItemDependency(
      context(), dependent.id, dependent.id, 1, randomUUID()
    )).rejects.toMatchObject({ code: 'dependency_self', status: 422 });

    await addItemDependency(
      context(), dependent.id, predecessor.id, 1, randomUUID()
    );
    await expect(addItemDependency(
      context(), dependent.id, predecessor.id, 2, randomUUID()
    )).rejects.toMatchObject({ code: 'dependency_exists', status: 409 });

    const secondCampaign = await createCampaign();
    const externalItem = await createTask(secondCampaign.id);
    await expect(addItemDependency(
      context(), dependent.id, externalItem.id, 2, randomUUID()
    )).rejects.toMatchObject({ code: 'dependency_campaign_mismatch', status: 422 });

    await expect(addItemDependency(
      context(otherTenant), dependent.id, predecessor.id, 2, randomUUID()
    )).rejects.toMatchObject({ code: 'not_found', status: 404 });

    const managerCampaign = await createCampaign(manager);
    const managerDependent = await createTask(managerCampaign.id, manager);
    const managerPredecessor = await createTask(managerCampaign.id, manager);
    await expect(addItemDependency(
      context(), managerDependent.id, managerPredecessor.id, 1, randomUUID()
    )).rejects.toMatchObject({ code: 'not_found', status: 404 });

    await cancelProductionItem(
      context(), dependent.id, 2, randomUUID()
    );
    await expect(removeItemDependency(
      context(), dependent.id, predecessor.id, 3, randomUUID()
    )).rejects.toMatchObject({ code: 'item_terminal', status: 409 });

    const activeDependent = await createTask(campaign.id);
    const terminalPredecessor = await createTask(campaign.id);
    await cancelProductionItem(
      context(), terminalPredecessor.id, 1, randomUUID()
    );
    await expect(addItemDependency(
      context(), activeDependent.id, terminalPredecessor.id, 1, randomUUID()
    )).rejects.toMatchObject({ code: 'dependency_terminal', status: 409 });
  }, 15_000);

  it('rejects an indirect cycle without changing versions or existing edges', async () => {
    const campaign = await createCampaign();
    const itemA = await createTask(campaign.id);
    const itemB = await createTask(campaign.id);
    const itemC = await createTask(campaign.id);

    await addItemDependency(context(), itemA.id, itemB.id, 1, randomUUID());
    await addItemDependency(context(), itemB.id, itemC.id, 1, randomUUID());
    await expect(addItemDependency(
      context(), itemC.id, itemA.id, 1, randomUUID()
    )).rejects.toMatchObject({ code: 'dependency_cycle', status: 409 });

    expect(await listItemDependencies(context(), itemA.id)).toHaveLength(1);
    expect(await listItemDependencies(context(), itemB.id)).toHaveLength(1);
    expect(await listItemDependencies(context(), itemC.id)).toEqual([]);
    expect((await getProductionItem(context(), itemC.id)).version).toBe(1);
  });

  it('derives blocking from the live predecessor status', async () => {
    const campaign = await createCampaign();
    const dependent = await createTask(campaign.id);
    const predecessor = await createTask(campaign.id);
    await addItemDependency(
      context(), dependent.id, predecessor.id, 1, randomUUID()
    );

    expect((await listItemDependencies(context(), dependent.id))[0]?.isBlocking)
      .toBe(true);

    const ready = await transitionProductionItem(
      context(), predecessor.id, 1, 'ready', randomUUID()
    );
    const review = await transitionProductionItem(
      context(), predecessor.id, ready.version, 'in_review', randomUUID()
    );
    await transitionProductionItem(
      context(), predecessor.id, review.version, 'completed', randomUUID()
    );

    expect((await listItemDependencies(context(), dependent.id))[0])
      .toMatchObject({ predecessorStatus: 'completed', isBlocking: false });
  });
});
