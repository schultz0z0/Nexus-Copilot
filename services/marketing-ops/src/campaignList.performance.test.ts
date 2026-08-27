import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from './auth/actor.js';
import { listCampaigns } from './domain/queries.js';

const pool = new pg.Pool({
  connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
});
const actor: Actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantSlug: 'ens',
  role: 'member'
};
const fixtureCount = 5_000;
const sampleSize = 20;
const limitMs = 500;

afterAll(() => pool.end());

describe('campaign list performance gate', () => {
  it('keeps the first page within the 500 ms p95 SLO at 5,000 campaigns', async () => {
    const fixturePrefix = `phase2-perf-${randomUUID()}`;
    try {
      const inserted = await pool.query(`
        with inserted_campaigns as (
          insert into marketing_ops.campaigns (
            tenant_id,
            name,
            created_by,
            updated_by,
            created_at,
            updated_at
          )
          select
            $1::uuid,
            $3 || '-' || lpad(series::text, 4, '0'),
            $2::uuid,
            $2::uuid,
            now() - (series * interval '1 millisecond'),
            now() - (series * interval '1 millisecond')
          from generate_series(1, $4::integer) as series
          returning tenant_id, id
        )
        insert into marketing_ops.campaign_members (
          tenant_id,
          campaign_id,
          user_id,
          member_role,
          is_primary,
          created_by
        )
        select tenant_id, id, $2::uuid, 'owner', true, $2::uuid
        from inserted_campaigns
      `, [actor.tenantId, actor.userId, fixturePrefix, fixtureCount]);
      expect(inserted.rowCount).toBe(fixtureCount);
      await pool.query('analyze marketing_ops.campaigns');
      await pool.query('analyze marketing_ops.campaign_members');

      for (let warmup = 0; warmup < 5; warmup += 1) {
        await listCampaigns({
          pool,
          actor,
          correlationId: randomUUID(),
          origin: 'rest'
        }, { limit: 25 });
      }

      const samples: number[] = [];
      for (let sample = 0; sample < sampleSize; sample += 1) {
        const startedAt = performance.now();
        const result = await listCampaigns({
          pool,
          actor,
          correlationId: randomUUID(),
          origin: 'rest'
        }, { limit: 25 });
        samples.push(performance.now() - startedAt);
        expect(result.data).toHaveLength(25);
      }

      const sortedSamples = [...samples].sort((left, right) => left - right);
      const p95 = sortedSamples[Math.ceil(samples.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
      console.info(
        `campaign_list_performance fixtures=${fixtureCount} samples=${sampleSize} p95_ms=${p95.toFixed(2)} limit_ms=${limitMs}`
      );
      expect(p95).toBeLessThanOrEqual(limitMs);
    } finally {
      await pool.query(
        'delete from marketing_ops.campaigns where tenant_id = $1 and name like $2',
        [actor.tenantId, `${fixturePrefix}%`]
      );
      const remaining = await pool.query<{ count: number }>(
        'select count(*)::integer as count from marketing_ops.campaigns where tenant_id = $1 and name like $2',
        [actor.tenantId, `${fixturePrefix}%`]
      );
      expect(remaining.rows[0]?.count).toBe(0);
      await pool.query('vacuum analyze marketing_ops.campaigns');
      await pool.query('vacuum analyze marketing_ops.campaign_members');
    }
  }, 120_000);
});
