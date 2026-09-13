import test from "node:test";
import assert from "node:assert/strict";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { createActorAssertion, validateAssertionConfig } from "../src/marketing/assertion.js";

const key = "m6-local-bff-assertion-key-with-at-least-32-bytes";
const config = {
  activeKid: "bff-v1", activeKey: key,
  issuer: "ens-app-api", audience: "ens-marketing-ops", maxTtlSeconds: 30
};

test("signs a request-bound 30-second HS256 actor assertion", async () => {
  const now = new Date("2026-09-13T12:00:00.000Z");
  const token = await createActorAssertion({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      role: "manager"
    },
    correlationId: "22222222-2222-4222-8222-222222222222",
    method: "post", path: "/v1/campaigns"
  }, config, now);
  const header = decodeProtectedHeader(token);
  const claims = decodeJwt(token);
  expectHeader(header);
  assert.equal(claims.sub, "11111111-1111-4111-8111-111111111111");
  assert.equal(claims.tenant_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(claims.actor_role, "manager");
  assert.equal(claims.method, "POST");
  assert.equal(claims.path, "/v1/campaigns");
  assert.equal(claims.exp - claims.iat, 30);
  await jwtVerify(token, new TextEncoder().encode(key), {
    algorithms: ["HS256"], issuer: config.issuer, audience: config.audience,
    currentDate: now
  });
});

test("rejects weak and placeholder assertion keys before signing", async () => {
  for (const activeKey of ["short", "change-me", "placeholder-secret"]) {
    assert.throws(() => validateAssertionConfig({ ...config, activeKey }), /key/i);
  }
  await assert.rejects(() => createActorAssertion({
    actor: { id: "bad", tenant_id: "bad", role: "owner" },
    correlationId: "bad", method: "GET", path: "/v1/campaigns"
  }, config), /actor assertion input/i);
});

function expectHeader(header) {
  assert.deepEqual(header, { alg: "HS256", typ: "JWT", kid: "bff-v1" });
}
