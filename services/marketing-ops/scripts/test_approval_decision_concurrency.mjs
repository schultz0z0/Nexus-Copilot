import pg from 'pg';

const connectionString = process.env.MARKETING_OPS_TEST_DATABASE_URL ??
  process.env.NEXUS_SUPABASE_DATABASE_URL;
if (!connectionString) {
  console.error('MARKETING_OPS_TEST_DATABASE_URL is required');
  process.exit(2);
}
const parsed = new URL(connectionString);
const local = ['127.0.0.1', 'localhost', 'supabase-db'].includes(parsed.hostname);
if (!local && process.env.MARKETING_OPS_ALLOW_REMOTE_TEST_DB !== 'true') {
  console.error('Refusing a mutating concurrency test against a remote database');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString, max: 4 });
let createdRequest = null;
try {
  const setup = await pool.connect();
  let fixture;
  try {
    await setup.query("select set_config('marketing_ops.correlation_id',$1,false)", [crypto.randomUUID()]);
    fixture = await setup.query(`
    with actors as (
      select tenant_id, array_agg(user_id order by user_id) as users
      from marketing_ops.memberships
      where active and role in ('manager', 'admin') group by tenant_id having count(*) >= 3 limit 1
    ), campaign as (
      select campaign.id, campaign.tenant_id, actors.users
      from actors join lateral (
        select * from marketing_ops.campaigns
        where tenant_id = actors.tenant_id and status <> 'archived'
        order by created_at limit 1
      ) campaign on true
    ), package as (
      insert into marketing_ops.action_packages (
        tenant_id, campaign_id, created_by, action_type, channel, audience_snapshot,
        time_zone, configuration, payload, payload_hash, expires_at
      ) select tenant_id, id, users[1], 'phase5.concurrency', 'email', '{}', 'UTC',
        '{}', '{"dryRun":true}', repeat('c',64), now() + interval '1 hour' from campaign
      returning id, tenant_id, campaign_id, created_by
    )
    insert into marketing_ops.approval_requests (
      tenant_id, campaign_id, kind, requested_by, reason, action_package_id,
      target_hash, expires_at
    ) select tenant_id, campaign_id, 'operational', created_by, 'isolated concurrency test',
      id, repeat('c',64), now() + interval '1 hour' from package
    returning id, tenant_id, requested_by, action_package_id
    `);
  } finally { setup.release(); }
  const request = fixture.rows[0];
  if (!request) throw new Error('Three eligible fixture actors and a campaign are required');
  createdRequest = request;
  const actors = await pool.query(`
    select user_id, role::text from marketing_ops.memberships
    where tenant_id = $1 and active and role in ('manager','admin') and user_id <> $2
    order by user_id limit 2
  `, [request.tenant_id, request.requested_by]);

  const decide = async ({ user_id, role }) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user_id]);
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user_id, role: 'authenticated' })]);
      await client.query("select set_config('marketing_ops.tenant_id',$1,true)", [request.tenant_id]);
      const correlationId = crypto.randomUUID();
      await client.query("select set_config('marketing_ops.correlation_id',$1,true)", [correlationId]);
      await client.query('set local role authenticated');
      await client.query(`insert into marketing_ops.approval_decisions (
        tenant_id, request_id, decision, decided_by, decider_role,
        eligibility_snapshot, correlation_id
      ) values ($1,$2,'approved',$3,$4,'{}',$5)`,
      [request.tenant_id, request.id, user_id, role, correlationId]);
      await client.query(`update marketing_ops.approval_requests set status='approved',
        version=version+1 where id=$1 and status='pending'`, [request.id]);
      await client.query(`update marketing_ops.action_packages set status='authorized',
        authorized_by_request_id=$2, authorized_at=now(), version=version+1
        where id=$1 and status='pending_approval'`, [request.action_package_id, request.id]);
      await client.query('commit');
      return true;
    } catch (error) {
      await client.query('rollback');
      if (error?.code === '23505' || error?.code === '42501') return false;
      throw error;
    } finally { client.release(); }
  };

  const results = await Promise.all(actors.rows.map(decide));
  if (results.filter(Boolean).length !== 1) throw new Error(`Expected one decision, got ${results}`);
  const count = await pool.query('select count(*)::int as count from marketing_ops.approval_decisions where request_id=$1', [request.id]);
  if (count.rows[0]?.count !== 1) throw new Error('Decision ledger contains duplicates');
  console.log('Approval concurrency OK: exactly one effective decision');
} finally {
  if (createdRequest) {
    const cleanup = await pool.connect();
    try {
      await cleanup.query('begin');
      await cleanup.query('set local session_replication_role = replica');
      await cleanup.query('delete from marketing_ops.approval_decisions where request_id=$1', [createdRequest.id]);
      await cleanup.query('delete from marketing_ops.approval_requests where id=$1', [createdRequest.id]);
      await cleanup.query('delete from marketing_ops.action_packages where id=$1', [createdRequest.action_package_id]);
      await cleanup.query('commit');
    } catch (error) {
      await cleanup.query('rollback');
      console.error('Concurrency fixture cleanup failed', error);
    } finally { cleanup.release(); }
  }
  await pool.end();
}
