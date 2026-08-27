import assert from "node:assert/strict";
import test from "node:test";
import { decodeProtectedHeader, decodeJwt, jwtVerify, SignJWT } from "jose";

import { validateBridgeRuntimeConfig } from "../src/runtime-config.js";
import {
  buildMarketingOpsDelegationSystemMessage,
  confirmationIntentForMarketingOpsDecision,
  issueMarketingOpsDelegation,
  redactMarketingOpsDelegation,
  withMarketingOpsDelegation,
} from "../src/marketing-ops-delegation.js";
import * as marketingOpsDelegation from "../src/marketing-ops-delegation.js";

const refreshKeyring = {
  activeKid: "v2",
  activeKey: "bridge-active-delegation-key-at-least-32-bytes",
  issuer: "nexus-chat-bridge",
  audience: "nexus-marketing-ops",
  ttlSeconds: 90,
  maxTtlSeconds: 120,
  refreshWindowSeconds: 900,
};

const activeRun = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "running",
  user_id: "11111111-1111-4111-8111-111111111111",
  tenant_id: "ens",
  user_role: "member",
  chat_session_id: "22222222-2222-4222-8222-222222222222",
  created_at: new Date(Date.now() - 120_000).toISOString(),
};

const expiredDelegation = async () => {
  const issuedAt = Math.floor(Date.now() / 1000) - 120;
  return new SignJWT({
    tenant_id: activeRun.tenant_id,
    actor_role: activeRun.user_role,
    scopes: ["campaign:read", "campaign:write"],
    chat_session_id: activeRun.chat_session_id,
    run_id: activeRun.id,
    correlation_id: activeRun.id,
    contract_version: 1,
  })
    .setProtectedHeader({ alg: "HS256", kid: refreshKeyring.activeKid })
    .setIssuer(refreshKeyring.issuer)
    .setAudience(refreshKeyring.audience)
    .setSubject(activeRun.user_id)
    .setJti("original-delegation-jti")
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt - 1)
    .setExpirationTime(issuedAt + 90)
    .sign(new TextEncoder().encode(refreshKeyring.activeKey));
};

test("production fails closed without Supabase and delegation config", () => {
  assert.throws(() => validateBridgeRuntimeConfig({ NODE_ENV: "production" }), /SUPABASE_URL/);
});

test("production requires the internal delegation refresh key", () => {
  const productionConfig = {
    NODE_ENV: "production",
    SUPABASE_URL: "https://app.supabase.co",
    SUPABASE_ANON_KEY: "production-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "production-service-role-key",
    MARKETING_OPS_DELEGATION_ACTIVE_KID: "v1",
    MARKETING_OPS_DELEGATION_ACTIVE_KEY: "production-delegation-key-at-least-32-bytes",
  };
  assert.throws(() => validateBridgeRuntimeConfig(productionConfig), /MARKETING_OPS_DELEGATION_REFRESH_KEY/);
  assert.throws(() => validateBridgeRuntimeConfig({
    ...productionConfig,
    MARKETING_OPS_DELEGATION_REFRESH_KEY: "CHANGE_ME_STRONG_RANDOM",
  }), /MARKETING_OPS_DELEGATION_REFRESH_KEY/);
});

