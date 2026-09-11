import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { Client } from 'pg';

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
  'PostgreSQL isolated restore drill against Docker runtime',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const harness = new PostgresComposeHarness({ port: 55436 });
    let bootstrap;

    before(async () => {
      harness.start();
      bootstrap = new Client(harness.connectionConfig('bootstrap'));
      await bootstrap.connect();

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
           ($2, $4, 'admin')`,
        [ids.tenantA, ids.tenantB, ids.userA, ids.userB],
      );
      await bootstrap.query(
        `INSERT INTO app_private.tenant_canary (id, tenant_id, created_by, label)
         VALUES
           ($1, $2, $3, 'sentinel-canary-a'),
           ($4, $5, $6, 'sentinel-canary-b')`,
        [ids.canaryA, ids.tenantA, ids.userA, ids.canaryB, ids.tenantB, ids.userB],
      );

      // Perform initial backup
      harness.initializeBackupRepository();
      const backupResult = harness.backup();
      assert.equal(backupResult.status, 0, backupResult.stderr);

      // Mutate origin to prove restore recovers original state
      await bootstrap.query(`DELETE FROM app_private.tenant_canary`);
      await bootstrap.query(`DELETE FROM iam.memberships`);
      await bootstrap.query(`DELETE FROM iam.principals`);
      await bootstrap.query(`DELETE FROM iam.tenants`);
    });

    after(async () => {
      await Promise.allSettled([bootstrap?.end()]);
      harness.cleanup();
    });

    test('executes isolated restore drill, verifies sentinels and writes RTO status', async () => {
      const drillResult = harness.restoreDrill();
      assert.equal(drillResult.status, 0, drillResult.stderr);

      const status = JSON.parse(readFileSync(harness.restoreDrillStatusPath, 'utf8'));
      assert.equal(status.status, 'ok');
      assert.equal(status.rto_compliant, true);
      assert.equal(typeof status.duration_seconds, 'number');
      assert.ok(status.duration_seconds <= 7200);

      // Verify origin database remains untouched (still deleted)
      const originTenants = await bootstrap.query(`SELECT count(*)::int AS count FROM iam.tenants`);
      assert.equal(originTenants.rows[0].count, 0);

      // Verify isolated restored database has recovered sentinels
      const restoredClient = new Client(harness.connectionConfig('bootstrap', { host: '127.0.0.1', isRestore: true }));
      // Note: postgres-restore has no published port in production, but in test harness we check via docker exec or query
      const restoredQuery = harness.queryRestoredDatabase('SELECT count(*)::int AS count FROM iam.tenants');
      assert.equal(Number.parseInt(restoredQuery.trim(), 10), 2);
    });

    test('fails closed if destination database is not empty before restore', () => {
      // Running restore drill again on the now non-empty postgres-restore database must fail
      const secondDrill = harness.restoreDrill();
      assert.notEqual(secondDrill.status, 0);
      assert.match(secondDrill.stderr, /not empty/i);
    });
  },
);
