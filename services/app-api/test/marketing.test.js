import test from "node:test";
import assert from "node:assert/strict";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { createApp } from "../src/server.js";

const assertionKey = "m6-local-bff-assertion-key-with-at-least-32-bytes";
const user = {
  user_id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  role: "manager", email: "manager@example.test", full_name: "Manager"
};
const config = {
  cookieSecret: "test-cookie-secret", cookieName: "ens_session", corsOrigin: true,
  artifact: { maxUploadBytes: 1024 },
  marketingOps: {
    internalUrl: "http://marketing-ops:8091", timeoutMs: 100, maxBodyBytes: 1024,
    assertion: { activeKid: "bff-v1", activeKey: assertionKey,
      issuer: "ens-app-api", audience: "ens-marketing-ops", maxTtlSeconds: 30 }
  }
};

function db() {
  return {
    async query(sql) {
      if (sql.includes("iam.resolve_session")) return { rows: [{ ...user, session_id: "s", expires_at: new Date(Date.now() + 60_000) }] };
      if (sql.includes("avatar_url")) return { rows: [{ avatar_url: null }] };
      return { rows: [] };
    }, close: async () => {}
  };
}

test("denies anonymous requests before opening the Marketing Ops connection", async () => {
  let called = false;
  const app = await createApp({ config, db: db(), fetch: async () => { called = true; return new Response(); } });
  const response = await app.inject({ method: "GET", url: "/api/marketing/campaigns" });
  assert.equal(response.statusCode, 401);
  assert.equal(called, false);
  await app.close();
});

test("strips forged identity and forwards a request-bound signed assertion", async () => {
  let captured;
  const app = await createApp({ config, db: db(), fetch: async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "content-type": "application/json", etag: '"7"', "x-correlation-id": "22222222-2222-4222-8222-222222222222" }
    });
  } });
  const response = await app.inject({
    method: "POST", url: "/api/marketing/campaigns?status=draft",
    cookies: { ens_session: "opaque-session" },
    headers: {
      authorization: "Bearer forged", "x-tenant-id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "x-ens-actor-assertion": "forged", "x-correlation-id": "22222222-2222-4222-8222-222222222222",
      "idempotency-key": "idem-1", "content-type": "application/json"
    }, payload: { name: "Campaign" }
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.headers.etag, '"7"');
  assert.equal(captured.url, "http://marketing-ops:8091/v1/campaigns?status=draft");
  const headers = new Headers(captured.init.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("x-tenant-id"), false);
  assert.equal(headers.get("idempotency-key"), "idem-1");
  const token = headers.get("x-ens-actor-assertion");
  assert.deepEqual(decodeProtectedHeader(token), { alg: "HS256", typ: "JWT", kid: "bff-v1" });
  const claims = decodeJwt(token);
  assert.equal(claims.sub, user.user_id);
  assert.equal(claims.tenant_id, user.tenant_id);
  assert.equal(claims.method, "POST");
  assert.equal(claims.path, "/v1/campaigns");
  await jwtVerify(token, new TextEncoder().encode(assertionKey), {
    algorithms: ["HS256"], issuer: "ens-app-api", audience: "ens-marketing-ops"
  });
  assert.equal(captured.init.body, JSON.stringify({ name: "Campaign" }));
  await app.close();
});

test("returns a stable sanitized timeout envelope", async () => {
  const app = await createApp({ config, db: db(), fetch: async () => { throw new DOMException("topology secret", "TimeoutError"); } });
  const response = await app.inject({ method: "GET", url: "/api/marketing/campaigns",
    cookies: { ens_session: "opaque-session" } });
  assert.equal(response.statusCode, 504);
  const body = response.json();
  assert.equal(body.error.code, "marketing_ops_timeout");
  assert.doesNotMatch(JSON.stringify(body), /topology|marketing-ops:8091/i);
  await app.close();
});

