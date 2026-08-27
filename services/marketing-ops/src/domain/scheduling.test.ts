import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor.js';
import { loadConfig } from '../config.js';
import { archiveCampaign, createCampaignDraft } from './campaigns.js';
import { createProductionItem } from './items.js';
import { listProductionSchedule } from './queries.js';
import {
  decodeScheduleCursor,
  encodeScheduleCursor,
  getScheduleIndicators,
  getZonedDateTimeParts,
  normalizeScheduleFilters,
  scheduleIntersects
} from './scheduling.js';

const pool = new pg.Pool({
  connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
});
const actor: Actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantSlug: 'ens',
  role: 'member'
};
const manager: Actor = {
  ...actor,
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'manager'
};

afterAll(() => pool.end());

const context = (contextActor: Actor = actor) => ({
  pool,
  actor: contextActor,
  correlationId: randomUUID(),
  origin: 'rest' as const
});

describe('schedule contracts', () => {
  it('normalizes combined filters and requires a complete half-open range', () => {
    expect(normalizeScheduleFilters({
      from: '2026-12-31T21:00:00-03:00',
      to: '2027-01-02T00:00:00-03:00',
      campaignId: 'c1111111-1111-4111-8111-111111111111',
      kind: 'email',
      channel: 'email',
      assigneeId: actor.userId,
      status: 'ready',
      priority: 'high',
      limit: 25
    })).toMatchObject({
      from: '2027-01-01T00:00:00.000Z',
      to: '2027-01-02T03:00:00.000Z',
      kind: 'email',
      priority: 'high',
      limit: 25
    });

    expect(() => normalizeScheduleFilters({
      from: '2026-08-01T00:00:00.000Z',
      limit: 25
    })).toThrow();
    expect(() => normalizeScheduleFilters({
      from: '2026-08-02T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      limit: 25
    })).toThrow();
    expect(() => normalizeScheduleFilters({ status: 'scheduled', limit: 25 } as never))
      .toThrow();
  });

  it('uses the approved interval boundaries and keeps undated items out of ranges', () => {
    const from = '2026-08-01T00:00:00.000Z';
    const to = '2026-09-01T00:00:00.000Z';
    expect(scheduleIntersects({
      startsAt: '2026-07-31T23:00:00.000Z',
      dueAt: from
    }, from, to)).toBe(true);
    expect(scheduleIntersects({
      startsAt: to,
      dueAt: '2026-09-02T00:00:00.000Z'
    }, from, to)).toBe(false);
    expect(scheduleIntersects({
      startsAt: from,
      dueAt: null
    }, from, to)).toBe(true);
    expect(scheduleIntersects({ startsAt: null, dueAt: null }, from, to)).toBe(false);
  });

  it('round-trips the stable schedule cursor including undated rows', () => {
    const dated = {
      effectiveAt: '2026-08-01T12:00:00.000Z',
      priority: 'urgent' as const,
      id: 'e1111111-1111-4111-8111-111111111111'
    };
    expect(decodeScheduleCursor(encodeScheduleCursor(dated))).toEqual(dated);
    const undated = { ...dated, effectiveAt: null };
    expect(decodeScheduleCursor(encodeScheduleCursor(undated))).toEqual(undated);
    expect(() => decodeScheduleCursor('invalid')).toThrowError(expect.objectContaining({
      code: 'validation_error'
    }));
  });

  it('derives overdue and blocked indicators without persisting them', () => {
    expect(getScheduleIndicators({
      status: 'ready',
      dueAt: '2026-08-01T11:59:59.000Z'
    }, true, '2026-08-01T12:00:00.000Z')).toEqual({
      isOverdue: true,
      isBlocked: true
    });
    expect(getScheduleIndicators({
      status: 'completed',
      dueAt: '2026-08-01T11:59:59.000Z'
    }, false, '2026-08-01T12:00:00.000Z')).toEqual({
      isOverdue: false,
      isBlocked: false
    });
  });
});

describe('schedule timezone', () => {
  it('uses the ENS fallback and rejects invalid IANA configuration', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).tenantTimeZone).toBe('America/Sao_Paulo');
    expect(loadConfig({
      NODE_ENV: 'test',
      MARKETING_OPS_TENANT_TIME_ZONE: 'Europe/Lisbon'
    }).tenantTimeZone).toBe('Europe/Lisbon');
    expect(() => loadConfig({
      NODE_ENV: 'test',
      MARKETING_OPS_TENANT_TIME_ZONE: 'Invalid/Timezone'
    })).toThrow(/timezone/i);
  });

  it('converts São Paulo and a DST timezone through IANA rules', () => {
    expect(getZonedDateTimeParts(
      '2026-08-01T03:30:00.000Z',
      'America/Sao_Paulo'
    )).toMatchObject({
      year: 2026, month: 8, day: 1, hour: 0, minute: 30
    });
    expect(getZonedDateTimeParts(
      '2026-01-15T12:00:00.000Z',
      'America/New_York'
    ).hour).toBe(7);
    expect(getZonedDateTimeParts(
      '2026-07-15T12:00:00.000Z',
      'America/New_York'
    ).hour).toBe(8);
  });
});

