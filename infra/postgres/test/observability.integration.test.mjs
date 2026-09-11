import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { Client } from 'pg';

import { dockerComposeAvailable, PostgresComposeHarness } from './helpers/postgres-compose.mjs';

function allKeys(object) {
  const keys = [];
  function collect(target) {
    if (target && typeof target === 'object') {
      for (const [key, value] of Object.entries(target)) {
        keys.push(key);
        collect(value);
      }
    }
  }
  collect(object);
  return keys;
}

describe(
  'PostgreSQL sanitized local observability against Docker runtime',
  { skip: dockerComposeAvailable() ? false : 'Docker Compose is unavailable' },
  () => {
    const harness = new PostgresComposeHarness({ port: 55435 });
    let bootstrap;

    before(async () => {
      harness.start();
      bootstrap = new Client(harness.connectionConfig('bootstrap'));
      await bootstrap.connect();
    });

    after(async () => {
      await Promise.allSettled([bootstrap?.end()]);
      harness.cleanup();
    });

    test('fails compliance with non-zero exit code when backup and drill have not run', () => {
      const result = harness.observe();
      assert.notEqual(result.status, 0);

      const jsonStart = result.stdout.indexOf('{');
      assert.ok(jsonStart >= 0, `JSON start not found in stdout: ${result.stdout}`);
      const report = JSON.parse(result.stdout.slice(jsonStart));
      assert.equal(report.compliance.status, 'critical');
      assert.equal(report.compliance.rpo_compliant, false);
      assert.equal(report.compliance.rpo_target_seconds, 3600);
      assert.equal(report.compliance.rto_target_seconds, 7200);

      const forbidden = /password|secret|dsn|query|statement|tenant_id|user_id|host/i;
      for (const key of allKeys(report)) {
        assert.doesNotMatch(key, forbidden);
      }
    });

    test('produces clean sanitized JSON report with zero exit code when backup and drill are fresh', async () => {
      await bootstrap.query(
        `INSERT INTO iam.tenants (id, slug, display_name)
         VALUES ('10000000-0000-4000-8000-000000000001', 'tenant-a', 'Tenant A'),
                ('10000000-0000-4000-8000-000000000002', 'tenant-b', 'Tenant B')`,
      );
      await bootstrap.query(
        `INSERT INTO iam.principals (id, external_subject)
         VALUES ('20000000-0000-4000-8000-000000000001', 'subject-a')`,
      );
      await bootstrap.query(
        `INSERT INTO iam.memberships (tenant_id, principal_id, role)
         VALUES ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'admin')`,
      );
      await bootstrap.query(
        `INSERT INTO app_private.tenant_canary (id, tenant_id, created_by, label)
         VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'canary')`,
      );

      harness.initializeBackupRepository();
      const backupResult = harness.backup();
      assert.equal(backupResult.status, 0, backupResult.stderr);

      const drillResult = harness.restoreDrill();
      assert.equal(drillResult.status, 0, drillResult.stderr);

      const result = harness.observe();
      assert.equal(result.status, 0, result.stderr);

      const jsonStart = result.stdout.indexOf('{');
      assert.ok(jsonStart >= 0, `JSON start not found in stdout: ${result.stdout}`);
      const report = JSON.parse(result.stdout.slice(jsonStart));
      assert.equal(report.database.available, true);
      assert.equal(typeof report.database.database_size_bytes, 'number');
      assert.equal(typeof report.database.connections_used, 'number');
      assert.equal(report.database.latest_migration_version, '0004');

      assert.equal(report.backup.status, 'ok');
      assert.match(report.backup.archive_sha256, /^[0-9a-f]{64}$/);
      assert.equal(typeof report.backup.age_seconds, 'number');

      assert.equal(report.restore_drill.status, 'ok');
      assert.equal(report.restore_drill.rto_compliant, true);
      assert.equal(typeof report.restore_drill.duration_seconds, 'number');

      assert.equal(report.compliance.status, 'healthy');
      assert.equal(report.compliance.rpo_compliant, true);
      assert.equal(report.compliance.rto_compliant, true);
      assert.equal(report.compliance.rpo_target_seconds, 3600);
      assert.equal(report.compliance.rto_target_seconds, 7200);

      const forbidden = /password|secret|dsn|query|statement|tenant_id|user_id|host/i;
      for (const key of allKeys(report)) {
        assert.doesNotMatch(key, forbidden);
      }
      assert.doesNotMatch(JSON.stringify(report), /password|secret|dsn/i);
    });
  },
);
