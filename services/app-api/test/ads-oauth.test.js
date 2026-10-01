import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { decodeJwt } from "jose";
import { createApp } from "../src/server.js";

const actor = { user_id: "11111111-1111-4111-8111-111111111111", tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "manager" };
const config = { cookieSecret: "cookie-test", cookieName: "ens_session", marketingOps: {
  internalUrl: "http://marketing-ops:8091", maxBodyBytes: 1024, timeoutMs: 100,
  assertion: { activeKey: "oauth-test-bff-secret-with-more-than-32-bytes", activeKid: "bff-v1", issuer: "ens-app-api", audience: "ens-marketing-ops" }
} };
const db = { query: async sql => ({ rows: sql.includes("resolve_session") ? [actor] : [] }) };
test("Analytics provider operations have a bounded budget longer than the ordinary BFF proxy", async () => {
  const budgets = []; mock.method(AbortSignal, 'timeout', value => { budgets.push(value); return new AbortController().signal; });
  const app = await createApp({ config, db, fetch: async () => Response.json({ data: {} }) });
  try {
    await app.inject({ url: '/api/marketing/web-analytics/ga4/resources', cookies: { ens_session: 'session' } });
    await app.inject({ url: '/api/marketing/campaigns', cookies: { ens_session: 'session' } });
    assert.deepEqual(budgets, [120000, 100]);
  } finally { await app.close(); mock.restoreAll(); }
});

test("GA4 authorization binds the session and reuses the registered Google callback with a trusted intent", async () => {
  const calls = [];
  const app = await createApp({ config, db, fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ data: { provider: "ga4" } });
  } });
  try {
    await app.inject({ method: "POST", url: "/api/marketing/web-analytics/ga4/authorize", cookies: { ens_session: "ga4-session" }, headers: { "x-ens-oauth-session": "forged" }, payload: {} });
    const response = await app.inject({ url: "/api/ads/oauth/google/callback?state=opaque&code=private&provider=attacker", cookies: { ens_session: "ga4-session" } });
    const binding = new Headers(calls[0].init.headers).get("x-ens-oauth-session");
    assert.match(binding, /^[a-f0-9]{64}$/);
    assert.equal(new Headers(calls[1].init.headers).get("x-ens-oauth-session"), binding);
    assert.equal(response.headers.location, "/settings/integrations?provider=ga4&result=connected");
  } finally { await app.close(); }
});

test("Google callback accepts only a bounded GA4 success tag from the trusted service", async () => {
  for (const body of ["not json", JSON.stringify({ data: { provider: "https://attacker.test" } }), JSON.stringify({ data: { provider: "ga4", private: "x".repeat(9000) } })]) {
    const app = await createApp({ config, db, fetch: async () => new Response(body) });
    try {
      const response = await app.inject({ url: "/api/ads/oauth/google/callback?state=s&code=c", cookies: { ens_session: "session" } });
      assert.equal(response.headers.location, "/settings/integrations?provider=google&result=connected");
    } finally { await app.close(); }
  }
});
test("Shared Google callback retains trusted GA4 intent on denial and provider failures", async () => {
  for (const status of [400, 409, 502]) {
    const app = await createApp({ config, db, fetch: async () => Response.json({ error: { code: 'analytics_api_disabled' } }, { status, headers: { 'x-ens-oauth-intent': 'ga4' } }) });
    try {
      const response = await app.inject({ url: '/api/ads/oauth/google/callback?state=s&code=c', cookies: { ens_session: 'session' } });
      assert.match(response.headers.location, /^\/settings\/integrations\?provider=ga4&result=/);
    } finally { await app.close(); }
  }
});

test("OAuth permission failure retains its fixed category when the service wraps it in HTTP 502", async () => {
  const logs = [];
  const app = await createApp({ config, db, logger: { stream: { write: line => logs.push(line) } }, fetch: async () => Response.json({ error: { code: "ads_permission_required", message: "private-token" } }, { status: 502 }) });
  try {
    const response = await app.inject({ url: "/api/ads/oauth/google/callback?state=private-state&code=private-code", cookies: { ens_session: "session" } });
    assert.equal(response.headers.location, "/settings/integrations?provider=google&result=permission_required");
    assert.doesNotMatch(logs.join(""), /private-token|private-state|private-code/);
  } finally { await app.close(); }
});

