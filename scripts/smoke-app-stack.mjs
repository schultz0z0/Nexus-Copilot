#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/**
 * Smoke test automatizado da stack de aplicação ENS (Marco M5).
 *
 * Valida os contratos dos serviços e a cadeia de integração:
 * 1. Healthcheck da App API
 * 2. Healthcheck do Chat Bridge
 * 3. Healthcheck do Artifact Server
 * 4. Resposta do Frontend (Nginx + React estático)
 * 5. Proxy de /api/ através do Frontend
 * 6. Gate de segurança: zero vazamento de credenciais ou endpoints Supabase
 */

const APP_URL = (process.env.APP_URL || "http://localhost:8088").replace(/\/$/, "");
const APP_API_URL = (process.env.APP_API_URL || "http://localhost:3000").replace(/\/$/, "");
const BRIDGE_URL = (process.env.BRIDGE_URL || "http://localhost:8082").replace(/\/$/, "");
const ARTIFACT_URL = (process.env.ARTIFACT_URL || "http://localhost:8095").replace(/\/$/, "");
const MARKETING_OPS_URL = (process.env.MARKETING_OPS_URL || "http://localhost:8091").replace(/\/$/, "");
const HERMES_URL = process.env.HERMES_URL?.replace(/\/$/, "");

let passed = 0;
let failed = 0;

