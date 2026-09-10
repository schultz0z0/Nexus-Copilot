import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { Client } from 'pg';

import { runMigrations } from '../src/migrate.mjs';
import { dockerComposeAvailable, PostgresComposeHarness } from './helpers/postgres-compose.mjs';

const ids = {
  tenantA: '10000000-0000-4000-8000-000000000001',
  tenantB: '10000000-0000-4000-8000-000000000002',
  userA: '20000000-0000-4000-8000-000000000001',
  userB: '20000000-0000-4000-8000-000000000002',
  canaryA: '30000000-0000-4000-8000-000000000001',
  canaryB: '30000000-0000-4000-8000-000000000002',
};

describe(
  'PostgreSQL foundation against the Docker runtime',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const harness = new PostgresComposeHarness();
    let bootstrap;
    let app;
    let migrator;
    let firstMigrationOutput;

    before(async () => {
      firstMigrationOutput = harness.start().stdout;
      bootstrap = new Client(harness.connectionConfig('bootstrap'));
      app = new Client(harness.connectionConfig('app'));
      migrator = new Client(harness.connectionConfig('migrator'));
      await Promise.all([bootstrap.connect(), app.connect(), migrator.connect()]);

      await bootstrap.query(
        `INSERT INTO iam.tenants (id, slug, display_name)
         VALUES ($1, 'tenant-a', 'Tenant A'), ($2, 'tenant-b', 'Tenant B')`,
        [ids.tenantA, ids.tenantB],
      );
      await bootstrap.query(
        `INSERT INTO iam.principals (id, external_subject)
         VALUES ($1, 'subject-a'), ($2, 'subject-b')`,
        [ids.userA, ids.userB],
      );
      await bootstrap.query(
        `INSERT INTO iam.memberships (tenant_id, principal_id, role)
         VALUES
           ($1, $3, 'admin'),
           ($2, $3, 'member'),
           ($2, $4, 'admin')`,
        [ids.tenantA, ids.tenantB, ids.userA, ids.userB],
      );
      await bootstrap.query(
        `INSERT INTO app_private.tenant_canary (id, tenant_id, created_by, label)
         VALUES ($1, $2, $3, 'tenant-b-secret')`,
        [ids.canaryB, ids.tenantB, ids.userB],
      );
    });

    after(async () => {
      await Promise.allSettled([bootstrap?.end(), app?.end(), migrator?.end()]);
      harness.cleanup();
    });

    test('applies all migrations to an empty database and skips them on the second run', () => {
      assert.match(firstMigrationOutput, /"applied":\["0001","0002","0003"\]/);
      const secondOutput = harness.migrate().stdout;
      assert.match(secondOutput, /"applied":\[\]/);
      assert.match(secondOutput, /"skipped":\["0001","0002","0003"\]/);
    });

    test('creates non-owner application roles and owner-controlled RLS tables', async () => {
      const roles = await bootstrap.query(
        `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
                rolreplication, rolbypassrls
           FROM pg_catalog.pg_roles
          WHERE rolname IN ('nexus_owner', 'nexus_migrator', 'nexus_app')
          ORDER BY rolname`,
      );
      assert.deepEqual(roles.rows, [
        {
          rolname: 'nexus_app',
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
        },
        {
          rolname: 'nexus_migrator',
          rolcanlogin: true,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
        },
        {
          rolname: 'nexus_owner',
          rolcanlogin: false,
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
        },
      ]);

      const tables = await bootstrap.query(
        `SELECT n.nspname AS schema_name, c.relname AS table_name,
                pg_get_userbyid(c.relowner) AS owner,
                c.relrowsecurity, c.relforcerowsecurity
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r'
            AND (n.nspname, c.relname) IN (
              ('iam', 'tenants'),
              ('iam', 'principals'),
              ('iam', 'memberships'),
              ('app_private', 'tenant_canary')
            )
          ORDER BY n.nspname, c.relname`,
      );
      assert.equal(tables.rows.length, 4);
      for (const row of tables.rows) {
        assert.equal(row.owner, 'nexus_owner');
        assert.equal(row.relrowsecurity, true);
        assert.equal(row.relforcerowsecurity, true);
      }

      const privileges = await bootstrap.query(
        `SELECT
           has_table_privilege('nexus_app', 'app_private.tenant_canary', 'SELECT,INSERT,UPDATE,DELETE') AS allowed,
           has_table_privilege('nexus_app', 'app_private.tenant_canary', 'TRUNCATE,REFERENCES,TRIGGER') AS forbidden,
           pg_has_role('nexus_app', 'nexus_owner', 'MEMBER') AS app_is_owner_member`,
      );
      assert.deepEqual(privileges.rows[0], {
        allowed: true,
        forbidden: false,
        app_is_owner_member: false,
      });

      const policies = await bootstrap.query(
        `SELECT schemaname, tablename, policyname, cmd
           FROM pg_catalog.pg_policies
          WHERE schemaname IN ('iam', 'app_private')
          ORDER BY schemaname, tablename, policyname`,
      );
      assert.deepEqual(
        policies.rows.map((row) => `${row.schemaname}.${row.tablename}:${row.policyname}:${row.cmd}`),
        [
          'app_private.tenant_canary:tenant_canary_delete:DELETE',
          'app_private.tenant_canary:tenant_canary_insert:INSERT',
          'app_private.tenant_canary:tenant_canary_select:SELECT',
          'app_private.tenant_canary:tenant_canary_update:UPDATE',
          'iam.memberships:memberships_select_current_tenant:SELECT',
          'iam.principals:principals_select_current:SELECT',
          'iam.tenants:tenants_select_current:SELECT',
        ],
      );

      const indexes = await bootstrap.query(
        `SELECT schemaname, indexname
           FROM pg_catalog.pg_indexes
          WHERE indexname IN (
            'memberships_principal_id_idx',
            'memberships_active_tenant_idx',
            'tenant_canary_tenant_id_id_idx',
            'tenant_canary_membership_idx'
          )
          ORDER BY indexname`,
      );
      assert.deepEqual(
        indexes.rows.map((row) => `${row.schemaname}.${row.indexname}`),
        [
          'iam.memberships_active_tenant_idx',
          'iam.memberships_principal_id_idx',
          'app_private.tenant_canary_membership_idx',
          'app_private.tenant_canary_tenant_id_id_idx',
        ],
      );
    });

    test('denies rows without context and isolates all tenant mutations', async () => {
      assert.equal((await app.query('SELECT count(*)::int AS count FROM app_private.tenant_canary')).rows[0].count, 0);

      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [ids.tenantA]);
        await app.query(`SELECT set_config('app.user_id', $1, true)`, [ids.userA]);

        assert.equal((await app.query('SELECT count(*)::int AS count FROM iam.tenants')).rows[0].count, 1);
        assert.equal((await app.query('SELECT count(*)::int AS count FROM iam.principals')).rows[0].count, 1);
        assert.equal((await app.query('SELECT count(*)::int AS count FROM iam.memberships')).rows[0].count, 1);
        assert.equal((await app.query('SELECT count(*)::int AS count FROM app_private.tenant_canary')).rows[0].count, 0);

        await app.query(
          `INSERT INTO app_private.tenant_canary (id, tenant_id, created_by, label)
           VALUES ($1, $2, $3, 'tenant-a-visible')`,
          [ids.canaryA, ids.tenantA, ids.userA],
        );
        assert.equal((await app.query('SELECT count(*)::int AS count FROM app_private.tenant_canary')).rows[0].count, 1);
        await app.query('COMMIT');
      } catch (error) {
        await app.query('ROLLBACK');
        throw error;
      }

      assert.equal((await app.query('SELECT count(*)::int AS count FROM app_private.tenant_canary')).rows[0].count, 0);

      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [ids.tenantA]);
      await app.query(`SELECT set_config('app.user_id', $1, true)`, [ids.userA]);
      await assert.rejects(
        app.query(
          `INSERT INTO app_private.tenant_canary (id, tenant_id, created_by, label)
           VALUES ('30000000-0000-4000-8000-000000000003', $1, $2, 'forbidden')`,
          [ids.tenantB, ids.userA],
        ),
        (error) => error.code === '42501',
      );
      await app.query('ROLLBACK');

      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [ids.tenantA]);
      await app.query(`SELECT set_config('app.user_id', $1, true)`, [ids.userA]);
      await assert.rejects(
        app.query(
          `UPDATE app_private.tenant_canary
              SET tenant_id = $1, updated_at = transaction_timestamp()
            WHERE id = $2`,
          [ids.tenantB, ids.canaryA],
        ),
        (error) => error.code === '42501',
      );
      await app.query('ROLLBACK');

      await app.query('BEGIN');
      await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [ids.tenantA]);
      await app.query(`SELECT set_config('app.user_id', $1, true)`, [ids.userA]);
      assert.equal(
        (await app.query('DELETE FROM app_private.tenant_canary WHERE id = $1 RETURNING id', [ids.canaryB])).rowCount,
        0,
      );
      await app.query('ROLLBACK');
    });

    test('clears transaction-local context after both commit and rollback on one connection', async () => {
      for (const ending of ['COMMIT', 'ROLLBACK']) {
        await app.query('BEGIN');
        await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [ids.tenantA]);
        await app.query(`SELECT set_config('app.user_id', $1, true)`, [ids.userA]);
        assert.equal((await app.query('SELECT count(*)::int AS count FROM iam.tenants')).rows[0].count, 1);
        await app.query(ending);
        assert.equal((await app.query('SELECT count(*)::int AS count FROM iam.tenants')).rows[0].count, 0);
      }
    });

    test('rejects a changed checksum against the real migration ledger', async () => {
      await assert.rejects(
        runMigrations({
          client: migrator,
          migrations: [
            {
              version: '0001',
              name: 'foundation_schemas',
              filename: '0001_foundation_schemas.sql',
              checksum: '0'.repeat(64),
              sql: 'select 1;',
            },
          ],
        }),
        /checksum mismatch.*0001/i,
      );
    });
  },
);
