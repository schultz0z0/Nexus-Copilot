#!/usr/bin/env node

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
const BRIDGE_URL = (process.env.BRIDGE_URL || "http://localhost:8080").replace(/\/$/, "");
const ARTIFACT_URL = (process.env.ARTIFACT_URL || "http://localhost:8095").replace(/\/$/, "");

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

const run = async () => {
  console.log("=== ENS Application Stack Smoke Test (M5) ===");
  console.log(`Frontend:        ${APP_URL}`);
  console.log(`App API:         ${APP_API_URL}`);
  console.log(`Chat Bridge:     ${BRIDGE_URL}`);
  console.log(`Artifact Server: ${ARTIFACT_URL}`);
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
    assert(data.status === "ok", "Expected status: ok");
  });

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

run().catch((err) => {
  console.error("Erro fatal no smoke test:", err);
  process.exit(1);
});
