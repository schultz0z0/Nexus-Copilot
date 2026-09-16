import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { decodeJwt, decodeProtectedHeader, jwtVerify, SignJWT } from "jose";

const BLOCK_PATTERN = /\n*\[MARKETING_OPS_DELEGATION\][\s\S]*?\[\/MARKETING_OPS_DELEGATION\]\n*/g;
const secretKeyPattern = /delegation|authorization|token|secret/i;

const defaultConfig = () => ({
  activeKid: process.env.MARKETING_OPS_DELEGATION_ACTIVE_KID || "",
  activeKey: process.env.MARKETING_OPS_DELEGATION_ACTIVE_KEY || "",
  issuer: process.env.MARKETING_OPS_DELEGATION_ISSUER || "nexus-chat-bridge",
  audience: process.env.MARKETING_OPS_DELEGATION_AUDIENCE || "nexus-marketing-ops",
  ttlSeconds: Number(process.env.MARKETING_OPS_DELEGATION_TTL_SECONDS || 90),
  previousKid: process.env.MARKETING_OPS_DELEGATION_PREVIOUS_KID || "",
  previousKey: process.env.MARKETING_OPS_DELEGATION_PREVIOUS_KEY || "",
  maxTtlSeconds: Number(process.env.MARKETING_OPS_DELEGATION_MAX_TTL_SECONDS || 120),
  refreshWindowSeconds: Number(process.env.MARKETING_OPS_DELEGATION_REFRESH_WINDOW_SECONDS || 900),
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const delegationReferencePattern = /^mopref_[A-Za-z0-9_-]{24}$/;

export const createMarketingOpsDelegationReferenceRegistry = ({
  ttlSeconds = 900,
  now = Date.now,
  randomBytes: randomBytesFn = randomBytes,
} = {}) => {
  const lifetimeMs = Math.max(15, Math.min(3600, Number(ttlSeconds || 900))) * 1000;
  const referenceKey = randomBytesFn(32);
  const byDigest = new Map();
  const byRunId = new Map();

  const digest = (reference) => createHash("sha256").update(reference).digest("hex");
  const referenceForRun = (runId) => `mopref_${createHmac("sha256", referenceKey)
    .update(runId)
    .digest("base64url")
    .slice(0, 24)}`;
  const cleanupExpired = () => {
    const currentTime = now();
    for (const [referenceDigest, entry] of byDigest.entries()) {
      if (entry.expiresAt > currentTime) continue;
      byDigest.delete(referenceDigest);
      if (byRunId.get(entry.runId) === referenceDigest) byRunId.delete(entry.runId);
    }
  };

  return {
    issue(runId) {
      if (typeof runId !== "string" || !uuidPattern.test(runId)) {
        throw new Error("delegation_reference_run_invalid");
      }
      cleanupExpired();
      const existingDigest = byRunId.get(runId);
      const existing = existingDigest ? byDigest.get(existingDigest) : null;
      if (existing) return referenceForRun(runId);

      const reference = referenceForRun(runId);
      const referenceDigest = digest(reference);
      byDigest.set(referenceDigest, { runId, expiresAt: now() + lifetimeMs });
      byRunId.set(runId, referenceDigest);
      return reference;
    },

    resolve(reference) {
      if (typeof reference !== "string" || !delegationReferencePattern.test(reference)) {
        throw new Error("delegation_reference_invalid");
      }
      const referenceDigest = digest(reference);
      const entry = byDigest.get(referenceDigest);
      if (!entry) throw new Error("delegation_reference_invalid");
      if (entry.expiresAt <= now()) {
        byDigest.delete(referenceDigest);
        if (byRunId.get(entry.runId) === referenceDigest) byRunId.delete(entry.runId);
        throw new Error("delegation_reference_expired");
      }
      return entry.runId;
    },

    revokeRun(runId) {
      const referenceDigest = byRunId.get(runId);
      if (!referenceDigest) return false;
      byRunId.delete(runId);
      return byDigest.delete(referenceDigest);
    },
  };
};

const validateDelegationClaims = (claims) => {
  const valid =
    typeof claims.sub === "string" && uuidPattern.test(claims.sub) &&
    typeof claims.tenant_id === "string" && /^[a-z0-9-]{2,64}$/i.test(claims.tenant_id) &&
    ["member", "manager", "admin"].includes(claims.actor_role) &&
    Array.isArray(claims.scopes) && claims.scopes.length > 0 && claims.scopes.every((scope) => typeof scope === "string" && scope.length > 0) &&
    typeof claims.chat_session_id === "string" && uuidPattern.test(claims.chat_session_id) &&
    typeof claims.run_id === "string" && uuidPattern.test(claims.run_id) &&
    typeof claims.correlation_id === "string" && uuidPattern.test(claims.correlation_id) &&
    typeof claims.jti === "string" && claims.jti.length >= 8 &&
    Number.isInteger(claims.iat) && Number.isInteger(claims.nbf) && Number.isInteger(claims.exp) &&
    claims.contract_version === 1;
  if (!valid) throw new Error("delegation_claims_invalid");
  return claims;
};

export const issueMarketingOpsDelegation = async (context, scopes, config = defaultConfig()) => {
  if (!config.activeKid || !config.activeKey || config.activeKey.length < 32) {
    throw new Error("marketing_ops_delegation_key_not_configured");
  }
  const ttlSeconds = Math.max(15, Math.min(120, Number(config.ttlSeconds || 90)));
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenant_id: context.tenantId,
    actor_role: context.role,
    scopes: [...new Set(scopes)],
    chat_session_id: context.chatSessionId,
    run_id: context.runId,
    correlation_id: context.correlationId,
    confirmation_intent: context.confirmationIntent === true,
    contract_version: 1,
  })
    .setProtectedHeader({ alg: "HS256", kid: config.activeKid })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(context.userId)
    .setJti(context.jti || randomUUID())
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .setExpirationTime(now + ttlSeconds)
    .sign(new TextEncoder().encode(config.activeKey));
};

