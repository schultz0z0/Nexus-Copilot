#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  PostgresComposeHarness,
  dockerComposeAvailable,
} from '../infra/postgres/test/helpers/postgres-compose.mjs';
import { hashPassword, verifyPassword } from '../services/app-api/src/auth/service.js';

const repositoryRoot = resolve(import.meta.dirname, '..');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

function hashCanonicalPayload(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function queryPostgres(harness, sql, { asApplication = false, fieldSeparator } = {}) {
  const effectiveSql = asApplication ? `set role nexus_app; ${sql}` : sql;
  const args = [
    'exec', '-T', 'postgres', '/bin/sh', '-eu', '-c',
    'export PGPASSWORD="$(cat /run/secrets/postgres_bootstrap_password)"; exec psql "$@"',
    'sh', '-v', 'ON_ERROR_STOP=1', '-U', 'nexus_bootstrap', '-d', 'nexus', '-qAt',
  ];
  if (fieldSeparator) args.push('-F', fieldSeparator);
  args.push('-c', effectiveSql);
  return harness.compose(args).stdout.trim();
}

function connectionUrl(config) {
  const url = new URL('postgresql://127.0.0.1');
  url.username = config.user;
  url.password = config.password;
  url.port = String(config.port);
  url.pathname = `/${config.database}`;
  return url.toString();
}

async function reserveAvailablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a local PostgreSQL test port'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

async function seedCanonicalActors(harness) {
  const smokePassword = randomBytes(24).toString('base64url');
  const passwordHash = await hashPassword(smokePassword);
  const sql = `
    insert into iam.tenants (id, slug, display_name) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ens', 'ENS'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'other', 'Other tenant');

    insert into iam.principals (id, external_subject, email, full_name) values
      ('11111111-1111-4111-8111-111111111111', 'test-member', 'member@example.invalid', 'Test member'),
      ('22222222-2222-4222-8222-222222222222', 'test-manager', 'manager@example.invalid', 'Test manager'),
      ('33333333-3333-4333-8333-333333333333', 'test-admin', 'admin@example.invalid', 'Test admin'),
      ('44444444-4444-4444-8444-444444444444', 'test-other-tenant-member', 'other@example.invalid', 'Other member');

    insert into iam.memberships (tenant_id, principal_id, role) values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'member'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'manager'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'admin'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '44444444-4444-4444-8444-444444444444', 'member');

    insert into iam.user_credentials (user_id, password_hash)
    values ('11111111-1111-4111-8111-111111111111', '${passwordHash}');
  `;

  queryPostgres(harness, sql);

  const authenticationProbe = queryPostgres(
    harness,
    "select password_hash from iam.authenticate_by_email('member@example.invalid')",
    { asApplication: true },
  );
  if (!authenticationProbe || !(await verifyPassword(smokePassword, authenticationProbe))) {
    throw new Error('Canonical smoke actor authentication fixture is invalid');
  }

  return { email: 'member@example.invalid', password: smokePassword };
}

function verifyMigrationLedger(harness) {
  const ledger = queryPostgres(
    harness,
    "select string_agg(version, ',' order by version) from infra.schema_migrations",
  );
  const expected = Array.from({ length: 18 }, (_, index) => String(index + 1).padStart(4, '0')).join(',');
  if (ledger !== expected) throw new Error(`Unexpected migration ledger: ${ledger}`);

  const secondMigration = harness.migrate();
  if (!secondMigration.stdout.includes('"applied":[]') || !secondMigration.stdout.includes('"0018"')) {
    throw new Error('Second migration run was not a complete idempotent replay');
  }
  console.log('Migration ledger 0001-0018 and idempotent replay verified');
}

function seedInertStructuredPlan(harness) {
  const campaignId = randomUUID();
  const planId = randomUUID();
  const sessionId = randomUUID();
  const sourceRunId = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const actions = [{
    type: 'approval.submit_operational',
    campaign_id: campaignId,
    action_package: {
      actionType: 'campaign.channel_dispatch',
      channel: 'email',
      audienceSnapshot: { count: 1 },
      timeZone: 'America/Sao_Paulo',
      configuration: { mode: 'sandbox' },
      successCriteria: 'Aprovação criada sem despacho externo.',
      riskSummary: 'Homologação local inerte.',
      payload: { template: 'local-gate-only' },
    },
    reason: 'Validar execução estruturada local sem efeito externo',
    expires_at: expiresAt,
  }];
  const planHash = hashCanonicalPayload(actions);
  const actionsJson = JSON.stringify(actions).replaceAll("'", "''");
  const sql = `
    insert into marketing_ops.campaigns
      (id, tenant_id, name, created_by, updated_by)
    values
      ('${campaignId}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'Structured execution local gate',
       '11111111-1111-4111-8111-111111111111',
       '11111111-1111-4111-8111-111111111111');

    insert into chat.chat_sessions (id, user_id, title, session_kind)
    values ('${sessionId}', '11111111-1111-4111-8111-111111111111',
      'Structured execution local gate', 'marketing');

    insert into marketing_ops.campaign_members
      (tenant_id, campaign_id, user_id, member_role, is_primary, created_by)
    values
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${campaignId}',
       '11111111-1111-4111-8111-111111111111', 'owner', true,
       '11111111-1111-4111-8111-111111111111');

    insert into marketing_ops.prepared_agent_plans
      (id, tenant_id, prepared_by, chat_session_id, source_run_id,
       plan_hash, actions, required_scopes, expires_at)
    values
      ('${planId}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '11111111-1111-4111-8111-111111111111', '${sessionId}', '${sourceRunId}',
       '${planHash}', '${actionsJson}'::jsonb, array['approval:write'], '${expiresAt}');
  `;
  queryPostgres(harness, sql);
  return { planId, sessionId, planHash };
}

function verifyStructuredExecutionEvidence(harness) {
  const evidence = queryPostgres(harness, `
      select
        (select count(*) from marketing_ops.prepared_agent_plans),
        (select count(*) from marketing_ops.approval_requests where status = 'pending'),
        (select count(*) from marketing_ops.approval_decisions),
        (select count(*) from marketing_ops.action_packages where status <> 'pending_approval'),
        (select count(*) from chat.bridge_runs);
    `, { fieldSeparator: '|' });
  if (evidence !== '1|1|0|0|0') {
    throw new Error(`Unexpected structured execution evidence: ${evidence}`);
  }
  console.log('Structured evidence verified: plans=1 pending_approvals=1 decisions=0 external_actions=0 bridge_runs=0');
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    throw result.error ?? new Error(
      `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

async function rehearseApplicationStack(harness, smokeActor, structuredPlan) {
  const suffix = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const projectName = `ens-app-test-${suffix}`;
  const hermesNetworkName = `${projectName}-hermes`;
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'ens-app-rehearsal-'));
  const overridePath = join(temporaryDirectory, 'compose.override.yaml');
  const bffSecretPath = join(temporaryDirectory, 'marketing_ops_bff_assertion_key');
  const bffSecret = randomBytes(32).toString('hex');
  const ports = {};
  for (const name of ['artifact', 'bridge', 'api', 'marketing', 'web']) {
    ports[name] = await reserveAvailablePort();
  }

  writeFileSync(bffSecretPath, `${bffSecret}\n`, { mode: 0o600 });
  writeFileSync(overridePath, `
services:
  artifact-server:
    ports: ["\${ARTIFACT_PORT}:8095"]
  chat-bridge:
    ports: ["\${BRIDGE_PORT}:8080"]
  app-api:
    ports: ["\${APP_API_PORT}:3000"]
  marketing-ops:
    ports: ["\${MARKETING_OPS_PORT}:8091"]
  chat-web:
    ports: ["\${CHAT_WEB_PORT}:8080"]
networks:
  postgres-data:
    external: true
  hermes-net:
    external: true
`, { mode: 0o600 });

  const appCompose = [
    'compose', '--project-name', projectName,
    '-f', 'infra/app/compose.yaml',
    '-f', overridePath,
  ];
  const hermesProfileProject = `${projectName}-hermes-profile`;
  const hermesCompose = [
    'compose', '--project-name', hermesProfileProject,
    '-f', 'infra/hermes/compose.yaml',
  ];
  const flagEnvironment = (enabled) => ({
    ...process.env,
    NODE_ENV: 'production',
    INSECURE_COOKIES: 'true',
    ARTIFACT_INTERNAL_KEY: randomBytes(32).toString('hex'),
    ARTIFACT_ACCESS_TOKEN_SECRET: randomBytes(32).toString('hex'),
    APP_COOKIE_SECRET: randomBytes(32).toString('hex'),
    HERMES_API_KEY: randomBytes(32).toString('hex'),
    MARKETING_OPS_DELEGATION_ACTIVE_KEY: randomBytes(32).toString('hex'),
    MARKETING_OPS_DELEGATION_REFRESH_KEY: randomBytes(32).toString('hex'),
    MARKETING_OPS_BFF_ASSERTION_KEY_FILE: bffSecretPath,
    POSTGRES_APP_PASSWORD_FILE: join(harness.secretDirectory, 'app.txt'),
    APP_INTERNAL_NETWORK_NAME: `${projectName}-internal`,
    POSTGRES_DATA_NETWORK_NAME: `${harness.projectName}-network`,
    HERMES_NETWORK_NAME: hermesNetworkName,
    ARTIFACT_DATA_VOLUME_NAME: `${projectName}-artifact`,
    BRIDGE_DATA_VOLUME_NAME: `${projectName}-bridge`,
    HERMES_DATA_VOLUME_NAME: `${projectName}-hermes-data`,
    ARTIFACT_PORT: String(ports.artifact),
    BRIDGE_PORT: String(ports.bridge),
    APP_API_PORT: String(ports.api),
    MARKETING_OPS_PORT: String(ports.marketing),
    CHAT_WEB_PORT: String(ports.web),
    MARKETING_OPS_FEATURE_READ: 'true',
    MARKETING_OPS_FEATURE_WRITE: 'true',
    MARKETING_OPS_FEATURE_APPROVALS: 'true',
    MARKETING_OPS_STRUCTURED_PLAN_EXECUTION: String(enabled),
    MARKETING_OPS_FRONTEND_ENABLED: 'true',
    MARKETING_OPS_FRONTEND_READ: 'true',
    MARKETING_OPS_FRONTEND_WRITE: 'true',
    MARKETING_OPS_FRONTEND_APPROVALS: 'true',
    MARKETING_OPS_FRONTEND_STRUCTURED_PLAN_EXECUTION: String(enabled),
    MARKETING_OPS_FRONTEND_KILL_SWITCH: 'false',
    MARKETING_OPS_RAG_URL: 'http://127.0.0.1:1/mcp',
  });

  let environment = flagEnvironment(true);
  try {
    runCommand('docker', ['network', 'create', hermesNetworkName]);
    console.log('Building and starting the isolated application stack with structured execution enabled');
    runCommand('docker', [
      ...appCompose, 'up', '-d', '--build', '--wait', '--wait-timeout', '180',
    ], { env: environment });

    const hermesEnvironment = {
      ...environment,
      API_SERVER_KEY: randomBytes(32).toString('hex'),
      HERMES_PROFILE_NAME: 'ens',
      NEXUS_MARKETING_OPS_MCP_URL: 'http://marketing-ops:8091/mcp',
    };
    runCommand('docker', [
      ...hermesCompose, 'run', '--rm', '--no-deps', 'hermes-profile-init',
    ], { env: hermesEnvironment });
    const hermesMcp = runCommand('docker', [
      'run', '--rm', '--network', hermesNetworkName,
      '-e', 'HERMES_HOME=/opt/data',
      '-e', 'NEXUS_MARKETING_OPS_MCP_URL=http://marketing-ops:8091/mcp',
      '-v', `${environment.HERMES_DATA_VOLUME_NAME}:/opt/data`,
      'nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79',
      'hermes', '-p', 'ens', 'mcp', 'test', 'nexus_marketing_ops',
    ], { allowFailure: true });
    process.stdout.write(hermesMcp.stdout);
    if (hermesMcp.status !== 0
      || !hermesMcp.stdout.includes('Connected')
      || !hermesMcp.stdout.includes('Tools discovered: 10')) {
      throw new Error('Official Hermes MCP transport gate failed');
    }
    console.log('Official Hermes MCP transport and 10-tool discovery verified');

    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('npm_execpath is required for the real-stack Playwright gate');
    const browserGate = runCommand(process.execPath, [
      npmCli, '--prefix', 'apps/chat-web', 'run', 'e2e', '--',
      'e2e/structured-plan-real-stack.spec.ts',
    ], {
      env: {
        ...environment,
        MARKETING_OPS_E2E_BASE_URL: `http://127.0.0.1:${ports.web}`,
        MARKETING_OPS_REAL_STACK_E2E: 'true',
        MARKETING_OPS_REAL_STACK_EMAIL: smokeActor.email,
        MARKETING_OPS_REAL_STACK_PASSWORD: smokeActor.password,
        MARKETING_OPS_REAL_STACK_SESSION_ID: structuredPlan.sessionId,
        MARKETING_OPS_REAL_STACK_PLAN_ID: structuredPlan.planId,
      },
      allowFailure: true,
    });
    process.stdout.write(browserGate.stdout ?? '');
    process.stderr.write(browserGate.stderr ?? '');
    if (browserGate.status !== 0) {
      throw browserGate.error ?? new Error('Real-stack Playwright plan-card gate failed');
    }
    console.log('Real-stack Playwright plan-card gate verified');

    const smoke = runCommand(
      process.execPath,
      ['scripts/smoke-app-stack.mjs'],
      {
        env: {
          ...environment,
          APP_URL: `http://127.0.0.1:${ports.web}`,
          APP_API_URL: `http://127.0.0.1:${ports.api}`,
          BRIDGE_URL: `http://127.0.0.1:${ports.bridge}`,
          ARTIFACT_URL: `http://127.0.0.1:${ports.artifact}`,
          MARKETING_OPS_URL: `http://127.0.0.1:${ports.marketing}`,
          SMOKE_EMAIL: smokeActor.email,
          SMOKE_PASSWORD: smokeActor.password,
          SMOKE_STRUCTURED_PLAN_EXECUTION: 'true',
          SMOKE_STRUCTURED_PLAN_SESSION_ID: structuredPlan.sessionId,
          SMOKE_STRUCTURED_PLAN_ID: structuredPlan.planId,
          SMOKE_STRUCTURED_PLAN_HASH: structuredPlan.planHash,
        },
        allowFailure: true,
      },
    );
    process.stdout.write(smoke.stdout);
    if (smoke.status !== 0) {
      const appApiLogs = runCommand('docker', [
        ...appCompose, 'logs', '--no-color', '--tail', '100', 'app-api', 'marketing-ops',
      ], {
        env: environment,
        allowFailure: true,
      });
      process.stdout.write(appApiLogs.stdout);
      process.stderr.write(appApiLogs.stderr);
      const postgresLogs = harness.compose(
        ['logs', '--no-color', '--tail', '100', 'postgres'],
        { allowFailure: true },
      );
      process.stdout.write(postgresLogs.stdout);
      process.stderr.write(postgresLogs.stderr);
      throw new Error('Isolated application stack smoke failed');
    }
    verifyStructuredExecutionEvidence(harness);

    const preservedLogin = await fetch(`http://127.0.0.1:${ports.web}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: smokeActor.email, password: smokeActor.password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!preservedLogin.ok) throw new Error(`Could not create the rollback probe session: ${preservedLogin.status}`);
    const preservedCookie = preservedLogin.headers.get('set-cookie')?.split(';', 1)[0];
    if (!preservedCookie) throw new Error('Rollback probe session cookie was not issued');

    environment = { ...environment,
      MARKETING_OPS_STRUCTURED_PLAN_EXECUTION: 'false',
      MARKETING_OPS_FRONTEND_STRUCTURED_PLAN_EXECUTION: 'false',
    };
    console.log('Rebuilding only Marketing Ops and Chat Web with structured execution disabled');
    runCommand('docker', [
      ...appCompose, 'up', '-d', '--build', '--no-deps', '--force-recreate',
      '--wait', '--wait-timeout', '180', 'marketing-ops', 'chat-web',
    ], { env: environment });

    const rollbackHeaders = { Cookie: preservedCookie };
    const rollbackRoot = await fetch(`http://127.0.0.1:${ports.web}/`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!rollbackRoot.ok) throw new Error(`Frontend failed after rollback: ${rollbackRoot.status}`);
    const rollbackCampaigns = await fetch(
      `http://127.0.0.1:${ports.web}/api/marketing/campaigns?limit=1`,
      { headers: rollbackHeaders, signal: AbortSignal.timeout(10_000) },
    );
    if (!rollbackCampaigns.ok) {
      throw new Error(`Authenticated Marketing Ops read failed after rollback: ${rollbackCampaigns.status}`);
    }
    const rollbackCapabilities = await fetch(
      `http://127.0.0.1:${ports.web}/api/marketing/capabilities`,
      { headers: rollbackHeaders, signal: AbortSignal.timeout(10_000) },
    );
    if (!rollbackCapabilities.ok) {
      throw new Error(`Marketing Ops capabilities failed after rollback: ${rollbackCapabilities.status}`);
    }
    const rollbackCapabilityPayload = await rollbackCapabilities.json();
    const structuredEnabled = rollbackCapabilityPayload?.data?.features?.structuredPlanExecution
      ?? rollbackCapabilityPayload?.features?.structuredPlanExecution;
    if (structuredEnabled !== false) {
      throw new Error('Structured plan execution remained enabled after rollback');
    }
    console.log('Isolated application stack rollback gate passed');
  } finally {
    runCommand('docker', [...appCompose, 'down', '--volumes', '--remove-orphans', '--timeout', '5'], {
      env: environment,
      allowFailure: true,
    });
    runCommand('docker', ['network', 'rm', hermesNetworkName], { allowFailure: true });
    runCommand('docker', [...hermesCompose, 'down', '--remove-orphans', '--timeout', '5'], {
      env: { ...environment, API_SERVER_KEY: 'cleanup-only-placeholder-32-bytes' },
      allowFailure: true,
    });
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (!dockerComposeAvailable()) {
  console.error('Docker Compose is required for the isolated repository test gate');
  process.exit(1);
}

const port = await reserveAvailablePort();
const harness = new PostgresComposeHarness({ port });

try {
  console.log('Starting an isolated PostgreSQL test environment');
  harness.start();
  verifyMigrationLedger(harness);
  const smokeActor = await seedCanonicalActors(harness);

  if (process.argv.includes('--stack-rehearsal')) {
    const structuredPlan = seedInertStructuredPlan(harness);
    await rehearseApplicationStack(harness, smokeActor, structuredPlan);
    process.exitCode = 0;
  } else {

  const applicationUrl = connectionUrl(harness.connectionConfig('app'));
  const administrativeUrl = connectionUrl(harness.connectionConfig('bootstrap'));
  const testScript = process.argv.includes('--marketing-ops-only')
    ? 'test:marketing-ops'
    : 'test';
  const command = process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm run ${testScript}`]]
    : ['npm', ['run', testScript]];
  const result = spawnSync(command[0], command[1], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MARKETING_OPS_TEST_DATABASE_URL: applicationUrl,
      MARKETING_OPS_TEST_ADMIN_DATABASE_URL: administrativeUrl,
    },
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  }
} finally {
  console.log('Removing the isolated PostgreSQL test environment');
  harness.cleanup();
}