describe('canonical production schedule query', () => {
  it('excludes items from archived campaigns from the operational schedule', async () => {
    const campaign = await createCampaignDraft(context(manager), {
      name: `Archived schedule ${randomUUID()}`,
      idempotencyKey: randomUUID()
    });
    const item = await createProductionItem(context(manager), campaign.id, {
      kind: 'task',
      title: 'Archived schedule item',
      startsAt: '2026-08-01T12:00:00.000Z',
      idempotencyKey: randomUUID()
    });
    await archiveCampaign(context(manager), campaign.id, campaign.version, randomUUID());

    const result = await listProductionSchedule(context(manager), {
      campaignId: campaign.id,
      limit: 25
    });

    expect(result.data.some((candidate) => candidate.id === item.id)).toBe(false);
  });

  it('combines range and item filters, and derives overdue/blocking in one query', async () => {
    const campaign = await createCampaignDraft(context(), {
      name: `Schedule query ${randomUUID()}`,
      idempotencyKey: randomUUID()
    });
    const predecessor = await createProductionItem(context(), campaign.id, {
      kind: 'task',
      title: 'Predecessor',
      assigneeUserId: actor.userId,
      dueAt: '2026-07-20T12:00:00.000Z',
      idempotencyKey: randomUUID()
    });
    const scheduled = await createProductionItem(context(), campaign.id, {
      kind: 'email',
      title: 'Scheduled email',
      assigneeUserId: actor.userId,
      priority: 'urgent',
      channel: 'email',
      startsAt: '2026-06-10T12:00:00.000Z',
      dueAt: '2026-06-11T12:00:00.000Z',
      idempotencyKey: randomUUID()
    });
    await createProductionItem(context(), campaign.id, {
      kind: 'post',
      title: 'Outside range',
      assigneeUserId: actor.userId,
      startsAt: '2026-10-01T12:00:00.000Z',
      dueAt: '2026-10-02T12:00:00.000Z',
      idempotencyKey: randomUUID()
    });
    await createProductionItem(context(), campaign.id, {
      kind: 'task',
      title: 'Undated',
      idempotencyKey: randomUUID()
    });
    await pool.query(`
      insert into marketing_ops.item_dependencies (
        tenant_id, campaign_id, item_id, depends_on_item_id, created_by
      ) values ($1, $2, $3, $4, $5)
    `, [actor.tenantId, campaign.id, scheduled.id, predecessor.id, actor.userId]);

    const result = await listProductionSchedule(context(), {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
      campaignId: campaign.id,
      kind: 'email',
      channel: 'email',
      assigneeId: actor.userId,
      priority: 'urgent',
      limit: 25
    });
    expect(result.timeZone).toBe('America/Sao_Paulo');
    expect(result.nextCursor).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: scheduled.id,
      campaignName: campaign.name,
      effectiveAt: '2026-06-10T12:00:00.000Z',
      isBlocked: true,
      isOverdue: true
    });

    const all = await listProductionSchedule(context(), {
      campaignId: campaign.id,
      limit: 25
    });
    expect(all.data).toHaveLength(4);
    expect(all.data.at(-1)).toMatchObject({ title: 'Undated', effectiveAt: null });
  });

  it('paginates deterministically across equal timestamps and month/year boundaries', async () => {
    const campaign = await createCampaignDraft(context(), {
      name: `Schedule pagination ${randomUUID()}`,
      idempotencyKey: randomUUID()
    });
    for (const [title, priority] of [
      ['Year urgent', 'urgent'],
      ['Year normal', 'normal']
    ] as const) {
      await createProductionItem(context(), campaign.id, {
        kind: 'milestone',
        title,
        priority,
        startsAt: '2027-01-01T00:00:00.000Z',
        idempotencyKey: randomUUID()
      });
    }

    const first = await listProductionSchedule(context(), {
      from: '2026-12-31T00:00:00.000Z',
      to: '2027-02-01T00:00:00.000Z',
      campaignId: campaign.id,
      limit: 1
    });
    expect(first.data[0]?.title).toBe('Year urgent');
    expect(first.nextCursor).not.toBeNull();

    const second = await listProductionSchedule(context(), {
      from: '2026-12-31T00:00:00.000Z',
      to: '2027-02-01T00:00:00.000Z',
      campaignId: campaign.id,
      cursor: first.nextCursor!,
      limit: 1
    });
    expect(second.data[0]?.title).toBe('Year normal');
    expect(second.nextCursor).toBeNull();
  });

  it('does not expose schedule rows to an actor from another tenant', async () => {
    const campaign = await createCampaignDraft(context(), {
      name: `Schedule tenant isolation ${randomUUID()}`,
      idempotencyKey: randomUUID()
    });
    await createProductionItem(context(), campaign.id, {
      kind: 'task',
      title: 'ENS private schedule item',
      startsAt: '2026-09-01T12:00:00.000Z',
      idempotencyKey: randomUUID()
    });
    const otherTenantActor: Actor = {
      userId: '44444444-4444-4444-8444-444444444444',
      tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenantSlug: 'other',
      role: 'member'
    };

    const result = await listProductionSchedule(context(otherTenantActor), {
      campaignId: campaign.id,
      limit: 25
    });

    expect(result.data).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});
