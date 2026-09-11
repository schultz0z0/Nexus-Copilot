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
  'PostgreSQL encrypted backup against Docker runtime',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const harness = new PostgresComposeHarness({ port: 55438 });
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
    });

    after(async () => {
      await Promise.allSettled([bootstrap?.end()]);
      harness.cleanup();
    });

    test('creates encrypted logical backup and writes sanitized status report', () => {
      harness.initializeBackupRepository();
      const result = harness.backup();
      assert.equal(result.status, 0, result.stderr);

      const status = JSON.parse(readFileSync(harness.backupStatusPath, 'utf8'));
      assert.equal(status.status, 'ok');
      assert.match(status.archive_sha256, /^[0-9a-f]{64}$/);
      assert.equal(status.rpo_seconds, 3600);
      assert.doesNotMatch(JSON.stringify(status), /password|postgresql:\/\//i);

      // Verify snapshots with valid password
      const snapshots = harness.restic(['snapshots', '--json']);
      assert.equal(snapshots.status, 0, snapshots.stderr);
      const snapshotList = JSON.parse(snapshots.stdout);
      assert.ok(Array.isArray(snapshotList));
      assert.ok(snapshotList.length > 0);
      assert.ok(snapshotList[0].tags.includes('logical'));
      assert.ok(snapshotList[0].tags.includes('nexus-postgres'));

      // Verify snapshots with invalid password fails without leaking password
      const wrongPasswordFile = join(harness.secretDirectory, 'wrong-password.txt');
      writeFileSync(wrongPasswordFile, 'wrong-password-value\n', { mode: 0o600 });
      const badResult = harness.restic(['snapshots'], wrongPasswordFile);
      assert.notEqual(badResult.status, 0);
      assert.doesNotMatch(badResult.stderr, /wrong-password-value/i);
      assert.doesNotMatch(badResult.stdout, /wrong-password-value/i);
    });
  },
);
