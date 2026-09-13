import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expireApprovalRequestsBatch } from '../dist/domain/approvalExpiryWorker.js';

const databaseUrl = process.env.MARKETING_OPS_TEST_DATABASE_URL;
const adminDatabaseUrl = process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL;
if (!databaseUrl || !adminDatabaseUrl) {
  throw new Error('MARKETING_OPS_TEST_DATABASE_URL and MARKETING_OPS_TEST_ADMIN_DATABASE_URL are required');
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const adminPool = new pg.Pool({ connectionString: adminDatabaseUrl, max: 2 });
const requestId = randomUUID();
const packageId = randomUUID();
let campaignId;

async function cleanup() {
  const client = await adminPool.connect();
  try {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    await client.query('delete from marketing_ops.in_app_notifications where approval_request_id = $1', [requestId]);
    await client.query("delete from marketing_ops.audit_events where entity_type = 'approval_request' and entity_id = $1", [requestId]);
    await client.query("delete from marketing_ops.domain_events where aggregate_type = 'approval_request' and aggregate_id = $1", [requestId]);
    await client.query('delete from marketing_ops.approval_decisions where request_id = $1', [requestId]);
    await client.query('delete from marketing_ops.approval_requests where id = $1', [requestId]);
    await client.query('delete from marketing_ops.action_packages where id = $1', [packageId]);
    if (campaignId) {
      await client.query('delete from marketing_ops.campaign_members where campaign_id = $1', [campaignId]);
      await client.query('delete from marketing_ops.campaigns where id = $1', [campaignId]);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

try {
  const fixture = await adminPool.query(`
    select tenant_id, principal_id as user_id
    from iam.memberships
    where active and role in ('manager', 'admin')
    order by created_at, principal_id
    limit 1
  `);
  const actor = fixture.rows[0];
  if (!actor) throw new Error('Expiry smoke requires one active manager/admin membership fixture');

  const client = await adminPool.connect();
  try {
    await client.query('begin');
    const campaign = await client.query(`
      insert into marketing_ops.campaigns (tenant_id, name, created_by, updated_by)
      values ($1, $2, $3, $3)
      returning id
    `, [actor.tenant_id, `Expiry ${randomUUID()}`, actor.user_id]);
    campaignId = campaign.rows[0].id;
    await client.query(`
      insert into marketing_ops.campaign_members (
        tenant_id, campaign_id, user_id, member_role, is_primary, created_by
      ) values ($1, $2, $3, 'owner', true, $3)
    `, [actor.tenant_id, campaignId, actor.user_id]);
    await client.query(`
      insert into marketing_ops.action_packages (
        id, tenant_id, campaign_id, created_by, action_type, channel,
        audience_snapshot, time_zone, configuration, payload, payload_hash,
        expires_at, created_at, updated_at
      ) values ($1, $2, $3, $4, 'phase5.expiry-smoke', 'internal', '{}', 'UTC',
        '{}', '{"smoke":true}', $5, now() - interval '1 minute',
        now() - interval '2 minutes', now() - interval '2 minutes')
    `, [packageId, actor.tenant_id, campaignId, actor.user_id, 'b'.repeat(64)]);
    await client.query(`
      insert into marketing_ops.approval_requests (
        id, tenant_id, campaign_id, kind, requested_by, reason, risk_level,
        action_package_id, target_hash, expires_at, created_at, updated_at
      ) values ($1, $2, $3, 'operational', $4, 'phase5 expiry worker smoke',
        'medium', $5, $6, now() - interval '1 minute',
        now() - interval '2 minutes', now() - interval '2 minutes')
    `, [requestId, actor.tenant_id, campaignId, actor.user_id, packageId, 'b'.repeat(64)]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const result = await expireApprovalRequestsBatch(pool, {
    tenantId: actor.tenant_id,
    requestId,
    limit: 1
  });
  if (result.expired !== 1) {
    throw new Error(`Expected one expired request, received ${result.expired}`);
  }

  const evidence = await adminPool.query(`
    select request.status, package.status as package_status,
      decision.decision_origin, decision.decided_by, decision.decider_role,
      audit.actor_type, audit.origin,
      exists(select 1 from marketing_ops.domain_events event
        where event.aggregate_id = request.id and event.event_type = 'marketing_ops.approval.expired.v1') as event_recorded,
      exists(select 1 from marketing_ops.in_app_notifications notification
        where notification.approval_request_id = request.id
          and notification.notification_type = 'approval_status') as notification_recorded
    from marketing_ops.approval_requests request
    join marketing_ops.action_packages package on package.id = request.action_package_id
    join marketing_ops.approval_decisions decision on decision.request_id = request.id
    join marketing_ops.audit_events audit on audit.entity_id = request.id
      and audit.action = 'approval.expired'
    where request.id = $1
  `, [requestId]);
  const row = evidence.rows[0];
  if (!row || row.status !== 'expired' || row.package_status !== 'expired' ||
    row.decision_origin !== 'system' || row.decided_by !== null || row.decider_role !== null ||
    row.actor_type !== 'service' || row.origin !== 'internal' ||
    !row.event_recorded || !row.notification_recorded) {
    throw new Error(`Expiry worker evidence mismatch: ${JSON.stringify(row)}`);
  }
  console.log('approval_expiry_worker_smoke expired=1 origin=system audit=service event=1 notification=1');
} finally {
  await cleanup().catch((error) => console.error('expiry smoke cleanup failed', error));
  const remaining = await adminPool.query(`
    select
      (select count(*)::integer from marketing_ops.approval_requests where id = $1) +
      (select count(*)::integer from marketing_ops.action_packages where id = $2) +
      (select count(*)::integer from marketing_ops.approval_decisions where request_id = $1) as count
  `, [requestId, packageId]);
  console.log(`approval_expiry_worker_cleanup remaining=${remaining.rows[0]?.count ?? -1}`);
  await Promise.all([pool.end(), adminPool.end()]);
}
