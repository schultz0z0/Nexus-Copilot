import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor.js';
import { archiveCampaign, createCampaignDraft } from './campaigns.js';
import { createProductionItem } from './items.js';
import {
  listInAppNotifications,
  markInAppNotificationsRead,
  projectInAppNotifications
} from './notifications.js';

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
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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

async function createNotificationCampaign(actor: Actor = member) {
  return createCampaignDraft(context(actor), {
    name: `Notifications ${randomUUID()}`,
    idempotencyKey: randomUUID()
  });
}

describe('in-app notification projection', () => {
  it('ignores assigned items from archived campaigns', async () => {
    const campaign = await createNotificationCampaign(manager);
    const item = await createProductionItem(context(manager), campaign.id, {
      kind: 'task',
      title: 'Archived notification fixture',
      assigneeUserId: manager.userId,
      dueAt: '2026-08-02T12:00:00.000Z',
      idempotencyKey: randomUUID()
    });
    await archiveCampaign(context(manager), campaign.id, campaign.version, randomUUID());

    await expect(projectInAppNotifications(
      context(manager),
      new Date('2026-08-01T12:00:00.000Z')
    )).resolves.toEqual(expect.objectContaining({ produced: expect.any(Number) }));
    const notifications = await listInAppNotifications(context(manager), { limit: 100 });

    expect(notifications.data.some((notification) => notification.itemId === item.id)).toBe(false);
  });

  it('projects assignment, due-soon, and overdue events once with an allowlisted payload', async () => {
    const campaign = await createNotificationCampaign();
    const confidential = `SEGREDO-${randomUUID()}`;
    const dueSoon = await createProductionItem(context(), campaign.id, {
      kind: 'task',
      title: confidential,
      description: confidential,
      assigneeUserId: member.userId,
      startsAt: '2026-08-01T12:00:00.000Z',
      dueAt: '2026-08-02T12:00:00.000Z',
      idempotencyKey: randomUUID()
    });
    const overdue = await createProductionItem(context(), campaign.id, {
      kind: 'email',
      title: confidential,
      description: confidential,
      assigneeUserId: member.userId,
      dueAt: '2026-07-31T12:00:00.000Z',
      idempotencyKey: randomUUID()
    });

    const now = new Date('2026-08-01T12:00:00.000Z');
    const first = await projectInAppNotifications(context(), now);
    await projectInAppNotifications(context(), now);
    const page = await listInAppNotifications(context(), { limit: 100 });
    const relevant = page.data.filter((notification) =>
      notification.itemId === dueSoon.id || notification.itemId === overdue.id
    );

    expect(first.produced).toBeGreaterThanOrEqual(4);
    expect(relevant.map((notification) => notification.notificationType).sort()).toEqual([
      'assignment',
      'assignment',
      'due_soon',
      'overdue'
    ]);
    expect(new Set(relevant.map((notification) => notification.eventKey)).size).toBe(4);
    expect(JSON.stringify(relevant)).not.toContain(confidential);
    for (const notification of relevant) {
      expect(Object.keys(notification.payload).sort()).toEqual([
        'campaignId',
        'dueAt',
        'itemId',
        'priority'
      ]);
    }
  });

  it('paginates deterministically, marks only owned events as read, and replays the mutation', async () => {
    const campaign = await createNotificationCampaign();
    const item = await createProductionItem(context(), campaign.id, {
      kind: 'review',
      title: 'Revisar campanha',
      assigneeUserId: member.userId,
      dueAt: '2026-08-02T12:00:00.000Z',
      idempotencyKey: randomUUID()
    });
    await projectInAppNotifications(context(), new Date('2026-08-01T12:00:00.000Z'));

    const firstPage = await listInAppNotifications(context(), { limit: 1 });
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await listInAppNotifications(context(), {
      limit: 20,
      cursor: firstPage.nextCursor!
    });
    expect(secondPage.data.some((notification) =>
      notification.id === firstPage.data[0]?.id
    )).toBe(false);

    const owned = (await listInAppNotifications(context(), { limit: 100 })).data
      .filter((notification) => notification.itemId === item.id);
    const idempotencyKey = randomUUID();
    const marked = await markInAppNotificationsRead(
      context(),
      owned.map((notification) => notification.id),
      idempotencyKey,
      new Date('2026-08-01T13:00:00.000Z')
    );
    const replay = await markInAppNotificationsRead(
      context(),
      owned.map((notification) => notification.id),
      idempotencyKey,
      new Date('2026-08-01T14:00:00.000Z')
    );

    expect(marked.every((notification) => notification.readAt !== null)).toBe(true);
    expect(replay).toEqual(marked);
    await expect(markInAppNotificationsRead(
      context(otherTenant),
      [owned[0]!.id],
      randomUUID()
    )).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});