test("proxies GET /api/marketing/agent-plans with query preservation, stripped headers and signed assertion", async () => {
  let captured;
  const planData = {
    data: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        planHash: "a".repeat(64),
        status: "pending",
        expiresAt: "2026-10-01T00:00:00.000Z",
        actions: [{ type: "campaign.create_draft", ref: "c1", name: "Test" }],
        requiredScopes: ["campaign:write"],
        createdAt: "2026-09-14T00:00:00.000Z"
      }
    ]
  };

  const app = await createApp({
    config, db: db(), fetch: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify(planData), {
        status: 200,
        headers: { "content-type": "application/json", "x-correlation-id": "33333333-3333-4333-8333-333333333333" }
      });
    }
  });

  // 1. Anonymous request denied
  const unauth = await app.inject({ method: "GET", url: "/api/marketing/agent-plans" });
  assert.equal(unauth.statusCode, 401);

  // 2. Authenticated request with query parameters and forged headers
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const response = await app.inject({
    method: "GET",
    url: `/api/marketing/agent-plans?chat_session_id=${sessionId}&status=pending&limit=10`,
    cookies: { ens_session: "opaque-session" },
    headers: {
      authorization: "Bearer forged",
      "x-tenant-id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "x-correlation-id": "33333333-3333-4333-8333-333333333333"
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(captured.url, `http://marketing-ops:8091/v1/agent-plans?chat_session_id=${sessionId}&status=pending&limit=10`);

  const headers = new Headers(captured.init.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("x-tenant-id"), false);

  const token = headers.get("x-ens-actor-assertion");
  const claims = decodeJwt(token);
  assert.equal(claims.sub, user.user_id);
  assert.equal(claims.tenant_id, user.tenant_id);
  assert.equal(claims.method, "GET");
  assert.equal(claims.path, "/v1/agent-plans");

  const responseBody = response.json();
  assert.deepEqual(responseBody, planData);
  assert.doesNotMatch(JSON.stringify(responseBody), /token|secret|delegation/i);

  await app.close();
});

test("proxies POST /api/marketing/agent-plans/:planId/execute forwarding idempotency key, hash, and passing errors", async () => {
  let captured;
  const planId = "55555555-5555-4555-8555-555555555555";
  const planHash = "b".repeat(64);
  const executionKey = "idem-key-777";

  const app = await createApp({
    config, db: db(), fetch: async (url, init) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({ data: { status: "completed", plan_id: planId } }), {
        status: 200,
        headers: { "content-type": "application/json", "x-correlation-id": "55555555-5555-4555-8555-555555555555" }
      });
    }
  });

  // 1. Anonymous denied
  const unauth = await app.inject({
    method: "POST",
    url: `/api/marketing/agent-plans/${planId}/execute`,
    headers: { "idempotency-key": executionKey, "content-type": "application/json" },
    payload: { planHash }
  });
  assert.equal(unauth.statusCode, 401);

  // 2. Authenticated execute forwards idempotency key and signed assertion
  const response = await app.inject({
    method: "POST",
    url: `/api/marketing/agent-plans/${planId}/execute`,
    cookies: { ens_session: "opaque-session" },
    headers: {
      "idempotency-key": executionKey,
      "content-type": "application/json",
      authorization: "Bearer forged-attacker",
      "x-tenant-id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    },
    payload: { planHash }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(captured.url, `http://marketing-ops:8091/v1/agent-plans/${planId}/execute`);

  const headers = new Headers(captured.init.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("x-tenant-id"), false);
  assert.equal(headers.get("idempotency-key"), executionKey);

  const token = headers.get("x-ens-actor-assertion");
  const claims = decodeJwt(token);
  assert.equal(claims.sub, user.user_id);
  assert.equal(claims.tenant_id, user.tenant_id);
  assert.equal(claims.method, "POST");
  assert.equal(claims.path, `/v1/agent-plans/${planId}/execute`);

  assert.equal(captured.init.body, JSON.stringify({ planHash }));
  const responseBody = response.json();
  assert.doesNotMatch(JSON.stringify(responseBody), /token|secret|delegation/i);

  await app.close();
});

test("passes through upstream error statuses (404, 409, 410, 503) without topology leakage", async () => {
  for (const [status, errorCode] of [[404, "plan_not_found"], [409, "plan_executing"], [410, "plan_expired"], [503, "feature_disabled"]]) {
    const app = await createApp({
      config, db: db(), fetch: async () => {
        return new Response(JSON.stringify({ error: { code: errorCode, message: "Error msg" } }), {
          status,
          headers: { "content-type": "application/json" }
        });
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/marketing/agent-plans/55555555-5555-4555-8555-555555555555/execute",
      cookies: { ens_session: "opaque-session" },
      headers: { "idempotency-key": "idem-1", "content-type": "application/json" },
      payload: { planHash: "c".repeat(64) }
    });

    assert.equal(response.statusCode, status);
    const body = response.json();
    assert.equal(body.error.code, errorCode);
    assert.doesNotMatch(JSON.stringify(body), /marketing-ops:8091|topology/i);
    await app.close();
  }
});
