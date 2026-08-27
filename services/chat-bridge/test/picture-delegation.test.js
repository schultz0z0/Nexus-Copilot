import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { decodeJwt } from "jose";

import { buildPictureDelegationSystemMessage, issuePictureDelegation, redactPictureDelegation, refreshPictureDelegation } from "../src/picture-delegation.js";

const config = { activeKid: "v2", activeKey: "picture-delegation-key-at-least-32-bytes", issuer: "nexus-chat-bridge", audience: "nexus-picture", ttlSeconds: 90 };

test("issues complete short-lived Picture claims bound to one workspace", async () => {
  const token = await issuePictureDelegation({
    userId: randomUUID(), tenantId: "ens", role: "member", chatSessionId: randomUUID(), workspaceId: randomUUID(), runId: randomUUID(),
  }, ["picture:read", "picture:write"], config);
  const claims = decodeJwt(token);
  for (const claim of ["sub", "tenant_id", "actor_role", "chat_session_id", "workspace_id", "run_id", "scopes", "jti", "iat", "nbf", "exp", "contract_version"]) {
    assert.notEqual(claims[claim], undefined, claim);
  }
  assert.ok(claims.exp - claims.iat <= 90);
});

test("technical delegation is system-only and redacted recursively", () => {
  const token = "header.payload.signature";
  const message = buildPictureDelegationSystemMessage(token);
  assert.match(message, /PICTURE_DELEGATION/);
  assert.match(message, /header\.payload\.signature/);
  assert.equal(redactPictureDelegation(`hello\n${message}`), "hello");
  assert.deepEqual(redactPictureDelegation({ delegation_token: token, nested: { authorization: token }, safe: "ok" }), {
    delegation_token: "[REDACTED]", nested: { authorization: "[REDACTED]" }, safe: "ok",
  });
});

test("renews an expired Picture delegation only for its active parent run", async () => {
  const run = {
    id: randomUUID(), user_id: randomUUID(), tenant_id: "ens", user_role: "member",
    chat_session_id: randomUUID(), picture_workspace_id: randomUUID(), status: "running",
    created_at: new Date(Date.now() - 60_000).toISOString(),
  };
  const expired = await issuePictureDelegation({
    userId: run.user_id, tenantId: run.tenant_id, role: run.user_role,
    chatSessionId: run.chat_session_id, workspaceId: run.picture_workspace_id,
    runId: run.id, issuedAt: Math.floor(Date.now() / 1000) - 120,
  }, ["picture:read", "picture:write"], { ...config, ttlSeconds: 30 });

  const renewed = await refreshPictureDelegation(expired, run, {
    ...config, maxTtlSeconds: 120, refreshWindowSeconds: 900,
  });
  const claims = decodeJwt(renewed);
  assert.equal(claims.run_id, run.id);
  assert.equal(claims.workspace_id, run.picture_workspace_id);
  assert.ok(claims.exp > Math.floor(Date.now() / 1000));

  await assert.rejects(
    refreshPictureDelegation(expired, { ...run, picture_workspace_id: randomUUID() }, {
      ...config, maxTtlSeconds: 120, refreshWindowSeconds: 900,
    }),
    /delegation_parent_context_mismatch/,
  );
});