test("production requires a complete and coherent Picture runtime", () => {
  const productionConfig = {
    NODE_ENV: "production",
    SUPABASE_URL: "https://app.supabase.co",
    SUPABASE_ANON_KEY: "production-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "production-service-role-key",
    MARKETING_OPS_DELEGATION_ACTIVE_KID: "v1",
    MARKETING_OPS_DELEGATION_ACTIVE_KEY: "production-delegation-key-at-least-32-bytes",
    MARKETING_OPS_DELEGATION_REFRESH_KEY: "production-refresh-key-at-least-32-bytes",
  };

  assert.throws(() => validateBridgeRuntimeConfig(productionConfig), /PICTURE_INTERNAL_URL/);
  assert.throws(() => validateBridgeRuntimeConfig({
    ...productionConfig,
    PICTURE_INTERNAL_URL: "not-a-url",
  }), /PICTURE_INTERNAL_URL/);

  const withUrl = { ...productionConfig, PICTURE_INTERNAL_URL: "http://picture-it:8090" };
  assert.throws(() => validateBridgeRuntimeConfig(withUrl), /PICTURE_INTERNAL_KEY/);
  assert.throws(() => validateBridgeRuntimeConfig({
    ...withUrl,
    PICTURE_INTERNAL_KEY: "CHANGE_ME_STRONG_RANDOM_AT_LEAST_32_BYTES",
  }), /PICTURE_INTERNAL_KEY/);

  const withInternalKey = {
    ...withUrl,
    PICTURE_INTERNAL_KEY: "production-picture-internal-key-at-least-32-bytes",
  };
  assert.throws(() => validateBridgeRuntimeConfig(withInternalKey), /PICTURE_DELEGATION_ACTIVE_KID/);

  const complete = {
    ...withInternalKey,
    PICTURE_DELEGATION_ACTIVE_KID: "v1",
    PICTURE_DELEGATION_ACTIVE_KEY: "production-picture-delegation-key-at-least-32-bytes",
    PICTURE_DELEGATION_ISSUER: "nexus-chat-bridge",
    PICTURE_DELEGATION_AUDIENCE: "nexus-picture",
  };
  assert.throws(() => validateBridgeRuntimeConfig(complete), /PICTURE_DELEGATION_REFRESH_KEY/);
  const completeWithRefresh = {
    ...complete,
    PICTURE_DELEGATION_REFRESH_KEY: "production-picture-refresh-key-at-least-32-bytes",
  };
  assert.doesNotThrow(() => validateBridgeRuntimeConfig(completeWithRefresh));
  assert.throws(() => validateBridgeRuntimeConfig({
    ...completeWithRefresh,
    PICTURE_DELEGATION_AUDIENCE: "another-service",
  }), /PICTURE_DELEGATION_AUDIENCE/);
});

test("local auth fallback requires an explicit flag", () => {
  assert.throws(() => validateBridgeRuntimeConfig({ NODE_ENV: "development" }), /BRIDGE_ALLOW_INSECURE_LOCAL_AUTH/);
  const config = validateBridgeRuntimeConfig({ NODE_ENV: "development", BRIDGE_ALLOW_INSECURE_LOCAL_AUTH: "true" });
  assert.equal(config.allowInsecureLocalAuth, true);
});

test("delegation has exact short-lived claims and active kid", async () => {
  const key = "bridge-active-delegation-key-at-least-32-bytes";
  const signed = await issueMarketingOpsDelegation({
    userId: "11111111-1111-4111-8111-111111111111",
    tenantId: "ens",
    role: "member",
    chatSessionId: "22222222-2222-4222-8222-222222222222",
    runId: "33333333-3333-4333-8333-333333333333",
    correlationId: "44444444-4444-4444-8444-444444444444",
  }, ["campaign:read", "campaign:write"], {
    activeKid: "v2", activeKey: key, issuer: "nexus-chat-bridge", audience: "nexus-marketing-ops", ttlSeconds: 90,
  });
  assert.equal(decodeProtectedHeader(signed).kid, "v2");
  const verified = await jwtVerify(signed, new TextEncoder().encode(key), { issuer: "nexus-chat-bridge", audience: "nexus-marketing-ops" });
  assert.equal(verified.payload.sub, "11111111-1111-4111-8111-111111111111");
  assert.equal(verified.payload.tenant_id, "ens");
  assert.equal(verified.payload.actor_role, "member");
  assert.equal(verified.payload.exp - verified.payload.iat, 90);
});

test("only the internal approve decision grants confirmation intent", () => {
  assert.equal(confirmationIntentForMarketingOpsDecision("approve"), true);
  for (const decision of ["reject", "revise", "clarify", "none", "unknown", "", null]) {
    assert.equal(confirmationIntentForMarketingOpsDecision(decision), false, String(decision));
  }
});

test("clarify turns explicitly forbid execute-plan retries", () => {
  const message = buildMarketingOpsDelegationSystemMessage("delegation-token", "clarify");
  assert.match(message, /confirmation was not granted/i);
  assert.match(message, /do not call marketing_ops_execute_plan_v1/i);

  const embeddedMessage = withMarketingOpsDelegation("Confirmação ambígua", "delegation-token", "clarify");
  assert.match(embeddedMessage, /confirmation was not granted/i);
  assert.match(embeddedMessage, /do not call marketing_ops_execute_plan_v1/i);

  const approved = buildMarketingOpsDelegationSystemMessage("delegation-token", "approve");
  assert.doesNotMatch(approved, /confirmation was not granted/i);
});

test("contextual decision timeout accommodates the real classifier latency", () => {
  const defaultConfig = validateBridgeRuntimeConfig({
    BRIDGE_ALLOW_INSECURE_LOCAL_AUTH: "true",
  });
  const overriddenConfig = validateBridgeRuntimeConfig({
    BRIDGE_ALLOW_INSECURE_LOCAL_AUTH: "true",
    MARKETING_OPS_DECISION_TIMEOUT_MS: "20000",
  });

  assert.equal(defaultConfig.marketingOpsDecisionTimeoutMs, 15_000);
  assert.equal(overriddenConfig.marketingOpsDecisionTimeoutMs, 20_000);
});

