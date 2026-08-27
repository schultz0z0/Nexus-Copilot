import pg from "pg";

const { Client } = pg;

const databaseUrl =
  process.env.MARKETING_OPS_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignId = "c1111111-1111-4111-8111-111111111111";
const itemId = "e2222222-2222-4222-8222-222222222222";
const primaryOwnerId = "11111111-1111-4111-8111-111111111111";
const managerId = "22222222-2222-4222-8222-222222222222";
const viewerId = "61616161-6161-4616-8161-616161616161";
const nonparticipantId = "62626262-6262-4626-8262-626262626262";
const fixtureUserIds = [viewerId, nonparticipantId];

const clients = [];
let fixtureClient;

function assertTestDatabaseAllowed() {
  const hostname = new URL(databaseUrl).hostname;
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (
    !loopbackHosts.has(hostname) &&
    process.env.MARKETING_OPS_ALLOW_REMOTE_TEST_DATABASE !== "true"
  ) {
    throw new Error(
      "refusing to create concurrency fixtures on a remote database; use the dedicated VPS validation script",
    );
  }
}

async function connect(applicationName) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("select set_config('application_name', $1, false)", [applicationName]);
  clients.push(client);
  return client;
}

async function beginAs(client, actorId, lockTimeout = "5s") {
  await client.query("begin");
  await client.query("set local deadlock_timeout = '100ms'");
  await client.query(`set local lock_timeout = '${lockTimeout}'`);
  await client.query("set local statement_timeout = '8s'");
  await client.query("set local role authenticated");
  await client.query(
    "select set_config('request.jwt.claim.sub', $1, true), set_config('marketing_ops.tenant_id', $2, true)",
    [actorId, tenantId],
  );
}

async function beginAsManager(client, lockTimeout) {
  await beginAs(client, managerId, lockTimeout);
}

async function deleteFixtures(client) {
  await client.query("delete from marketing_ops.campaign_items where id = $1", [itemId]);
  await client.query(
    `
      delete from marketing_ops.campaign_members
      where campaign_id = $1
        and user_id = any($2::uuid[])
    `,
    [campaignId, fixtureUserIds],
  );
  await client.query(
    `
      delete from marketing_ops.memberships
      where tenant_id = $1
        and user_id = any($2::uuid[])
    `,
    [tenantId, fixtureUserIds],
  );
  await client.query("delete from auth.users where id = any($1::uuid[])", [fixtureUserIds]);
}

async function prepareFixtures() {
  fixtureClient = await connect("phase2_campaign_fixture_setup");
  await fixtureClient.query("begin");
  try {
    await deleteFixtures(fixtureClient);
    await fixtureClient.query(
      `
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          confirmation_token, recovery_token, email_change_token_new, email_change,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        )
        values
          (
            '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
            'phase2-viewer-concurrency@local.test', crypt('local-test-password', gen_salt('bf')),
            now(), '', '', '', '',
            jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
            '{}'::jsonb, now(), now()
          ),
          (
            '00000000-0000-0000-0000-000000000000', $2, 'authenticated', 'authenticated',
            'phase2-nonparticipant-concurrency@local.test', crypt('local-test-password', gen_salt('bf')),
            now(), '', '', '', '',
            jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
            '{}'::jsonb, now(), now()
          )
      `,
      fixtureUserIds,
    );
    await fixtureClient.query(
      `
        insert into marketing_ops.memberships (tenant_id, user_id, role, active)
        values ($1, $2, 'member', true), ($1, $3, 'member', true)
      `,
      [tenantId, ...fixtureUserIds],
    );
    await fixtureClient.query(
      `
        insert into marketing_ops.campaign_members (
          tenant_id, campaign_id, user_id, member_role, is_primary, created_by
        ) values ($1, $2, $3, 'viewer', false, $4)
      `,
      [tenantId, campaignId, viewerId, managerId],
    );
    await fixtureClient.query(
      `
        insert into marketing_ops.campaign_items (
          id, tenant_id, campaign_id, kind, title, content, created_by, updated_by
        ) values ($1, $2, $3, 'concurrency-probe', 'Task 2 concurrency probe', '{}'::jsonb, $4, $4)
      `,
      [itemId, tenantId, campaignId, managerId],
    );
    await fixtureClient.query("commit");
  } catch (error) {
    await fixtureClient.query("rollback");
    throw error;
  }
}

async function cleanupFixtures() {
  if (!fixtureClient) return;
  await fixtureClient.query("begin");
  try {
    await deleteFixtures(fixtureClient);
    await fixtureClient.query("commit");
  } catch (error) {
    await fixtureClient.query("rollback");
    throw error;
  }
}

