import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const postgresMigration = (name: string) => new URL(
  `../../../infra/postgres/migrations/${name}`,
  import.meta.url
);

async function sql(name: string): Promise<string> {
  return (await readFile(postgresMigration(name), 'utf8')).toLowerCase();
}

describe('canonical Marketing Ops migration contract', () => {
  it('creates only the domain tables and points identity at IAM', async () => {
    const core = await sql('0006_marketing_ops_core.sql');
    for (const table of [
      'campaigns', 'campaign_members', 'campaign_materials',
      'campaign_items', 'item_dependencies', 'content_assets',
      'content_versions', 'item_artifacts', 'approval_requests',
      'approval_decisions', 'action_packages', 'audit_events',
      'domain_events', 'idempotency_records', 'delegation_uses',
      'in_app_notifications'
    ]) expect(core).toContain(`create table marketing_ops.${table}`);

    expect(core).toContain('references iam.tenants (id)');
    expect(core).toContain('references iam.principals (id)');
    expect(core).not.toContain('create table marketing_ops.tenants');
    expect(core).not.toContain('create table marketing_ops.memberships');
    expect(core).not.toContain('create table marketing_ops.schema_versions');
  });

  it('uses canonical app context and nexus roles instead of Supabase primitives', async () => {
    const security = await sql('0007_marketing_ops_security.sql');
    expect(security).toContain("current_setting('app.tenant_id', true)");
    expect(security).toContain("current_setting('app.user_id', true)");
    expect(security).toContain('to nexus_app');
    expect(security).not.toMatch(/auth\.uid\s*\(/);
    expect(security).not.toMatch(/\b(?:anon|authenticated|service_role)\b/);
  });

  it('enforces immutable ledgers and state transitions', async () => {
    const integrity = await sql('0008_marketing_ops_integrity.sql');
    expect(integrity).toContain('approval_decisions_append_only');
    expect(integrity).toContain('audit_events_append_only');
    expect(integrity).toContain('content_versions_append_only');
    expect(integrity).toContain('action_packages_payload_immutable');
    expect(integrity).not.toContain('drop table');
  });

  it('indexes foreign keys and cursor-ordered operational queues', async () => {
    const indexes = await sql('0009_marketing_ops_indexes.sql');
    for (const index of [
      'campaigns_tenant_updated_idx',
      'campaign_items_schedule_idx',
      'approval_requests_queue_order_idx',
      'domain_events_pending_idx',
      'in_app_notifications_user_order_idx'
    ]) expect(indexes).toContain(`create index ${index}`);
  });
});

