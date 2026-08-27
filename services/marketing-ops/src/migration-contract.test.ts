import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migration = new URL(
  '../../../apps/chat-web/supabase/migrations/20260722130000_phase_4_hermes_operator_audit.sql',
  import.meta.url
);

const phase5Migration = new URL(
  '../../../apps/chat-web/supabase/migrations/20260805175137_phase_5_governance_approvals.sql',
  import.meta.url
);

const phase5IndexesMigration = new URL(
  '../../../apps/chat-web/supabase/migrations/20260805180850_phase_5_approval_fk_indexes.sql',
  import.meta.url
);

const phase5WriteBoundaryMigration = new URL(
  '../../../apps/chat-web/supabase/migrations/20260805184508_phase_5_service_write_boundary.sql',
  import.meta.url
);

const phase5LedgerHardeningMigration = new URL(
  '../../../apps/chat-web/supabase/migrations/20260805190517_phase_5_transition_ledger_hardening.sql',
  import.meta.url
);

const phase5QueuePerformanceMigration = new URL(
  '../../../apps/chat-web/supabase/migrations/20260805191130_phase_5_queue_rls_performance.sql',
  import.meta.url
);

const phase5SystemExpiryMigration = new URL(
  '../../../apps/chat-web/supabase/migrations/20260805194650_phase_5_system_expiry_worker.sql',
  import.meta.url
);

const phase5AuditAdvisorMigration = new URL(
  '../../../apps/chat-web/supabase/migrations/20260805195732_phase_5_audit_advisor_followup.sql',
  import.meta.url
);

const phase5NotificationRlsFixMigration = new URL(
  '../../../apps/chat-web/supabase/migrations/20260806152536_phase_5_notification_rls_parameterized_fix.sql',
  import.meta.url
);

describe('Phase 4 audit migration contract', () => {
  it('adds every nullable correlation field and tenant-scoped index', async () => {
    const sql = (await readFile(migration, 'utf8')).toLowerCase();
    for (const column of [
      'operator_origin', 'chat_session_id', 'run_id', 'tool_name',
      'tool_call_id', 'plan_id', 'plan_action_index'
    ]) expect(sql).toContain(column);
    expect(sql).toContain('audit_events_chat_run_idx');
    expect(sql).toContain('audit_events_tool_call_idx');
    expect(sql).not.toContain('drop table');
  });
});

describe('Phase 5 governance migration contract', () => {
  it('creates explicit approval and action-package contracts without destructive DDL', async () => {
    const sql = (await readFile(phase5Migration, 'utf8')).toLowerCase();
    for (const type of [
      'approval_kind', 'approval_status', 'approval_risk', 'action_package_status'
    ]) expect(sql).toContain(`create type marketing_ops.${type}`);
    for (const table of [
      'approval_requests', 'approval_decisions', 'action_packages'
    ]) {
      expect(sql).toContain(`create table marketing_ops.${table}`);
      expect(sql).toContain(`alter table marketing_ops.${table} enable row level security`);
      expect(sql).toContain(`alter table marketing_ops.${table} force row level security`);
    }
    expect(sql).toContain('approval_requests_target_matches_kind');
    expect(sql).toContain('approval_decisions_append_only');
    expect(sql).toContain('action_packages_payload_immutable');
    expect(sql).toContain(
      'revoke all on table marketing_ops.approval_decisions from public, anon, authenticated, service_role'
    );
    expect(sql).not.toContain('drop table');
    expect(sql).not.toContain('drop type');
  });

  it('covers every Phase 5 foreign key used by integrity checks and joins', async () => {
    const sql = (await readFile(phase5IndexesMigration, 'utf8')).toLowerCase();
    for (const index of [
      'action_packages_campaign_fk_idx',
      'action_packages_created_by_fk_idx',
      'action_packages_authorized_request_fk_idx',
      'approval_requests_requested_by_fk_idx',
      'approval_requests_content_version_fk_idx',
      'approval_requests_action_package_fk_idx',
      'approval_requests_supersedes_fk_idx',
      'approval_decisions_request_fk_idx',
      'approval_decisions_decided_by_fk_idx'
    ]) expect(sql).toContain(`create index ${index}`);
    expect(sql).not.toContain('drop table');
    expect(sql).not.toContain('drop index');
  });

  it('requires the trusted service context and enforces state-machine transitions', async () => {
    const sql = (await readFile(phase5WriteBoundaryMigration, 'utf8')).toLowerCase();
    expect(sql).toContain('require_approval_service_context');
    expect(sql).toContain('enforce_approval_request_transition');
    expect(sql).toContain('enforce_action_package_transition');
    expect(sql).toContain("current_setting('marketing_ops.correlation_id', true)");
    expect(sql).toContain('approval request transition requires its matching decision');
    expect(sql).toContain('authorized package requires its approved request and decision');
    expect(sql).not.toContain('drop table');
  });

  it('records every terminal transition and validates replacement cycles at the database boundary', async () => {
    const sql = (await readFile(phase5LedgerHardeningMigration, 'utf8')).toLowerCase();
    expect(sql).toContain("decision = 'cancelled'");
    expect(sql).toContain("decision = 'expired'");
    expect(sql).toContain('validate_approval_supersession');
    expect(sql).toContain('require_approval_notification_context');
    expect(sql).toContain('approval request transition requires its matching decision');
    expect(sql).not.toContain('drop table');
  });

  it('resolves queue visibility once and indexes the descending cursor order', async () => {
    const sql = (await readFile(phase5QueuePerformanceMigration, 'utf8')).toLowerCase();
    expect(sql).toContain('accessible_campaign_ids');
    expect(sql).toContain('approval_requests_queue_order_idx');
    expect(sql).toContain('(tenant_id, status, created_at desc, id desc)');
    expect(sql).not.toContain('drop table');
  });

  it('attributes bounded expiration to the trusted system worker rather than a human reader', async () => {
    const sql = (await readFile(phase5SystemExpiryMigration, 'utf8')).toLowerCase();
    expect(sql).toContain("decision_origin = 'system'");
    expect(sql).toContain("system_origin = 'approval_expiry_worker'");
    expect(sql).toContain("actor_type = 'service'");
    expect(sql).toContain("values ('5.0.3'");
    expect(sql).not.toContain('drop table');
  });

  it('covers the audit actor foreign key and hoists auth evaluation out of each row', async () => {
    const sql = (await readFile(phase5AuditAdvisorMigration, 'utf8')).toLowerCase();
    expect(sql).toContain('audit_events_actor_user_fk_idx');
    expect(sql).toContain('(select auth.uid())');
    expect(sql).toContain('(select marketing_ops_private.current_actor_role(tenant_id))');
    expect(sql).toContain("values ('5.0.4'");
    expect(sql).not.toContain('drop table');
  });

  it('evaluates row-dependent notification authorization per inserted row', async () => {
    const sql = (await readFile(phase5NotificationRlsFixMigration, 'utf8')).toLowerCase();
    expect(sql).toContain('drop policy in_app_notifications_insert');
    expect(sql).toContain('marketing_ops_private.can_edit_campaign_item(item_id)');
    expect(sql).toContain('marketing_ops_private.can_access_approval_request(approval_request_id)');
    expect(sql).not.toContain('(select marketing_ops_private.can_edit_campaign_item(item_id))');
    expect(sql).not.toContain('(select marketing_ops_private.can_access_approval_request(approval_request_id))');
    expect(sql).toContain("values ('5.0.5'");
    expect(sql).not.toContain('security definer');
    expect(sql).not.toContain('drop table');
  });
});
