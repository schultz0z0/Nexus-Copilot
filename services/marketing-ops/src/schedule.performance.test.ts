import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from './auth/actor.js';
import { listProductionSchedule } from './domain/queries.js';

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
const fixtureCount = 10_000;
const sampleSize = 20;
const limitMs = 500;

afterAll(() => pool.end());

describe('production schedule performance gate', () => {
  it('keeps a filtered first page within 500 ms p95 at 10,000 items', async () => {
    const fixturePrefix = `phase3-perf-${randomUUID()}`;
    try {
      const inserted = await pool.query(`
        insert into marketing_ops.campaign_items (
          tenant_id, campaign_id, kind, title, assignee_user_id, priority,
          channel, starts_at, due_at, created_by, updated_by
        )
        select
          $1::uuid,
          'c1111111-1111-4111-8111-111111111111'::uuid,
          case when series % 2 = 0 then 'email' else 'task' end::marketing_ops.item_kind,
          $3 || '-' || lpad(series::text, 5, '0'),
          $2::uuid,
          case when series % 10 = 0 then 'urgent' else 'normal' end::marketing_ops.item_priority,
          case when series % 2 = 0 then 'email' else null end::marketing_ops.item_channel,
          '2026-08-01T00:00:00Z'::timestamptz + (series * interval '5 minutes'),
          '2026-08-01T01:00:00Z'::timestamptz + (series * interval '5 minutes'),
          $2::uuid,
          $2::uuid
        from generate_series(1, $4::integer) as series
      `, [actor.tenantId, actor.userId, fixturePrefix, fixtureCount]);
      expect(inserted.rowCount).toBe(fixtureCount);
      await pool.query('analyze marketing_ops.campaign_items');

      const input = {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
        campaignId: 'c1111111-1111-4111-8111-111111111111',
        kind: 'email' as const,
        channel: 'email' as const,
        assigneeId: actor.userId,
        limit: 50
      };
      for (let warmup = 0; warmup < 5; warmup += 1) {
        await listProductionSchedule({
          pool, actor, correlationId: randomUUID(), origin: 'rest'
        }, input);
      }

      const samples: number[] = [];
      for (let sample = 0; sample < sampleSize; sample += 1) {
        const startedAt = performance.now();
        const result = await listProductionSchedule({
          pool, actor, correlationId: randomUUID(), origin: 'rest'
        }, input);
        samples.push(performance.now() - startedAt);
        expect(result.data).toHaveLength(50);
      }
      const ordered = [...samples].sort((left, right) => left - right);
      const p95 = ordered[Math.ceil(sampleSize * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
      console.info(
        `production_schedule_performance fixtures=${fixtureCount} samples=${sampleSize} p95_ms=${p95.toFixed(2)} limit_ms=${limitMs}`
      );
      expect(p95).toBeLessThanOrEqual(limitMs);
    } finally {
      await pool.query(
        'delete from marketing_ops.campaign_items where tenant_id = $1 and title like $2',
        [actor.tenantId, `${fixturePrefix}%`]
      );
      const remaining = await pool.query<{ count: number }>(
        'select count(*)::integer as count from marketing_ops.campaign_items where tenant_id = $1 and title like $2',
        [actor.tenantId, `${fixturePrefix}%`]
      );
      expect(remaining.rows[0]?.count).toBe(0);
      await pool.query('vacuum analyze marketing_ops.campaign_items');
    }
  }, 120_000);
});