async function waitUntilBlocked(observer, applicationName) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      `
        select wait_event_type, wait_event, pg_blocking_pids(pid) as blocking_pids
        from pg_stat_activity
        where application_name = $1
          and state = 'active'
      `,
      [applicationName],
    );
    const row = result.rows[0];
    if (row?.wait_event_type === "Lock" && row.blocking_pids.length > 0) {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${applicationName} to block`);
}

function observe(side, promise) {
  return promise.then(
    (value) => ({ side, ok: true, value }),
    (error) => ({ side, ok: false, error }),
  );
}

async function updateCampaign(client) {
  return client.query(
    `
      update marketing_ops.campaigns
      set notes = coalesce(notes, ''),
          version = version + 1,
          updated_by = $1
      where id = $2
    `,
    [managerId, campaignId],
  );
}

async function exerciseParticipantAggregateOrder() {
  const sessionA = await connect("phase2_participant_order_a");
  const sessionB = await connect("phase2_participant_order_b");
  const observer = await connect("phase2_participant_order_observer");

  await beginAsManager(sessionA);
  await beginAsManager(sessionB);
  await updateCampaign(sessionA);

  const participantUpdate = `
    update marketing_ops.campaign_members
    set member_role = member_role
    where campaign_id = $1
      and user_id = $2
  `;

  const bResult = observe(
    "B",
    sessionB.query(participantUpdate, [campaignId, primaryOwnerId]),
  );
  const blocked = await waitUntilBlocked(observer, "phase2_participant_order_b");
  console.log(
    `participant path: session B blocked on ${blocked.wait_event_type}/${blocked.wait_event}`,
  );

  const aResult = observe(
    "A",
    sessionA.query(participantUpdate, [campaignId, primaryOwnerId]),
  );
  const first = await Promise.race([aResult, bResult]);

  let deadlock = !first.ok && first.error?.code === "40P01" ? first : null;
  if (first.side === "A") {
    await sessionA.query("rollback");
    const second = await bResult;
    if (!second.ok && second.error?.code === "40P01") deadlock = second;
    await sessionB.query("rollback");
  } else {
    await sessionB.query("rollback");
    const second = await aResult;
    if (!second.ok && second.error?.code === "40P01") deadlock = second;
    await sessionA.query("rollback");
  }

  if (deadlock) {
    throw Object.assign(
      new Error(`participant lock order deadlocked in session ${deadlock.side}`),
      { code: "40P01" },
    );
  }
  if (!first.ok) throw first.error;
}

async function exerciseItemAggregateOrder() {
  const sessionA = await connect("phase2_item_order_a");
  const sessionB = await connect("phase2_item_order_b");
  const observer = await connect("phase2_item_order_observer");

  await beginAsManager(sessionA);
  await beginAsManager(sessionB);
  await updateCampaign(sessionA);

  const itemUpdate = `
    update marketing_ops.campaign_items
    set title = title,
        version = version + 1,
        updated_by = $1
    where id = $2
      and campaign_id = $3
  `;
  const bItem = observe(
    "B-item",
    sessionB.query(itemUpdate, [managerId, itemId, campaignId]),
  );
  const earlyBItem = await Promise.race([
    bItem,
    new Promise((resolve) => setTimeout(() => resolve(null), 200)),
  ]);

  if (earlyBItem === null) {
    const blocked = await waitUntilBlocked(observer, "phase2_item_order_b");
    console.log(`item path: session B blocked on ${blocked.wait_event_type}/${blocked.wait_event}`);

    const aItem = await sessionA.query(itemUpdate, [managerId, itemId, campaignId]);
    if (aItem.rowCount !== 1) throw new Error("session A did not update the item fixture");
    await sessionA.query("rollback");

    const completedBItem = await bItem;
    if (!completedBItem.ok) throw completedBItem.error;
    if (completedBItem.value.rowCount !== 1) {
      throw new Error("session B did not update the item fixture after aggregate unlock");
    }
    await sessionB.query("rollback");
    return;
  }

  if (!earlyBItem.ok) throw earlyBItem.error;
  if (earlyBItem.value.rowCount !== 1) {
    throw new Error("item fixture was not visible to the manager session");
  }

  const bCampaign = observe("B-campaign", updateCampaign(sessionB));
  await waitUntilBlocked(observer, "phase2_item_order_b");
  const aItem = observe(
    "A-item",
    sessionA.query(itemUpdate, [managerId, itemId, campaignId]),
  );
  const [aOutcome, bOutcome] = await Promise.all([aItem, bCampaign]);
  await Promise.allSettled([
    sessionA.query("rollback"),
    sessionB.query("rollback"),
  ]);

  const deadlock = [aOutcome, bOutcome].find(
    (outcome) => !outcome.ok && outcome.error?.code === "40P01",
  );
  if (deadlock) {
    throw Object.assign(
      new Error("campaign_items acquired a row lock before the campaign aggregate lock"),
      { code: "40P01" },
    );
  }
  if (!aOutcome.ok) throw aOutcome.error;
  if (!bOutcome.ok) throw bOutcome.error;
  throw new Error("campaign_items bypassed the aggregate lock without reproducing the expected deadlock");
}

async function assertUnauthorizedCannotBlock(actorId, label) {
  const unauthorized = await connect(`phase2_${label}_lock_probe`);
  const authorized = await connect(`phase2_${label}_lock_control`);

  try {
    await beginAs(unauthorized, actorId);
    const denied = await unauthorized.query(
      "select marketing_ops_private.can_edit_campaign($1) as allowed",
      [campaignId],
    );
    if (denied.rows[0]?.allowed !== false) {
      throw new Error(`${label} unexpectedly received campaign mutation authority`);
    }

    await beginAsManager(authorized, "500ms");
    try {
      const control = await authorized.query(
        "select marketing_ops_private.can_edit_campaign($1) as allowed",
        [campaignId],
      );
      if (control.rows[0]?.allowed !== true) {
        throw new Error(`manager control failed after ${label} probe`);
      }
    } catch (error) {
      if (error.code === "55P03") {
        throw new Error(`${label} acquired and retained the campaign aggregate lock`);
      }
      throw error;
    }
  } finally {
    await Promise.allSettled([
      unauthorized.query("rollback"),
      authorized.query("rollback"),
    ]);
  }
}

async function assertOwnershipInvariants() {
  const client = await connect("phase2_campaign_invariants");

  const metadata = await client.query(
    `
      select
        (
          select count(*) = 1
          from marketing_ops.campaign_members
          where campaign_id = $1
            and member_role = 'owner'
            and is_primary
        ) as exactly_one,
        (
          select index_meta.indisunique
            and pg_get_expr(index_meta.indpred, index_meta.indrelid) = 'is_primary'
          from pg_index as index_meta
          where index_meta.indexrelid = 'marketing_ops.campaign_members_one_primary_idx'::regclass
        ) as unique_partial,
        (
          select count(*) = 2
          from pg_trigger
          where tgname in ('campaign_members_require_primary_owner', 'campaigns_require_primary_owner')
            and tgdeferrable
            and tginitdeferred
        ) as deferred_triggers
    `,
    [campaignId],
  );
  const invariant = metadata.rows[0];
  if (!invariant.exactly_one || !invariant.unique_partial || !invariant.deferred_triggers) {
    throw new Error(`ownership metadata invariant failed: ${JSON.stringify(invariant)}`);
  }

  await beginAsManager(client);
  let deferredCode;
  try {
    await client.query(
      `
        update marketing_ops.campaign_members
        set is_primary = false
        where campaign_id = $1
          and user_id = $2
      `,
      [campaignId, primaryOwnerId],
    );
    await client.query("set constraints all immediate");
  } catch (error) {
    deferredCode = error.code;
  } finally {
    await client.query("rollback");
  }
  if (deferredCode !== "23514") {
    throw new Error(`deferred exactly-one invariant returned ${deferredCode ?? "no error"}`);
  }

  await beginAsManager(client);
  let uniqueCode;
  try {
    await client.query(
      `
        insert into marketing_ops.campaign_members (
          tenant_id, campaign_id, user_id, member_role, is_primary, created_by
        ) values ($1, $2, $3, 'owner', true, $3)
      `,
      [tenantId, campaignId, managerId],
    );
  } catch (error) {
    uniqueCode = error.code;
  } finally {
    await client.query("rollback");
  }
  if (uniqueCode !== "23505") {
    throw new Error(`unique primary-owner invariant returned ${uniqueCode ?? "no error"}`);
  }
}

try {
  assertTestDatabaseAllowed();
  await prepareFixtures();
  await exerciseParticipantAggregateOrder();
  await exerciseItemAggregateOrder();
  await assertUnauthorizedCannotBlock(viewerId, "viewer");
  await assertUnauthorizedCannotBlock(nonparticipantId, "nonparticipant");
  await assertOwnershipInvariants();
  console.log("campaign aggregate concurrency: PASS");
} catch (error) {
  console.error(`campaign aggregate concurrency: FAIL (${error.code ?? "ERROR"}) ${error.message}`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(
    clients
      .filter((client) => client !== fixtureClient)
      .map((client) => client.query("rollback")),
  );
  try {
    await cleanupFixtures();
  } catch (error) {
    console.error(`campaign aggregate fixture cleanup: FAIL (${error.code ?? "ERROR"}) ${error.message}`);
    process.exitCode = 1;
  }
  await Promise.allSettled(clients.map((client) => client.end()));
}
