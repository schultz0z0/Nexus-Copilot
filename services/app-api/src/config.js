import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

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

  return {
    port: Number.parseInt(env.PORT ?? "3000", 10),
    host: env.HOST ?? "0.0.0.0",
    nodeEnv: env.NODE_ENV ?? "development",
    cookieSecret: env.COOKIE_SECRET || randomBytes(32).toString("hex"),
    cookieName: "ens_session",
    sessionTtlDays: Number.parseInt(env.SESSION_TTL_DAYS ?? "30", 10),
    secureCookies: env.NODE_ENV === "production" && env.INSECURE_COOKIES !== "true",
    corsOrigin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(",").map((s) => s.trim()) : true,
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
