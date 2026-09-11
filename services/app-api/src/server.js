import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { authRoutes } from "./auth/routes.js";

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
    logger: options.logger ?? false,
  });

  await app.register(fastifyCookie, {
    secret: config.cookieSecret,
  });

  await app.register(fastifyCors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  app.get("/health", async () => {
    return { status: "ok", service: "app-api" };
  });

  await app.register(authRoutes, { db, config });

  if (!options.db && db?.close) {
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

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`[app-api] listening on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