export const refreshMarketingOpsDelegation = async (token, run, config = defaultConfig()) => {
  const header = decodeProtectedHeader(token);
  if (header.alg !== "HS256" || typeof header.kid !== "string") {
    throw new Error("delegation_header_invalid");
  }
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
    issuer: config.issuer,
    audience: config.audience,
    requiredClaims: ["sub", "jti", "iat", "nbf", "exp"],
    clockTolerance: 2,
    currentDate: new Date(decoded.iat * 1000),
  });
  const claims = validateDelegationClaims(verified.payload);
  const now = Math.floor(Date.now() / 1000);
  const maxTtlSeconds = Math.max(15, Math.min(120, Number(config.maxTtlSeconds || 120)));
  if (claims.exp <= claims.iat || claims.exp - claims.iat > maxTtlSeconds) {
    throw new Error("delegation_lifetime_invalid");
  }
  if (claims.exp > now + 2) throw new Error("delegation_not_expired");
  if (!run || run.status !== "running") throw new Error("delegation_parent_run_not_active");

  const createdAt = Date.parse(run.created_at);
  const refreshWindowSeconds = Math.max(120, Math.min(3600, Number(config.refreshWindowSeconds || 900)));
  if (!Number.isFinite(createdAt) || now - Math.floor(createdAt / 1000) > refreshWindowSeconds) {
    throw new Error("delegation_parent_run_expired");
  }
  if (
    run.id !== claims.run_id ||
    run.id !== claims.correlation_id ||
    run.user_id !== claims.sub ||
    run.tenant_id !== claims.tenant_id ||
    (run.user_role || "member") !== claims.actor_role ||
    run.chat_session_id !== claims.chat_session_id
  ) {
    throw new Error("delegation_parent_context_mismatch");
  }

  return issueMarketingOpsDelegation({
    userId: claims.sub,
    tenantId: claims.tenant_id,
    role: claims.actor_role,
    chatSessionId: claims.chat_session_id,
    runId: claims.run_id,
    correlationId: claims.correlation_id,
    jti: claims.jti,
    confirmationIntent: claims.confirmation_intent === true,
  }, claims.scopes, config);
};

export const isValidDelegationRefreshKey = (provided, expected) => {
  const providedValue = typeof provided === "string" ? provided : "";
  const expectedValue = typeof expected === "string" ? expected : "";
  const providedDigest = createHash("sha256").update(providedValue).digest();
  const expectedDigest = createHash("sha256").update(expectedValue).digest();
  return expectedValue.length > 0 &&
    providedValue.length === expectedValue.length &&
    timingSafeEqual(providedDigest, expectedDigest);
};

export const resolveMarketingOpsDelegationRequest = async ({
  providedInternalKey,
  expectedInternalKey,
  reference,
  registry,
  loadRun,
  issueDelegation,
}) => {
  if (!isValidDelegationRefreshKey(providedInternalKey, expectedInternalKey)) {
    throw new Error("delegation_resolution_unauthorized");
  }
  const runId = registry.resolve(reference);
  const run = await loadRun(runId);
  if (!run || run.status !== "running") throw new Error("delegation_parent_run_not_active");
  return issueDelegation(run);
};

export const withMarketingOpsDelegation = (message, token) => {
  const normalized = String(message ?? "").trim();
  if (!token) return normalized;
  return `${normalized}\n\n[MARKETING_OPS_DELEGATION]\ndelegation_token: ${token}\nThis is an opaque reference. Copy it exactly as the delegation_token argument for nexus_marketing_ops tools; never inspect or rewrite it.\nAfter preparing a plan, instruct the user to review and execute via the product UI card in the interface.\nDo not ask for text confirmation in chat and do not call marketing_ops_execute_plan_v1.\n[/MARKETING_OPS_DELEGATION]`;
};

export const buildMarketingOpsDelegationSystemMessage = (token) => {
  if (!token) return "";
  return [
    "[MARKETING_OPS_DELEGATION]",
    `delegation_token: ${token}`,
    "Este valor e uma referencia opaca. Copie-o exatamente como delegation_token nas tools nexus_marketing_ops; nunca inspecione nem reescreva seu conteudo.",
    "Nunca reutilize delegation_token de tool calls ou do historico; valores redigidos sao invalidos.",
    "Apos preparar o plano com marketing_ops_prepare_plan_v1, oriente o usuario a revisar e executar atraves do card confiavel da interface.",
    "Nao peca confirmacao textual no chat e nao chame marketing_ops_execute_plan_v1.",
    "[/MARKETING_OPS_DELEGATION]",
  ].join("\n");
};

export const redactMarketingOpsDelegation = (input, seen = new WeakSet()) => {
  if (typeof input === "string") return input.replace(BLOCK_PATTERN, "\n").trim();
  if (Array.isArray(input)) return input.map((item) => redactMarketingOpsDelegation(item, seen));
  if (!input || typeof input !== "object") return input;
  if (seen.has(input)) return "[CIRCULAR]";
  seen.add(input);
  return Object.fromEntries(Object.entries(input).map(([key, nested]) => [
    key,
    secretKeyPattern.test(key) ? "[REDACTED]" : redactMarketingOpsDelegation(nested, seen),
  ]));
};
