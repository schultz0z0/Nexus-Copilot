import { randomUUID } from 'node:crypto';
import pg from 'pg';

const connectionString = process.env.MARKETING_OPS_TEST_DATABASE_URL;
const adminConnectionString = process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL;
if (!connectionString || !adminConnectionString) {
  console.error('MARKETING_OPS_TEST_DATABASE_URL and MARKETING_OPS_TEST_ADMIN_DATABASE_URL are required');
  process.exit(2);
}
for (const candidate of [connectionString, adminConnectionString]) {
  const parsed = new URL(candidate);
  const local = ['127.0.0.1', 'localhost', 'postgres'].includes(parsed.hostname);
  if (!local && process.env.MARKETING_OPS_ALLOW_REMOTE_TEST_DB !== 'true') {
    console.error('Refusing a mutating concurrency test against a remote database');
    process.exit(2);
  }
}

const pool = new pg.Pool({ connectionString, max: 4 });
const adminPool = new pg.Pool({ connectionString: adminConnectionString, max: 2 });
let createdFixture = null;
try {
  const fixture = await adminPool.query(`
    select tenant_id,
      array_agg(principal_id order by principal_id)
        filter (where role = 'member') as requesters,
      array_agg(principal_id order by principal_id)
        filter (where role in ('manager', 'admin')) as deciders
    from iam.memberships
    where active
    group by tenant_id
    having count(*) filter (where role = 'member') >= 1
       and count(*) filter (where role in ('manager', 'admin')) >= 2
    limit 1
  `);
  const actors = fixture.rows[0];
  if (!actors) throw new Error('One member and two eligible manager/admin actors are required');
  const requesterId = actors.requesters[0];
  const setup = await adminPool.connect();
  try {
    await setup.query('begin');
    const campaign = await setup.query(`
      insert into marketing_ops.campaigns (tenant_id, name, created_by, updated_by)
      values ($1, $2, $3, $3)
      returning id
    `, [actors.tenant_id, `Concurrency ${randomUUID()}`, requesterId]);
    const campaignId = campaign.rows[0].id;
    await setup.query(`
      insert into marketing_ops.campaign_members (
        tenant_id, campaign_id, user_id, member_role, is_primary, created_by
      ) values ($1, $2, $3, 'owner', true, $3)
    `, [actors.tenant_id, campaignId, requesterId]);
    const packageResult = await setup.query(`
      insert into marketing_ops.action_packages (
        tenant_id, campaign_id, created_by, action_type, channel, audience_snapshot,
        time_zone, configuration, payload, payload_hash, expires_at
      ) values ($1, $2, $3, 'phase5.concurrency', 'email', '{}', 'UTC',
        '{}', '{"dryRun":true}', repeat('c',64), now() + interval '1 hour')
      returning id
    `, [actors.tenant_id, campaignId, requesterId]);
    const packageId = packageResult.rows[0].id;
    const requestResult = await setup.query(`
      insert into marketing_ops.approval_requests (
        tenant_id, campaign_id, kind, requested_by, reason, action_package_id,
        target_hash, expires_at
      ) values ($1, $2, 'operational', $3, 'isolated concurrency test',
        $4, repeat('c',64), now() + interval '1 hour')
      returning id
    `, [actors.tenant_id, campaignId, requesterId, packageId]);
    createdFixture = {
      tenantId: actors.tenant_id,
      campaignId,
      requestId: requestResult.rows[0].id,
      packageId
    };
    await setup.query('commit');
  } catch (error) {
    await setup.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    setup.release();
  }

  const deciders = await adminPool.query(`
    select principal_id as user_id, role::text
    from iam.memberships
    where tenant_id = $1 and active and role in ('manager', 'admin')
      and principal_id = any($2::uuid[])
    order by principal_id
    limit 2
  `, [createdFixture.tenantId, actors.deciders]);

  const decide = async ({ user_id: userId, role }) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const correlationId = randomUUID();
      await client.query("select set_config('app.user_id',$1,true)", [userId]);
      await client.query("select set_config('app.tenant_id',$1,true)", [createdFixture.tenantId]);
      await client.query("select set_config('app.actor_role',$1,true)", [role]);
      await client.query("select set_config('app.actor_type','user',true)");
      await client.query("select set_config('app.origin','rest',true)");
      await client.query("select set_config('app.correlation_id',$1,true)", [correlationId]);
      await client.query(`insert into marketing_ops.approval_decisions (
        tenant_id, request_id, decision, decided_by, decider_role,
        eligibility_snapshot, correlation_id
      ) values ($1,$2,'approved',$3,$4,'{}',$5)`,
      [createdFixture.tenantId, createdFixture.requestId, userId, role, correlationId]);
      await client.query(`update marketing_ops.approval_requests set status='approved',
        version=version+1 where id=$1 and status='pending'`, [createdFixture.requestId]);
      await client.query(`update marketing_ops.action_packages set status='authorized',
        authorized_by_request_id=$2, authorized_at=now(), version=version+1
        where id=$1 and status='pending_approval'`,
      [createdFixture.packageId, createdFixture.requestId]);
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      if (error?.code === '23505') return false;
      throw error;
    } finally {
      client.release();
    }
  };

  const results = await Promise.all(deciders.rows.map(decide));
  if (results.filter(Boolean).length !== 1) {
    throw new Error(`Expected one decision, got ${results}`);
  }
  const count = await adminPool.query(
    'select count(*)::int as count from marketing_ops.approval_decisions where request_id=$1',
    [createdFixture.requestId]
  );
  if (count.rows[0]?.count !== 1) throw new Error('Decision ledger contains duplicates');
  console.log('Approval concurrency OK: exactly one effective decision');
} finally {
  if (createdFixture) {
    const cleanup = await adminPool.connect();
    try {
      await cleanup.query('begin');
      await cleanup.query('set local session_replication_role = replica');
      await cleanup.query('delete from marketing_ops.approval_decisions where request_id=$1', [createdFixture.requestId]);
      await cleanup.query('delete from marketing_ops.approval_requests where id=$1', [createdFixture.requestId]);
      await cleanup.query('delete from marketing_ops.action_packages where id=$1', [createdFixture.packageId]);
      await cleanup.query('delete from marketing_ops.campaign_members where campaign_id=$1', [createdFixture.campaignId]);
      await cleanup.query('delete from marketing_ops.campaigns where id=$1', [createdFixture.campaignId]);
      await cleanup.query('commit');
    } catch (error) {
      await cleanup.query('rollback').catch(() => undefined);
      console.error('Concurrency fixture cleanup failed', error);
    } finally {
      cleanup.release();
    }
  }
  await Promise.all([pool.end(), adminPool.end()]);
}
