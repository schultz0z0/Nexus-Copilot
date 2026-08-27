import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.MARKETING_OPS_TEST_DATABASE_URL ??
  process.env.NEXUS_SUPABASE_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const fixtureCount = 10_000;
const sampleSize = 20;
const limitMs = 500;

afterAll(() => pool.end());

describe('approval queue database performance gate', () => {
  it('keeps the RLS-backed first page within 500 ms p95 at 10,000 requests', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const fixture = await client.query<{
        tenant_id: string; user_id: string; campaign_id: string;
      }>(`
        select membership.tenant_id, membership.user_id, campaign.id as campaign_id
        from marketing_ops.memberships as membership
        join marketing_ops.campaigns as campaign on campaign.tenant_id = membership.tenant_id
        where membership.active and membership.role in ('manager', 'admin')
        order by membership.created_at, campaign.created_at
        limit 1
      `);
      const actor = fixture.rows[0];
      if (!actor) throw new Error('Performance gate requires one active manager/admin campaign fixture');

      await client.query('set local session_replication_role = replica');
      await client.query(`
        create temporary table phase5_perf_packages on commit drop as
        select series, gen_random_uuid() as id
        from generate_series(1, $1::integer) as series
      `, [fixtureCount]);
      await client.query(`
        insert into marketing_ops.action_packages (
          id, tenant_id, campaign_id, created_by, action_type, channel,
          audience_snapshot, time_zone, configuration, payload, payload_hash,
          expires_at, created_at, updated_at
        )
        select package.id, $1, $2, $3, 'phase5.performance', 'internal',
          '{}'::jsonb, 'UTC', '{}'::jsonb, jsonb_build_object('series', package.series),
          repeat('a', 64), now() + interval '1 day',
          now() - package.series * interval '1 millisecond',
          now() - package.series * interval '1 millisecond'
        from phase5_perf_packages as package
      `, [actor.tenant_id, actor.campaign_id, actor.user_id]);
      await client.query(`
        insert into marketing_ops.approval_requests (
          tenant_id, campaign_id, kind, requested_by, reason, risk_level,
          action_package_id, target_hash, expires_at, created_at, updated_at
        )
        select $1, $2, 'operational', $3, 'phase5 performance fixture',
          case when package.series % 20 = 0 then 'critical' else 'medium' end::marketing_ops.approval_risk,
          package.id, repeat('a', 64), now() + interval '1 day',
          now() - package.series * interval '1 millisecond',
          now() - package.series * interval '1 millisecond'
        from phase5_perf_packages as package
      `, [actor.tenant_id, actor.campaign_id, actor.user_id]);
      await client.query('set local session_replication_role = origin');
      await client.query('analyze marketing_ops.approval_requests');
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [actor.user_id]);
      await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
      await client.query("select set_config('marketing_ops.tenant_id', $1, true)", [actor.tenant_id]);
      await client.query('set local role authenticated');

      const query = () => client.query(`
        select request.id, request.status, request.kind, request.risk_level,
          request.created_at
        from marketing_ops.approval_requests as request
        where request.status = 'pending'
          and request.campaign_id = $1
        order by request.created_at desc, request.id desc
        limit 51
      `, [actor.campaign_id]);
      for (let warmup = 0; warmup < 5; warmup += 1) await query();

      const samples: number[] = [];
      for (let sample = 0; sample < sampleSize; sample += 1) {
        const startedAt = performance.now();
        const result = await query();
        samples.push(performance.now() - startedAt);
        expect(result.rows).toHaveLength(51);
      }
      const ordered = [...samples].sort((left, right) => left - right);
      const p95 = ordered[Math.ceil(sampleSize * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
      console.info(
        `approval_queue_performance fixtures=${fixtureCount} samples=${sampleSize} p95_ms=${p95.toFixed(2)} limit_ms=${limitMs}`
      );
      expect(p95).toBeLessThanOrEqual(limitMs);
    } finally {
      await client.query('reset role').catch(() => undefined);
      await client.query('rollback').catch(() => undefined);
      client.release();
    }
  }, 120_000);
});
