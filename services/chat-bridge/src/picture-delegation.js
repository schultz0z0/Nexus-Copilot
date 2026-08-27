import { randomUUID } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, jwtVerify, SignJWT } from "jose";

const BLOCK_PATTERN = /\n*\[PICTURE_DELEGATION\][\s\S]*?\[\/PICTURE_DELEGATION\]\n*/g;
const secretKeyPattern = /delegation|authorization|token|secret/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validateClaims = (claims) => {
  const valid =
    typeof claims.sub === "string" && uuidPattern.test(claims.sub) &&
    typeof claims.tenant_id === "string" && /^[a-z0-9-]{2,64}$/i.test(claims.tenant_id) &&
    ["member", "manager", "admin"].includes(claims.actor_role) &&
    typeof claims.chat_session_id === "string" && uuidPattern.test(claims.chat_session_id) &&
    typeof claims.workspace_id === "string" && uuidPattern.test(claims.workspace_id) &&
    typeof claims.run_id === "string" && uuidPattern.test(claims.run_id) &&
    Array.isArray(claims.scopes) && claims.scopes.length > 0 &&
    claims.scopes.every((scope) => typeof scope === "string" && scope.length > 0) &&
    typeof claims.jti === "string" && claims.jti.length >= 8 &&
    Number.isInteger(claims.iat) && Number.isInteger(claims.nbf) && Number.isInteger(claims.exp) &&
    claims.contract_version === 1;
  if (!valid) throw new Error("delegation_claims_invalid");
  return claims;
};

export const issuePictureDelegation = async (context, scopes, config) => {
  if (!config?.activeKid || !config?.activeKey || config.activeKey.length < 32) {
    throw new Error("picture_delegation_key_not_configured");
  }
  const ttlSeconds = Math.max(15, Math.min(120, Number(config.ttlSeconds || 90)));
  const now = Number.isInteger(context.issuedAt) ? context.issuedAt : Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenant_id: context.tenantId,
    actor_role: context.role,
    chat_session_id: context.chatSessionId,
    workspace_id: context.workspaceId,
    run_id: context.runId,
    scopes: [...new Set(scopes)],
    contract_version: 1,
  })
    .setProtectedHeader({ alg: "HS256", kid: config.activeKid })
    .setIssuer(config.issuer || "nexus-chat-bridge")
    .setAudience(config.audience || "nexus-picture")
    .setSubject(context.userId)
    .setJti(context.jti || randomUUID())
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .setExpirationTime(now + ttlSeconds)
    .sign(new TextEncoder().encode(config.activeKey));
};

export const refreshPictureDelegation = async (token, run, config) => {
  const header = decodeProtectedHeader(token);
  if (header.alg !== "HS256" || typeof header.kid !== "string") throw new Error("delegation_header_invalid");
  const rawKey = header.kid === config.activeKid
    ? config.activeKey
    : header.kid === config.previousKid
      ? config.previousKey
      : "";
  if (!rawKey) throw new Error("delegation_key_unknown");

  const decoded = decodeJwt(token);
  if (!Number.isInteger(decoded.iat)) throw new Error("delegation_claims_invalid");
  const verified = await jwtVerify(token, new TextEncoder().encode(rawKey), {
    algorithms: ["HS256"],
    issuer: config.issuer || "nexus-chat-bridge",
    audience: config.audience || "nexus-picture",
    requiredClaims: ["sub", "jti", "iat", "nbf", "exp"],
    clockTolerance: 2,
    currentDate: new Date(decoded.iat * 1000),
  });
  const claims = validateClaims(verified.payload);
  const now = Math.floor(Date.now() / 1000);
  const maxTtlSeconds = Math.max(15, Math.min(120, Number(config.maxTtlSeconds || 120)));
  if (claims.exp <= claims.iat || claims.exp - claims.iat > maxTtlSeconds) throw new Error("delegation_lifetime_invalid");
  if (claims.exp > now + 2) throw new Error("delegation_not_expired");
  if (!run || run.status !== "running") throw new Error("delegation_parent_run_not_active");

  const createdAt = Date.parse(run.created_at);
  const refreshWindowSeconds = Math.max(120, Math.min(3600, Number(config.refreshWindowSeconds || 900)));
  if (!Number.isFinite(createdAt) || now - Math.floor(createdAt / 1000) > refreshWindowSeconds) {
    throw new Error("delegation_parent_run_expired");
  }
  if (
    run.id !== claims.run_id ||
    run.user_id !== claims.sub ||
    run.tenant_id !== claims.tenant_id ||
    (run.user_role || "member") !== claims.actor_role ||
    run.chat_session_id !== claims.chat_session_id ||
    run.picture_workspace_id !== claims.workspace_id
  ) {
    throw new Error("delegation_parent_context_mismatch");
  }

  return issuePictureDelegation({
    userId: claims.sub,
    tenantId: claims.tenant_id,
    role: claims.actor_role,
    chatSessionId: claims.chat_session_id,
    workspaceId: claims.workspace_id,
    runId: claims.run_id,
    jti: claims.jti,
  }, claims.scopes, config);
};

export const buildPictureDelegationSystemMessage = (token) => token
  ? `[PICTURE_DELEGATION]\ndelegation_token: ${token}\nUse apenas esta delegação nas tools nexus_picture deste turno. Nunca exponha ou reutilize o token.\n[/PICTURE_DELEGATION]`
  : "";

export const redactPictureDelegation = (input, seen = new WeakSet()) => {
  if (typeof input === "string") return input.replace(BLOCK_PATTERN, "\n").trim();
  if (Array.isArray(input)) return input.map((value) => redactPictureDelegation(value, seen));
  if (!input || typeof input !== "object") return input;
  if (seen.has(input)) return "[CIRCULAR]";
  seen.add(input);
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [
    key,
    secretKeyPattern.test(key) ? "[REDACTED]" : redactPictureDelegation(value, seen),
  ]));
};
