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

test('0007 applies forced tenant RLS through canonical app context', () => {
  const security = migration('0007_marketing_ops_security.sql');
  assert.match(security, /force row level security/);
  assert.match(security, /app_private\.request_tenant_id\(\)/);
});

test('0008 keeps immutable records append-only', () => {
  const integrity = migration('0008_marketing_ops_integrity.sql');
  assert.match(integrity, /append.only|immutable/);
});

test('0009 creates operational indexes', () => {
  const indexes = migration('0009_marketing_ops_indexes.sql');
  assert.match(indexes, /create index/);
});

test('0010 records idempotent migration runs without product-data authority', () => {
  const control = migration('0010_marketing_ops_migration_control.sql');
  assert.match(control, /create schema migration_control authorization nexus_owner/);
  assert.match(control, /manifest_fingerprint text not null unique/);
  assert.match(control, /marketing_ops_staging_rows/);
  assert.doesNotMatch(control, /grant .*nexus_app/);
});

test('0011 aligns campaign briefing with the nullable text domain contract', () => {
  const compatibility = migration('0011_marketing_ops_campaign_contract.sql');
  assert.match(compatibility, /alter column briefing type text/);
  assert.match(compatibility, /alter column briefing drop not null/);
  assert.match(compatibility, /campaigns_briefing_length/);
});

test('0012 installs the canonical domain helper API without legacy auth claims', () => {
  const helpers = migration('0012_marketing_ops_domain_helpers.sql');
  for (const name of [
    'can_edit_campaign', 'can_edit_campaign_item', 'can_edit_content_asset',
    'list_campaign_participants', 'list_campaign_participant_candidates',
    'list_production_schedule', 'list_campaign_timeline', 'create_content_version'
  ]) {
    assert.match(helpers, new RegExp(`function marketing_ops_private\\.${name}`));
  }
  assert.match(helpers, /app_private\.request_user_id\(\)/);
  assert.match(helpers, /app_private\.request_tenant_id\(\)/);
  assert.doesNotMatch(helpers, /auth\.uid|request\.jwt|authenticated|service_role/);
});

test('0013 preserves structured legacy item content as JSONB', () => {
  const compatibility = migration('0013_marketing_ops_item_content_contract.sql');
  assert.match(compatibility, /alter column content type jsonb/);
  assert.match(compatibility, /jsonb_typeof\(content\) = 'object'/);
});

test('0014 enforces assignee tenancy and stable dependency error contracts', () => {
  const integrity = migration('0014_marketing_ops_assignment_integrity.sql');
  assert.match(integrity, /campaign_items_assignee_authorized/);
  assert.match(integrity, /item_dependencies_same_campaign/);
  assert.match(integrity, /item_dependencies_acyclic/);
  assert.match(integrity, /iam\.memberships/);
});

test('0015 represents delegated Hermes users in the audit actor type', () => {
  const compatibility = migration('0015_marketing_ops_delegated_actor.sql');
  assert.match(compatibility, /alter type marketing_ops\.actor_type add value 'delegated_user'/);
});

test('0016 allows an idempotent plan retry only with a fresh delegation JTI', () => {
  const compatibility = migration('0016_marketing_ops_delegation_retry.sql');
  assert.match(compatibility, /drop constraint delegation_uses_tenant_id_actor_id_operation_idempotency_ke_key/);
  assert.doesNotMatch(compatibility, /drop constraint delegation_uses_pkey/);
});

test('0017 creates durable prepared agent plans with forced tenant RLS and immutable identity', () => {
  const sql = migration('0017_marketing_ops_prepared_plans.sql');
  assert.match(sql, /create table marketing_ops\.prepared_agent_plans\b/);
  for (const field of [
    'id', 'tenant_id', 'prepared_by', 'chat_session_id', 'source_run_id',
    'prepared_delegation_jti', 'plan_hash', 'actions', 'required_scopes',
    'status', 'expires_at', 'execution_key', 'execution_started_at',
    'execution_attempts', 'result', 'executed_by', 'executed_at',
    'created_at', 'updated_at'
  ]) {
    assert.match(sql, new RegExp(`\\b${field}\\b`));
  }
  assert.match(sql, /references iam\.tenants\s*\(id\)/);
  assert.match(sql, /references iam\.principals\s*\(id\)/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /grant (?:select|insert|update).*on(?: table)? marketing_ops\.prepared_agent_plans to nexus_app/);
  assert.doesNotMatch(sql, /grant delete on(?: table)? marketing_ops\.prepared_agent_plans to nexus_app/);
  assert.doesNotMatch(sql, /\b(plan_token|delegation_token)\b/);
  assert.match(sql, /idx_prepared_agent_plans_pending/);
  assert.match(sql, /prepared_agent_plans_execution_key_unique|unique\s*\(tenant_id,\s*execution_key\)/);
});
