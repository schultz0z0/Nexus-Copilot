import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Client } from 'pg';
import { dockerComposeAvailable, PostgresComposeHarness } from './helpers/postgres-compose.mjs';

const ids = {
  tenantA: '71000000-0000-4000-8000-000000000001',
  tenantB: '71000000-0000-4000-8000-000000000002',
  userA: '72000000-0000-4000-8000-000000000001',
  userB: '72000000-0000-4000-8000-000000000002',
  campaignA: '73000000-0000-4000-8000-000000000001',
  campaignB: '73000000-0000-4000-8000-000000000002',
};

describe(
  'Marketing Ops RLS against the Docker runtime',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const harness = new PostgresComposeHarness({ port: 55449 });
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
          ($1, 'mops-user-a'), ($2, 'mops-user-b')`,
        [ids.userA, ids.userB],
      );
      await bootstrap.query(
        `INSERT INTO iam.memberships (tenant_id, principal_id, role) VALUES
          ($1, $3, 'admin'), ($2, $4, 'admin')`,
        [ids.tenantA, ids.tenantB, ids.userA, ids.userB],
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
  },
);
