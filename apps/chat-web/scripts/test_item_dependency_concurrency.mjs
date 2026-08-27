import pg from "pg";

const { Client } = pg;
const databaseUrl =
  process.env.MARKETING_OPS_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignId = "c2222222-2222-4222-8222-222222222222";
const managerId = "22222222-2222-4222-8222-222222222222";
const itemA = "e3333333-3333-4333-8333-333333333331";
const itemB = "e3333333-3333-4333-8333-333333333332";
const clients = [];
let fixture;

function assertLocalDatabase() {
  const hostname = new URL(databaseUrl).hostname;
  if (
    !new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(hostname) &&
    process.env.MARKETING_OPS_ALLOW_REMOTE_TEST_DATABASE !== "true"
  ) {
    throw new Error("refusing dependency fixtures on a remote database");
  }
}

async function connect(name) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("select set_config('application_name', $1, false)", [name]);
  clients.push(client);
  return client;
}

async function beginAsManager(client) {
  await client.query("begin");
  await client.query("set local deadlock_timeout = '100ms'");
  await client.query("set local lock_timeout = '5s'");
  await client.query("set local statement_timeout = '8s'");
  await client.query(
    "select set_config('request.jwt.claim.sub', $1, true), set_config('marketing_ops.tenant_id', $2, true)",
    [managerId, tenantId],
  );
  await client.query("set local role authenticated");
}

async function setup(fixture) {
  await fixture.query("begin");
  try {
    await fixture.query(
      "delete from marketing_ops.campaign_items where id = any($1::uuid[])",
      [[itemA, itemB]],
    );
    await fixture.query(
      `
        insert into marketing_ops.campaign_items (
          id, tenant_id, campaign_id, kind, title, content, created_by, updated_by
        ) values
          ($1, $3, $4, 'task', 'Dependency concurrency A', '{}'::jsonb, $5, $5),
          ($2, $3, $4, 'task', 'Dependency concurrency B', '{}'::jsonb, $5, $5)
      `,
      [itemA, itemB, tenantId, campaignId, managerId],
    );
    await fixture.query("commit");
  } catch (error) {
    await fixture.query("rollback");
    throw error;
  }
}

async function cleanup(fixture) {
  await fixture.query("begin");
  try {
    await fixture.query(
      "delete from marketing_ops.campaign_items where id = any($1::uuid[])",
      [[itemA, itemB]],
    );
    await fixture.query("commit");
  } catch (error) {
    await fixture.query("rollback");
    throw error;
  }
}

const observed = (side, promise) => promise.then(
  (value) => ({ side, ok: true, value }),
  (error) => ({ side, ok: false, error }),
);

async function withTimeout(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("dependency concurrency timed out")),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

try {
  assertLocalDatabase();
  fixture = await connect("phase3_dependency_fixture");
  const sessionA = await connect("phase3_dependency_a_to_b");
  const sessionB = await connect("phase3_dependency_b_to_a");
  await setup(fixture);
  await beginAsManager(sessionA);
  await beginAsManager(sessionB);

  const insert = `
    insert into marketing_ops.item_dependencies (
      tenant_id, campaign_id, item_id, depends_on_item_id, created_by
    ) values ($1, $2, $3, $4, $5)
  `;
  const aOutcome = observed(
    "A->B",
    sessionA.query(insert, [tenantId, campaignId, itemA, itemB, managerId]),
  );
  const bOutcome = observed(
    "B->A",
    sessionB.query(insert, [tenantId, campaignId, itemB, itemA, managerId]),
  );
  const first = await withTimeout(Promise.race([aOutcome, bOutcome]));
  const winner = first.side === "A->B" ? sessionA : sessionB;
  const other = first.side === "A->B" ? sessionB : sessionA;
  if (first.ok) await winner.query("commit");
  else await winner.query("rollback");

  const second = await withTimeout(first.side === "A->B" ? bOutcome : aOutcome);
  if (second.ok) await other.query("commit");
  else await other.query("rollback");

  const deadlock = [first, second].find(
    (outcome) => !outcome.ok && outcome.error?.code === "40P01",
  );
  if (deadlock) throw new Error(`deadlock detected on ${deadlock.side}`);

  const accepted = [first, second].filter((outcome) => outcome.ok);
  if (accepted.length !== 1) {
    throw new Error(`expected exactly one accepted edge, got ${accepted.length}`);
  }
  const rejected = [first, second].find((outcome) => !outcome.ok);
  if (rejected?.error?.constraint !== "item_dependencies_acyclic") {
    throw new Error(
      `expected item_dependencies_acyclic, got ${rejected?.error?.constraint ?? "no constraint"}`,
    );
  }

  const count = await fixture.query(
    `
      select count(*)::int as count
      from marketing_ops.item_dependencies
      where item_id = any($1::uuid[])
        and depends_on_item_id = any($1::uuid[])
    `,
    [[itemA, itemB]],
  );
  if (count.rows[0]?.count !== 1) {
    throw new Error(`expected one persisted edge, got ${count.rows[0]?.count}`);
  }
  console.log(
    `item dependency concurrency: PASS winner=${accepted[0].side} rejected=${rejected.side}`,
  );
} catch (error) {
  console.error(
    `item dependency concurrency: FAIL (${error.code ?? "ERROR"}) ${error.message}`,
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled(
    clients
      .filter((client) => client !== fixture)
      .map((client) => client.query("rollback")),
  );
  if (fixture) {
    try {
      await cleanup(fixture);
    } catch (error) {
      console.error(
        `item dependency fixture cleanup: FAIL (${error.code ?? "ERROR"}) ${error.message}`,
      );
      process.exitCode = 1;
    }
  }
  await Promise.allSettled(clients.map((client) => client.end()));
}
