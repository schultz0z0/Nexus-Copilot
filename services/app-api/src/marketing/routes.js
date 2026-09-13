import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { validateSession } from "../auth/service.js";
import { createActorAssertion } from "./assertion.js";

const correlationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestHeaderAllowlist = [
  "accept", "content-type", "idempotency-key", "if-match",
  "x-nexus-filename", "x-nexus-asset-id"
];
const responseHeaderAllowlist = ["content-type", "etag", "x-correlation-id", "content-disposition"];

export async function marketingRoutes(fastify, options) {
  const { db, config } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const cookieName = config.cookieName || "ens_session";
  const marketing = config.marketingOps;

  fastify.route({
    method: ["GET", "POST", "PATCH", "DELETE", "PUT"],
    url: "/api/marketing/*",
    bodyLimit: marketing.maxBodyBytes,
    handler: async (request, reply) => {
      const sessionToken = request.cookies?.[cookieName];
      if (!sessionToken) return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } });
      const actor = await validateSession(db, sessionToken);
      if (!actor?.tenant_id || !["member", "manager", "admin"].includes(actor.role)) {
        return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } });
      }

      const suppliedCorrelation = request.headers["x-correlation-id"];
      const correlationId = typeof suppliedCorrelation === "string" && correlationPattern.test(suppliedCorrelation)
        ? suppliedCorrelation : randomUUID();
      const suffixWithQuery = request.raw.url.slice("/api/marketing".length);
      const [rawPath, rawQuery] = suffixWithQuery.split("?", 2);
      const upstreamPath = `/v1${rawPath || "/"}`;
      const upstreamUrl = `${marketing.internalUrl}${upstreamPath}${rawQuery ? `?${rawQuery}` : ""}`;
      const headers = new Headers();
      for (const name of requestHeaderAllowlist) {
        const value = request.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      headers.set("x-correlation-id", correlationId);
      headers.set("x-ens-actor-assertion", await createActorAssertion({
        actor, correlationId, method: request.method, path: upstreamPath
      }, marketing.assertion));

      let body;
      if (!["GET", "HEAD"].includes(request.method)) {
        if (Buffer.isBuffer(request.body) || typeof request.body === "string") body = request.body;
        else if (request.body !== undefined) {
          body = JSON.stringify(request.body);
          if (!headers.has("content-type")) headers.set("content-type", "application/json");
        } else {
          body = request.raw;
        }
      }

      try {
        const upstream = await fetchImpl(upstreamUrl, {
          method: request.method,
          headers,
          body,
          ...(body === request.raw ? { duplex: "half" } : {}),
          redirect: "manual",
          signal: AbortSignal.timeout(marketing.timeoutMs)
        });
        reply.code(upstream.status);
        for (const name of responseHeaderAllowlist) {
          const value = upstream.headers.get(name);
          if (value) reply.header(name, value);
        }
        if (!upstream.body) return reply.send();
        return reply.send(Readable.fromWeb(upstream.body));
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        return reply.code(timedOut ? 504 : 503).send({
          error: {
            code: timedOut ? "marketing_ops_timeout" : "marketing_ops_unavailable",
            message: timedOut ? "Marketing Ops request timed out" : "Marketing Ops is temporarily unavailable",
            correlationId
          }
        });
      }
    }
  });
}
