import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { validateAssertionConfig } from "./marketing/assertion.js";

export function loadConfig(env = process.env) {
  const readSecret = (path) => {
    if (!path) return undefined;
    try {
      return readFileSync(path, "utf8").trim();
    } catch {
      return undefined;
    }
  };

  const password = env.PGPASSWORD_FILE
    ? readSecret(env.PGPASSWORD_FILE)
    : env.PGPASSWORD;

  const assertionActiveKey = env.MARKETING_OPS_BFF_ASSERTION_ACTIVE_KEY_FILE
    ? readSecret(env.MARKETING_OPS_BFF_ASSERTION_ACTIVE_KEY_FILE)
    : env.MARKETING_OPS_BFF_ASSERTION_ACTIVE_KEY;
  const assertionPreviousKey = env.MARKETING_OPS_BFF_ASSERTION_PREVIOUS_KEY_FILE
    ? readSecret(env.MARKETING_OPS_BFF_ASSERTION_PREVIOUS_KEY_FILE)
    : env.MARKETING_OPS_BFF_ASSERTION_PREVIOUS_KEY;
  const assertion = validateAssertionConfig({
    activeKid: env.MARKETING_OPS_BFF_ASSERTION_ACTIVE_KID ?? "bff-local-v1",
    activeKey: assertionActiveKey ?? "local-test-bff-assertion-key-at-least-32-bytes",
    previousKid: env.MARKETING_OPS_BFF_ASSERTION_PREVIOUS_KID,
    previousKey: assertionPreviousKey,
    issuer: env.MARKETING_OPS_BFF_ASSERTION_ISSUER ?? "ens-app-api",
    audience: env.MARKETING_OPS_BFF_ASSERTION_AUDIENCE ?? "ens-marketing-ops",
    maxTtlSeconds: Number.parseInt(env.MARKETING_OPS_BFF_ASSERTION_MAX_TTL_SECONDS ?? "30", 10),
  });

  if (env.NODE_ENV === "production" && !assertionActiveKey) {
    throw new Error("MARKETING_OPS_BFF_ASSERTION_ACTIVE_KEY_FILE is required in production");
  }

  return {
    port: Number.parseInt(env.PORT ?? "3000", 10),
    host: env.HOST ?? "0.0.0.0",
    nodeEnv: env.NODE_ENV ?? "development",
    cookieSecret: env.COOKIE_SECRET || randomBytes(32).toString("hex"),
    cookieName: "ens_session",
    sessionTtlDays: Number.parseInt(env.SESSION_TTL_DAYS ?? "30", 10),
    secureCookies: env.NODE_ENV === "production" && env.INSECURE_COOKIES !== "true",
    corsOrigin: env.CORS_ORIGIN
      ? env.CORS_ORIGIN.split(",").map((s) => s.trim())
      : env.NODE_ENV === "production"
        ? false
        : true,
    chatBridgeUrl: env.CHAT_BRIDGE_URL ?? "http://localhost:8080",
    marketingOps: {
      internalUrl: (env.MARKETING_OPS_INTERNAL_URL ?? "http://localhost:8091").replace(/\/$/, ""),
      timeoutMs: Number.parseInt(env.MARKETING_OPS_PROXY_TIMEOUT_MS ?? "15000", 10),
      maxBodyBytes: Number.parseInt(env.MARKETING_OPS_PROXY_MAX_BODY_BYTES ?? "26214400", 10),
      assertion,
    },
    artifact: {
      internalUrl: (env.ARTIFACT_INTERNAL_URL ?? "http://localhost:8095").replace(/\/$/, ""),
      internalKey: env.ARTIFACT_INTERNAL_KEY ?? "",
      accessTokenTtlSeconds: Number.parseInt(env.ARTIFACT_ACCESS_TOKEN_TTL_SECONDS ?? "900", 10),
      publicBaseUrl: env.ARTIFACT_PUBLIC_BASE_URL ?? "",
      maxUploadBytes: Number.parseInt(env.ARTIFACT_MAX_UPLOAD_BYTES ?? "5368709120", 10),
    },
    db: {
      connectionString: env.DATABASE_URL,
      host: env.PGHOST ?? "localhost",
      port: Number.parseInt(env.PGPORT ?? "5432", 10),
      database: env.PGDATABASE ?? "nexus",
      user: env.PGUSER ?? "nexus_app",
      password: password,
      max: Number.parseInt(env.PGPOOL_MAX ?? "20", 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
  };
}
