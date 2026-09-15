import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Client } from 'pg';
import { dockerComposeAvailable, PostgresComposeHarness } from './helpers/postgres-compose.mjs';

const ids = {
  tenantA: '71000000-0000-4000-8000-000000000001',
  tenantB: '71000000-0000-4000-8000-000000000002',
  userA: '72000000-0000-4000-8000-000000000001',
  userB: '72000000-0000-4000-8000-000000000002',
  userC: '72000000-0000-4000-8000-000000000003',
  campaignA: '73000000-0000-4000-8000-000000000001',
  campaignB: '73000000-0000-4000-8000-000000000002',
};

describe(
  'Marketing Ops RLS against the Docker runtime',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const harness = new PostgresComposeHarness({ port: 55550 });
    let bootstrap;
    let app;

    before(async () => {
      harness.start();
      bootstrap = new Client(harness.connectionConfig('bootstrap'));
      app = new Client(harness.connectionConfig('app'));
      await Promise.all([bootstrap.connect(), app.connect()]);
      await bootstrap.query(
        `INSERT INTO iam.tenants (id, slug, display_name) VALUES
          ($1, 'mops-a', 'Marketing A'), ($2, 'mops-b', 'Marketing B')`,
        [ids.tenantA, ids.tenantB],
      );
      await bootstrap.query(
        `INSERT INTO iam.principals (id, external_subject) VALUES
          ($1, 'mops-user-a'), ($2, 'mops-user-b'), ($3, 'mops-user-c')`,
        [ids.userA, ids.userB, ids.userC],
      );
      await bootstrap.query(
        `INSERT INTO iam.memberships (tenant_id, principal_id, role) VALUES
          ($1, $3, 'admin'), ($2, $4, 'admin'), ($1, $5, 'member')`,
        [ids.tenantA, ids.tenantB, ids.userA, ids.userB, ids.userC],
      );
      await bootstrap.query(
        `INSERT INTO marketing_ops.campaigns
          (id, tenant_id, name, created_by, updated_by)
         VALUES
          ($1, $2, 'Campaign A', $3, $3),
          ($4, $5, 'Campaign B', $6, $6)`,
        [ids.campaignA, ids.tenantA, ids.userA, ids.campaignB, ids.tenantB, ids.userB],
      );
    });

    after(async () => {
      await Promise.allSettled([bootstrap?.end(), app?.end()]);
      harness.cleanup();
    });

    test('denies missing context and exposes only the active IAM tenant', async () => {
      assert.equal(
        (await app.query('SELECT count(*)::int AS count FROM marketing_ops.campaigns')).rows[0].count,
        0,
      );

      await app.query('BEGIN');
      await app.query("SELECT set_config('app.user_id', $1, true)", [ids.userA]);
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [ids.tenantA]);
      await app.query("SELECT set_config('app.actor_role', 'admin', true)");
      const visible = await app.query('SELECT id, tenant_id FROM marketing_ops.campaigns');
      assert.deepEqual(visible.rows, [{ id: ids.campaignA, tenant_id: ids.tenantA }]);
      await app.query('ROLLBACK');
    });

    test('isolates prepared plans from another actor in the same tenant', async () => {
      const plan = '74000000-0000-4000-8000-000000000088';
      await bootstrap.query(
        `INSERT INTO marketing_ops.prepared_agent_plans
          (id, tenant_id, prepared_by, chat_session_id, source_run_id, plan_hash, actions, expires_at)
         VALUES ($1, $2, $3, gen_random_uuid(), gen_random_uuid(), $4, $5::jsonb, now() + interval '30 minutes')`,
        [plan, ids.tenantA, ids.userA, '8'.repeat(64), JSON.stringify([{ type: 'campaign.create_draft', ref: 'private', name: 'Private' }])]
      );

      await app.query('BEGIN');
      await app.query("SELECT set_config('app.user_id', $1, true)", [ids.userC]);
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [ids.tenantA]);
      await app.query("SELECT set_config('app.actor_role', 'member', true)");
      assert.equal((await app.query(
        'SELECT count(*)::int AS count FROM marketing_ops.prepared_agent_plans WHERE id = $1', [plan]
      )).rows[0].count, 0);
      assert.equal((await app.query(
        `UPDATE marketing_ops.prepared_agent_plans SET status = 'invalidated' WHERE id = $1 RETURNING id`, [plan]
      )).rows.length, 0);
      await app.query('ROLLBACK');
    });

    test('rejects a cross-tenant insert even with matching row actor ids', async () => {
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.user_id', $1, true)", [ids.userA]);
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [ids.tenantA]);
      await app.query("SELECT set_config('app.actor_role', 'admin', true)");
      await assert.rejects(
        app.query(
          `INSERT INTO marketing_ops.campaigns (tenant_id, name, created_by, updated_by)
           VALUES ($1, 'Forbidden', $2, $2)`,
          [ids.tenantB, ids.userA],
        ),
        (error) => error.code === '42501',
      );
      await app.query('ROLLBACK');
    });

    test('enforces RLS, immutability, transitions, and unique execution keys on prepared_agent_plans', async () => {
      const planA = '74000000-0000-4000-8000-000000000001';
      const sessionA = '75000000-0000-4000-8000-000000000001';
      const runA = '76000000-0000-4000-8000-000000000001';
      const planHashA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const actionsA = JSON.stringify([{ type: 'campaign.create_draft', payload: { name: 'Test' } }]);

      // Missing context -> 0 visible
      assert.equal(
        (await app.query('SELECT count(*)::int AS count FROM marketing_ops.prepared_agent_plans')).rows[0].count,
        0,
      );

      await app.query('BEGIN');
      await app.query("SELECT set_config('app.user_id', $1, true)", [ids.userA]);
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [ids.tenantA]);
      await app.query("SELECT set_config('app.actor_role', 'admin', true)");

      // Insert valid pending plan
      await app.query(
        `INSERT INTO marketing_ops.prepared_agent_plans
          (id, tenant_id, prepared_by, chat_session_id, source_run_id, plan_hash, actions, required_scopes, status, expires_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7::jsonb, ARRAY['campaign:write'], 'pending', now() + interval '30 minutes')`,
        [planA, ids.tenantA, ids.userA, sessionA, runA, planHashA, actionsA],
      );

      // Visible in tenant A
      const visible = await app.query('SELECT id, status FROM marketing_ops.prepared_agent_plans WHERE id = $1', [planA]);
      assert.equal(visible.rows.length, 1);
      assert.equal(visible.rows[0].status, 'pending');

      // Reject mutating core fields (immutability)
      await app.query('SAVEPOINT sp_immutability');
      await assert.rejects(
        app.query(
          `UPDATE marketing_ops.prepared_agent_plans
              SET plan_hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
            WHERE id = $1`,
          [planA],
        ),
        (error) => error.code === '55000',
      );
      await app.query('ROLLBACK TO SAVEPOINT sp_immutability');

      // Transition pending -> executing with execution key
      await app.query(
        `UPDATE marketing_ops.prepared_agent_plans
            SET status = 'executing',
                execution_key = 'idemp-key-1',
                execution_started_at = now(),
                execution_attempts = 1
          WHERE id = $1`,
        [planA],
      );

      // Transition executing -> completed
      await app.query(
        `UPDATE marketing_ops.prepared_agent_plans
            SET status = 'completed',
                result = '{"success":true}'::jsonb,
                executed_by = $2,
                executed_at = now()
          WHERE id = $1`,
        [planA, ids.userA],
      );

      // Illegal transition from terminal state -> pending rejected
      await app.query('SAVEPOINT sp_terminal_transition');
      await assert.rejects(
        app.query(
          `UPDATE marketing_ops.prepared_agent_plans
              SET status = 'pending'
            WHERE id = $1`,
          [planA],
        ),
        (error) => error.code === '23514',
      );
      await app.query('ROLLBACK TO SAVEPOINT sp_terminal_transition');

      // A stale worker cannot overwrite the terminal result without changing status.
      await app.query('SAVEPOINT sp_terminal_result');
      await assert.rejects(
        app.query(
          `UPDATE marketing_ops.prepared_agent_plans
              SET result = '{"success":false,"stale":true}'::jsonb
            WHERE id = $1`,
          [planA],
        ),
        (error) => error.code === '23514',
      );
      await app.query('ROLLBACK TO SAVEPOINT sp_terminal_result');

      // Duplicate execution key on same tenant rejected
      const planA2 = '74000000-0000-4000-8000-000000000002';
      await app.query('SAVEPOINT sp_duplicate_key');
      await assert.rejects(
        app.query(
          `INSERT INTO marketing_ops.prepared_agent_plans
            (id, tenant_id, prepared_by, chat_session_id, source_run_id, plan_hash, actions, required_scopes, status, expires_at, execution_key)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7::jsonb, ARRAY['campaign:write'], 'completed', now() + interval '30 minutes', 'idemp-key-1')`,
          [planA2, ids.tenantA, ids.userA, sessionA, runA, planHashA, actionsA],
        ),
        (error) => error.code === '23505',
      );
      await app.query('ROLLBACK TO SAVEPOINT sp_duplicate_key');

      // Reject delete on prepared_agent_plans for nexus_app (no DELETE grant -> 42501)
      await app.query('SAVEPOINT sp_reject_delete');
      await assert.rejects(
        app.query('DELETE FROM marketing_ops.prepared_agent_plans WHERE id = $1', [planA]),
        (error) => error.code === '42501',
      );
      await app.query('ROLLBACK TO SAVEPOINT sp_reject_delete');

      // Also reject delete for bootstrap / nexus_owner on existing row (trigger reject_append_only_change -> 55000)
      const sentinelPlan = '74000000-0000-4000-8000-000000000099';
      const sentinelRun = '76000000-0000-4000-8000-000000000099';
      const sentinelHash = '9'.repeat(64);
      await bootstrap.query(
        `INSERT INTO marketing_ops.prepared_agent_plans
          (id, tenant_id, prepared_by, chat_session_id, source_run_id, plan_hash, actions, required_scopes, status, expires_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7::jsonb, ARRAY['campaign:write'], 'pending', now() + interval '30 minutes')`,
        [sentinelPlan, ids.tenantA, ids.userA, sessionA, sentinelRun, sentinelHash, actionsA],
      );
      await assert.rejects(
        bootstrap.query('DELETE FROM marketing_ops.prepared_agent_plans WHERE id = $1', [sentinelPlan]),
        (error) => error.code === '55000',
      );

      await app.query('ROLLBACK');
    });
  },
);
