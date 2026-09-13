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
