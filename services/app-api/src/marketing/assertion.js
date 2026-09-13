import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const placeholder = /change[-_ ]?me|placeholder|example|replace[-_ ]?me/i;

export function validateAssertionConfig(config) {
  if (!config || !config.activeKid || !config.issuer || !config.audience) {
    throw new Error("BFF assertion configuration is incomplete");
  }
  if (typeof config.activeKey !== "string" || Buffer.byteLength(config.activeKey) < 32 || placeholder.test(config.activeKey)) {
    throw new Error("BFF assertion key must be a non-placeholder secret of at least 32 bytes");
  }
  if ((config.previousKid && !config.previousKey) || (!config.previousKid && config.previousKey)) {
    throw new Error("Previous BFF assertion kid and key must be configured together");
  }
  if (config.previousKey && (Buffer.byteLength(config.previousKey) < 32 || placeholder.test(config.previousKey))) {
    throw new Error("Previous BFF assertion key must be a non-placeholder secret of at least 32 bytes");
  }
  const ttl = Number(config.maxTtlSeconds ?? 30);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 30) throw new Error("BFF assertion TTL must be between 1 and 30 seconds");
  return { ...config, maxTtlSeconds: ttl };
}

export async function createActorAssertion(input, rawConfig, now = new Date()) {
  const config = validateAssertionConfig(rawConfig);
  const actor = input?.actor;
  const method = String(input?.method ?? "").toUpperCase();
  const path = String(input?.path ?? "");
  if (!actor || !uuid.test(actor.id) || !uuid.test(actor.tenant_id) ||
      !["member", "manager", "admin"].includes(actor.role) ||
      !uuid.test(input.correlationId) || !/^[A-Z]+$/.test(method) ||
      !path.startsWith("/") || path.includes("?")) {
    throw new Error("Invalid actor assertion input");
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({
    tenant_id: actor.tenant_id,
    actor_role: actor.role,
    correlation_id: input.correlationId,
    method,
    path
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: config.activeKid })
    .setSubject(actor.id)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt - 1)
    .setExpirationTime(issuedAt + config.maxTtlSeconds)
    .sign(new TextEncoder().encode(config.activeKey));
}