test("delegation signs and refreshes the confirmation intent from the user turn", async () => {
  const issued = await issueMarketingOpsDelegation({
    userId: activeRun.user_id,
    tenantId: activeRun.tenant_id,
    role: activeRun.user_role,
    chatSessionId: activeRun.chat_session_id,
    runId: activeRun.id,
    correlationId: activeRun.id,
    confirmationIntent: true,
  }, ["campaign:read", "campaign:write"], refreshKeyring);
  assert.equal(decodeJwt(issued).confirmation_intent, true);

  const issuedAt = Math.floor(Date.now() / 1000) - 120;
  const expiredConfirmed = await new SignJWT({
    tenant_id: activeRun.tenant_id,
    actor_role: activeRun.user_role,
    scopes: ["campaign:read", "campaign:write"],
    chat_session_id: activeRun.chat_session_id,
    run_id: activeRun.id,
    correlation_id: activeRun.id,
    confirmation_intent: true,
    contract_version: 1,
  })
    .setProtectedHeader({ alg: "HS256", kid: refreshKeyring.activeKid })
    .setIssuer(refreshKeyring.issuer)
    .setAudience(refreshKeyring.audience)
    .setSubject(activeRun.user_id)
    .setJti("confirmed-delegation-jti")
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt - 1)
    .setExpirationTime(issuedAt + 90)
    .sign(new TextEncoder().encode(refreshKeyring.activeKey));

  const refreshed = await marketingOpsDelegation.refreshMarketingOpsDelegation(
    expiredConfirmed,
    activeRun,
    refreshKeyring,
  );
  assert.equal(decodeJwt(refreshed).confirmation_intent, true);
});

test("technical delegation is redacted before persistence or logging", () => {
  const fakeToken = "eyJhbGciOiJIUzI1NiIsImtpZCI6InYyIn0.payload.signature";
  const message = withMarketingOpsDelegation("Create a campaign", fakeToken);
  assert.match(message, /MARKETING_OPS_DELEGATION/);
  assert.equal(redactMarketingOpsDelegation(message), "Create a campaign");
  const redactedObject = redactMarketingOpsDelegation({ input: message, delegation_token: fakeToken, safe: "kept" });
  assert.deepEqual(redactedObject, { input: "Create a campaign", delegation_token: "[REDACTED]", safe: "kept" });
});

test("expired delegation is renewed for its active parent run with the same jti", async () => {
  const original = await expiredDelegation();
  const refreshed = await marketingOpsDelegation.refreshMarketingOpsDelegation(
    original,
    activeRun,
    refreshKeyring,
  );
  const claims = decodeJwt(refreshed);
  await jwtVerify(refreshed, new TextEncoder().encode(refreshKeyring.activeKey), {
    issuer: refreshKeyring.issuer,
    audience: refreshKeyring.audience,
  });

  assert.equal(claims.jti, "original-delegation-jti");
  assert.equal(claims.exp - claims.iat, 90);
  assert.equal(claims.run_id, activeRun.id);
});

test("delegation renewal rejects terminal or mismatched parent runs", async () => {
  const original = await expiredDelegation();
  await assert.rejects(
    marketingOpsDelegation.refreshMarketingOpsDelegation(
      original,
      { ...activeRun, status: "completed" },
      refreshKeyring,
    ),
    /delegation_parent_run_not_active/,
  );
  await assert.rejects(
    marketingOpsDelegation.refreshMarketingOpsDelegation(
      original,
      { ...activeRun, tenant_id: "other-tenant" },
      refreshKeyring,
    ),
    /delegation_parent_context_mismatch/,
  );
});

test("delegation refresh internal key uses an exact constant-time comparison", () => {
  assert.equal(marketingOpsDelegation.isValidDelegationRefreshKey(
    "internal-refresh-key-at-least-32-bytes",
    "internal-refresh-key-at-least-32-bytes",
  ), true);
  assert.equal(marketingOpsDelegation.isValidDelegationRefreshKey(
    "wrong-refresh-key-at-least-32-bytes",
    "internal-refresh-key-at-least-32-bytes",
  ), false);
  assert.equal(marketingOpsDelegation.isValidDelegationRefreshKey(
    "short",
    "internal-refresh-key-at-least-32-bytes",
  ), false);
});
