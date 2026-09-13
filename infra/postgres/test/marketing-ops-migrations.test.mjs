import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationsDirectory = new URL('../migrations/', import.meta.url);
const migration = (name) => readFileSync(new URL(name, migrationsDirectory), 'utf8').toLowerCase();

test('0006 creates the canonical Marketing Ops tables without parallel IAM authorities', () => {
  const sql = migration('0006_marketing_ops_core.sql');
  const canonicalTables = [
    'campaigns', 'campaign_members', 'campaign_materials',
    'campaign_items', 'item_dependencies',
    'content_assets', 'content_versions', 'item_artifacts',
    'approval_requests', 'approval_decisions', 'action_packages',
    'audit_events', 'domain_events', 'idempotency_records',
    'delegation_uses', 'in_app_notifications',
  ];

  for (const table of canonicalTables) {
    assert.match(sql, new RegExp(`create table marketing_ops\\.${table}\\b`));
  }

  for (const rejected of ['tenants', 'memberships', 'schema_versions']) {
    assert.doesNotMatch(sql, new RegExp(`create table marketing_ops\\.${rejected}\\b`));
  }

  assert.match(sql, /references iam\.tenants\s*\(id\)/);
  assert.match(sql, /references iam\.principals\s*\(id\)/);
  assert.doesNotMatch(sql, /\bauth\.uid\s*\(/);
  assert.doesNotMatch(sql, /\b(?:anon|authenticated|service_role)\b/);
  assert.doesNotMatch(sql, /drop\s+(?:table|schema|type)/);
});

test('canonical Marketing Ops migrations keep security, integrity and indexes separate', () => {
  const security = migration('0007_marketing_ops_security.sql');
  const integrity = migration('0008_marketing_ops_integrity.sql');
  const indexes = migration('0009_marketing_ops_indexes.sql');

  assert.match(security, /force row level security/);
  assert.match(security, /app\.tenant_id/);
  assert.match(integrity, /append.only|immutable/);
  assert.match(indexes, /create index/);
});