test("OAuth callback does not trust unknown, oversized or malformed upstream error bodies", async () => {
  for (const body of ['not JSON', JSON.stringify({ error: { code: 'private-reason', message: 'private-token' } }), JSON.stringify({ error: { code: 'ads_permission_required', message: 'x'.repeat(9000) } })]) {
    const app = await createApp({ config, db, fetch: async () => new Response(body, { status: 502 }) });
    try {
      const response = await app.inject({ url: "/api/ads/oauth/google/callback?state=s&code=c", cookies: { ens_session: "session" } });
      assert.equal(response.headers.location, "/settings/integrations?provider=google&result=unavailable");
    } finally { await app.close(); }
  }
});

test("OAuth authorization ignores a forged binding; callback binds the exact authenticated session and request", async () => {
  const calls = [];
  const app = await createApp({ config, db, fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: {} }), { headers: { "content-type": "application/json" } });
  } });
  try {
    await app.inject({ method: "POST", url: "/api/marketing/ads-integrations/google/authorize", cookies: { ens_session: "session-one" }, headers: { "x-ens-oauth-session": "forged" }, payload: {} });
    const response = await app.inject({ url: "/api/ads/oauth/google/callback?state=opaque-state&code=private-code&redirect_uri=https://attacker.test", cookies: { ens_session: "session-one" } });
    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, "/settings/integrations?provider=google&result=connected");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    const first = new Headers(calls[0].init.headers).get("x-ens-oauth-session");
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(new Headers(calls[1].init.headers).get("x-ens-oauth-session"), first);
    assert.equal(calls[1].url, "http://marketing-ops:8091/v1/ads-integrations/google/callback");
    assert.deepEqual(JSON.parse(calls[1].init.body), { state: "opaque-state", code: "private-code" });
    const claims = decodeJwt(new Headers(calls[1].init.headers).get("x-ens-actor-assertion"));
    assert.equal(claims.path, "/v1/ads-integrations/google/callback");
    assert.equal(claims.method, "POST");
    await app.inject({ method: "POST", url: "/api/marketing/ads-integrations/google/authorize", cookies: { ens_session: "session-two" }, payload: {} });
    assert.notEqual(new Headers(calls[2].init.headers).get("x-ens-oauth-session"), first);
  } finally { await app.close(); }
});

test("OAuth callback refuses anonymous, unknown providers and oversized values without upstream calls", async () => {
  let count = 0;
  const app = await createApp({ config, db, fetch: async () => { count++; return new Response(); } });
  try {
    for (const url of ["/api/ads/oauth/google/callback?state=s&code=c", "/api/ads/oauth/other/callback?state=s&code=c"]) {
      const r = await app.inject({ url }); assert.equal(r.statusCode, 303); assert.doesNotMatch(r.headers.location, /code=|state=|other/);
    }
    const r = await app.inject({ url: `/api/ads/oauth/meta/callback?state=${"s".repeat(2000)}&code=c`, cookies: { ens_session: "session" } });
    assert.equal(r.headers.location, "/settings/integrations?provider=meta&result=invalid");
    assert.equal(count, 0);
  } finally { await app.close(); }
});

test("OAuth errors use fixed redirect codes and logs never contain authorization query values", async () => {
  const logs = []; const sink = { write: line => logs.push(line) };
  const app = await createApp({ config, db, logger: { stream: sink }, fetch: async () => new Response(JSON.stringify({ error: { code: "ads_state_invalid", message: "private-upstream" } }), { status: 409 }) });
  try {
    const r = await app.inject({ url: "/api/ads/oauth/linkedin/callback?state=private-state&code=private-code", cookies: { ens_session: "session" } });
    assert.equal(r.headers.location, "/settings/integrations?provider=linkedin&result=invalid");
    assert.doesNotMatch(logs.join(""), /private-state|private-code|private-upstream|ens_session/);
  } finally { await app.close(); }
});