const testStep = async (name, fn) => {
  process.stdout.write(`• ${name}... `);
  try {
    await fn();
    console.log("PASS");
    passed++;
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function structuredSmokeConfiguration(env = process.env) {
  if (env.SMOKE_STRUCTURED_PLAN_EXECUTION !== 'true') return { enabled: false };

  const required = [
    'SMOKE_STRUCTURED_PLAN_SESSION_ID',
    'SMOKE_STRUCTURED_PLAN_ID',
    'SMOKE_STRUCTURED_PLAN_HASH',
  ];
  for (const key of required) {
    if (!env[key]) throw new Error(`${key} is required when structured plan smoke is enabled`);
  }

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert(uuid.test(env.SMOKE_STRUCTURED_PLAN_SESSION_ID), 'SMOKE_STRUCTURED_PLAN_SESSION_ID must be a UUID');
  assert(uuid.test(env.SMOKE_STRUCTURED_PLAN_ID), 'SMOKE_STRUCTURED_PLAN_ID must be a UUID');
  assert(/^[0-9a-f]{64}$/i.test(env.SMOKE_STRUCTURED_PLAN_HASH), 'SMOKE_STRUCTURED_PLAN_HASH must be a SHA-256 hex digest');

  return {
    enabled: true,
    sessionId: env.SMOKE_STRUCTURED_PLAN_SESSION_ID,
    planId: env.SMOKE_STRUCTURED_PLAN_ID,
    planHash: env.SMOKE_STRUCTURED_PLAN_HASH,
  };
}

export function assertInertStructuredPlan(plan) {
  assert(plan && typeof plan === 'object', 'Expected a persisted structured plan');
  assert(plan.status === 'pending', 'Structured smoke requires a pending plan');
  assert(Array.isArray(plan.actions) && plan.actions.length > 0, 'Structured smoke requires plan actions');
  assert(
    plan.actions.every((action) => action?.type === 'approval.submit_operational'),
    'Structured smoke accepts only an inert operational approval plan',
  );
  assert(
    plan.actions.every((action) => action?.action_package?.configuration?.mode === 'sandbox'),
    'Structured smoke operational packages must use sandbox mode',
  );
}

export function assertIdempotentStructuredExecution(first, replay, approval) {
  assert(first?.status === 'completed' && replay?.status === 'completed', 'Expected completed plan executions');
  assert(first.plan_id === replay.plan_id, 'Idempotent replay must return the same plan');
  assert(Array.isArray(first.failed) && first.failed.length === 0, 'First execution must have no failed actions');
  assert(Array.isArray(replay.failed) && replay.failed.length === 0, 'Replay must have no failed actions');

  const approvalIds = (execution) => execution.completed
    ?.filter((entry) => entry?.action_type === 'approval.submit_operational')
    .map((entry) => entry?.resource?.id)
    .filter(Boolean) ?? [];
  const firstApprovals = approvalIds(first);
  const replayApprovals = approvalIds(replay);
  assert(firstApprovals.length === 1, 'Expected exactly one operational approval result');
  assert(JSON.stringify(firstApprovals) === JSON.stringify(replayApprovals), 'Replay must return the same approval');
  assert(approval?.id === firstApprovals[0], 'Approval detail must match the execution result');
  assert(approval?.status === 'pending', 'Structured smoke must leave the approval pending');
  assert(approval?.decision == null, 'Structured smoke must leave the approval without a decision');
}

const run = async () => {
  console.log("=== ENS Application Stack Smoke Test (M6) ===");
  console.log(`Frontend:        ${APP_URL}`);
  console.log(`App API:         ${APP_API_URL}`);
  console.log(`Chat Bridge:     ${BRIDGE_URL}`);
  console.log(`Artifact Server: ${ARTIFACT_URL}`);
  console.log(`Marketing Ops:   ${MARKETING_OPS_URL}`);
  if (HERMES_URL) console.log(`Hermes:          ${HERMES_URL}`);
  console.log("");

  await testStep("App API health check (GET /health)", async () => {
    const res = await fetch(`${APP_API_URL}/health`, { signal: AbortSignal.timeout(5000) });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === "ok", "Expected status: ok");
  });

  await testStep("Chat Bridge health check (GET /health)", async () => {
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.ok === true || data.status === "ok", "Expected ok response");
  });

  await testStep("Artifact Server health check (GET /health)", async () => {
    const res = await fetch(`${ARTIFACT_URL}/health`, { signal: AbortSignal.timeout(5000) });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.ok === true || data.status === "ok", "Expected ok response");
  });

  await testStep("Marketing Ops readiness (GET /ready)", async () => {
    const res = await fetch(`${MARKETING_OPS_URL}/ready`, {
      signal: AbortSignal.timeout(10000)
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === "ready", "Expected Marketing Ops core readiness");
    assert(data.checks?.database === "ok", "Expected database readiness");
    assert(data.checks?.artifact === "ok", "Expected Artifact readiness");
  });

  if (HERMES_URL) {
    await testStep("Hermes health check (GET /health)", async () => {
      const res = await fetch(`${HERMES_URL}/health`, { signal: AbortSignal.timeout(5000) });
      assert(res.ok, `Expected 200, got ${res.status}`);
      const data = await res.json();
      assert(data.status === "ok", "Expected Hermes status: ok");
    });
  }

  await testStep("Frontend serves static HTML and assets (GET /)", async () => {
    const res = await fetch(`${APP_URL}/`, { signal: AbortSignal.timeout(5000) });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.includes("<!DOCTYPE html>") || text.includes("<html"), "Expected valid HTML document");
  });

  await testStep("Frontend Nginx proxies /api/health to App API", async () => {
    const res = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    assert(res.ok, `Expected 200 from Nginx /api/ proxy, got ${res.status}`);
    const data = await res.json();
    assert(data.status === "ok", "Expected status: ok via proxy");
  });

  await testStep("App API rejects unauthenticated /api/chat/sessions", async () => {
    const res = await fetch(`${APP_API_URL}/api/chat/sessions`, { signal: AbortSignal.timeout(5000) });
    assert(res.status === 401, `Expected 401 Unauthorized, got ${res.status}`);
  });

  await testStep("App API rejects unauthenticated attachment upload", async () => {
    const res = await fetch(`${APP_API_URL}/api/attachments`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    assert(res.status === 401, `Expected 401 Unauthorized, got ${res.status}`);
  });

  await testStep("BFF rejects unauthenticated Marketing Ops reads", async () => {
    const res = await fetch(`${APP_URL}/api/marketing/campaigns?limit=1`, {
      signal: AbortSignal.timeout(5000)
    });
    assert(res.status === 401, `Expected 401 Unauthorized, got ${res.status}`);
  });

  let sessionCookie = null;
  if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
    await testStep("BFF serves Marketing Ops through an App API session", async () => {
      const login = await fetch(`${APP_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: process.env.SMOKE_EMAIL,
          password: process.env.SMOKE_PASSWORD
        }),
        signal: AbortSignal.timeout(10000)
      });
      assert(login.ok, `Expected successful login, got ${login.status}`);
      sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
      assert(sessionCookie, "Expected an HttpOnly application session cookie");
      const campaigns = await fetch(`${APP_URL}/api/marketing/campaigns?limit=1`, {
        headers: { Cookie: sessionCookie },
        signal: AbortSignal.timeout(10000)
      });
      assert(campaigns.ok, `Expected authenticated Marketing Ops response, got ${campaigns.status}`);
      const payload = await campaigns.json();
      assert(Array.isArray(payload.data), "Expected a Marketing Ops data array");
    });
  }

  let structuredConfig = { enabled: false };
  await testStep("Structured plan smoke configuration is safe", async () => {
    structuredConfig = structuredSmokeConfiguration(process.env);
    if (structuredConfig.enabled) {
      assert(sessionCookie, 'SMOKE_EMAIL and SMOKE_PASSWORD are required for structured plan smoke');
    }
  });

  if (structuredConfig.enabled && sessionCookie) {
    let preparedPlan = null;
    await testStep("BFF returns the exact persisted inert plan for the authenticated actor", async () => {
      const url = new URL(`${APP_URL}/api/marketing/agent-plans`);
      url.searchParams.set('chat_session_id', structuredConfig.sessionId);
      url.searchParams.set('status', 'pending');
      const response = await fetch(url, {
        headers: { Cookie: sessionCookie },
        signal: AbortSignal.timeout(10000),
      });
      assert(response.ok, `Expected actor-scoped plan list, got ${response.status}`);
      const payload = await response.json();
      assert(Array.isArray(payload.data), 'Expected a structured plan data array');
      preparedPlan = payload.data.find((plan) => plan?.id === structuredConfig.planId) ?? null;
      assert(preparedPlan, 'Expected the configured persisted plan for this actor/session');
      assert(preparedPlan.planHash === structuredConfig.planHash, 'Persisted plan hash does not match the configured hash');
      assertInertStructuredPlan(preparedPlan);
      assert(!JSON.stringify(preparedPlan).includes('plan_token'), 'REST plan DTO must not expose plan_token');
      assert(!JSON.stringify(preparedPlan).includes('delegation_token'), 'REST plan DTO must not expose delegation_token');
    });

    if (preparedPlan) {
      await testStep("Explicit execution is idempotent and creates one undecided approval", async () => {
        const executionKey = randomUUID();
        const execute = async () => {
          const response = await fetch(
            `${APP_URL}/api/marketing/agent-plans/${encodeURIComponent(structuredConfig.planId)}/execute`,
            {
              method: 'POST',
              headers: {
                Cookie: sessionCookie,
                'Content-Type': 'application/json',
                'Idempotency-Key': executionKey,
              },
              body: JSON.stringify({ planHash: structuredConfig.planHash }),
              signal: AbortSignal.timeout(15000),
            },
          );
          assert(response.ok, `Expected structured execution success, got ${response.status}`);
          const payload = await response.json();
          return payload.data;
        };

        const first = await execute();
        const replay = await execute();
        const approvalId = first?.completed?.find(
          (entry) => entry?.action_type === 'approval.submit_operational',
        )?.resource?.id;
        assert(approvalId, 'Expected the operational approval identifier');
        const approvalResponse = await fetch(
          `${APP_URL}/api/marketing/approval-requests/${encodeURIComponent(approvalId)}`,
          { headers: { Cookie: sessionCookie }, signal: AbortSignal.timeout(10000) },
        );
        assert(approvalResponse.ok, `Expected approval detail, got ${approvalResponse.status}`);
        const approvalPayload = await approvalResponse.json();
        assertIdempotentStructuredExecution(first, replay, approvalPayload.data);
      });
    }
  }

  await testStep("Network security gate: no Supabase endpoints exposed", async () => {
    const htmlRes = await fetch(`${APP_URL}/`, { signal: AbortSignal.timeout(5000) });
    const html = await htmlRes.text();
    assert(!html.includes("supabase.co"), "HTML must not leak supabase.co URLs");
  });

  console.log("");
  console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);
  if (failed > 0) {
    process.exit(1);
  }
};

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMainModule) {
  run().catch((err) => {
    console.error("Erro fatal no smoke test:", err);
    process.exit(1);
  });
}
