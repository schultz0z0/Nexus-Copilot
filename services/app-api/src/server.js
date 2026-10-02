import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { authRoutes } from "./auth/routes.js";
import { chatRoutes } from "./chat/routes.js";
import { adminRoutes } from "./admin/routes.js";
import { attachmentRoutes } from "./attachments/routes.js";
import { marketingRoutes } from "./marketing/routes.js";
import { captureRoutes } from "./marketing/capture.js";
import { adsOAuthRoutes, requestLogSerializer } from "./marketing/adsOAuth.js";
import { workspaceOAuthRoutes } from "./marketing/workspaceOAuth.js";

/**
 * Creates and configures the Fastify App API application.
 *
 * @param {object} [options={}]
 * @param {object} [options.config]
 * @param {object} [options.db]
 * @param {boolean|object} [options.logger=false]
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function createApp(options = {}) {
  const config = options.config || loadConfig();
  const db = options.db || createDatabase(config.db);

  const app = Fastify({
    logger: options.logger ? { ...(typeof options.logger === "object" ? options.logger : {}),
      serializers: { ...(typeof options.logger === "object" ? options.logger.serializers : {}), req: requestLogSerializer } } : false,
  });

  await app.register(fastifyCookie, {
    secret: config.cookieSecret,
  });

  await app.register(fastifyCors, {
    origin: config.corsOrigin ?? true,
    credentials: true,
  });

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.artifact?.maxUploadBytes ?? 5368709120,
    },
  });

  app.get("/health", async () => {
    return { status: "ok", service: "app-api" };
  });

  app.get("/api/health", async () => {
    return { status: "ok", service: "app-api" };
  });

  await app.register(authRoutes, { db, config });
  await app.register(chatRoutes, { db, config });
  await app.register(adminRoutes, { db, config });
  await app.register(attachmentRoutes, { db, config });
  if (config.marketingOps) {
    await app.register(marketingRoutes, { db, config, fetch: options.fetch });
    await app.register(captureRoutes, { config, fetch: options.fetch, captureProxyLookup: options.captureProxyLookup });
    await app.register(adsOAuthRoutes, { db, config, fetch: options.fetch });
    await app.register(workspaceOAuthRoutes, { db, config, fetch: options.fetch });
  }

  if (db?.close) {
    app.addHook("onClose", async () => {
      await db.close();
    });
  }

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const db = createDatabase(config.db);
  const app = await createApp({ config, db, logger: true });

  const shutdown = async (signal) => {
    console.log(`[app-api] received ${signal}, closing server...`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      console.error("[app-api] error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`[app-api] listening on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
