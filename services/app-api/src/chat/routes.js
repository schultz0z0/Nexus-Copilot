import { validateSession } from "../auth/service.js";
import {
  createChatSession,
  listChatSessions,
  getChatSession,
  updateChatSession,
  deleteChatSession,
  listChatMessages,
  createChatMessage,
} from "./service.js";

/**
 * Fastify plugin for chat domain routes and Chat Bridge proxy.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} options
 * @param {object} options.db - Database handle providing query()
 * @param {object} [options.config] - Application config
 */
export async function chatRoutes(fastify, options) {
  const { db, config } = options;
  const cookieName = config?.cookieName || "ens_session";
  const chatBridgeUrl = (config?.chatBridgeUrl || "http://localhost:8080").replace(/\/$/, "");

  // Authentication pre-handler for all chat routes in this plugin
  fastify.addHook("preHandler", async (request, reply) => {
    let token = request.cookies?.[cookieName];
    if (!token && request.headers.authorization) {
      const match = request.headers.authorization.match(/^Bearer\s+(.+)$/i);
      if (match) {
        token = match[1].trim();
      }
    }

    if (!token) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const user = await validateSession(db, token);
    if (!user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    request.user = user;
  });

  // POST /api/chat/sessions
  fastify.post("/api/chat/sessions", async (request, reply) => {
    const session = await createChatSession(db, request.user, request.body || {});
    return reply.code(201).send({ session });
  });

  // GET /api/chat/sessions
  fastify.get("/api/chat/sessions", async (request, reply) => {
    const rawKind = request.query?.session_kind;
    const sessionKind = rawKind === "all" ? null : rawKind;
    const limit = request.query?.limit ? Number.parseInt(request.query.limit, 10) : undefined;
    const sessions = await listChatSessions(db, request.user, {
      session_kind: sessionKind,
      limit,
    });
    return { sessions };
  });

  // GET /api/chat/sessions/:id
  fastify.get("/api/chat/sessions/:id", async (request, reply) => {
    const session = await getChatSession(db, request.user, request.params.id);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }
    return { session };
  });

  // PATCH /api/chat/sessions/:id
  fastify.patch("/api/chat/sessions/:id", async (request, reply) => {
    const { title } = request.body || {};
    if (!title || typeof title !== "string") {
      return reply.code(400).send({ error: "Title is required" });
    }

    const session = await updateChatSession(db, request.user, request.params.id, { title });
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }
    return { session };
  });

  // DELETE /api/chat/sessions/:id
  fastify.delete("/api/chat/sessions/:id", async (request, reply) => {
    const deleted = await deleteChatSession(db, request.user, request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: "Session not found" });
    }
    return { ok: true };
  });

  // GET /api/chat/sessions/:id/messages
  fastify.get("/api/chat/sessions/:id/messages", async (request, reply) => {
    const limit = request.query?.limit ? Number.parseInt(request.query.limit, 10) : 50;
    const before =
      request.query?.before_created_at && request.query?.before_id
        ? { created_at: request.query.before_created_at, id: request.query.before_id }
        : undefined;

    const result = await listChatMessages(db, request.user, request.params.id, { limit, before });
    if (!result) {
      return reply.code(404).send({ error: "Session not found" });
    }
    return result;
  });

  // POST /api/chat/sessions/:id/messages
  fastify.post("/api/chat/sessions/:id/messages", async (request, reply) => {
    const { role, content, id } = request.body || {};

    if (!role || !["user", "assistant"].includes(role) || typeof content !== "string" || !content.trim()) {
      return reply.code(400).send({ error: "Invalid role or content" });
    }

    const message = await createChatMessage(db, request.user, request.params.id, {
      id,
      role,
      content,
    });

    if (!message) {
      return reply.code(404).send({ error: "Session not found" });
    }

    return reply.code(201).send({ message });
  });

  // Helper to forward requests to Chat Bridge
  const forwardToBridge = async (url, method, req, reply, body) => {
    const headers = {
      "content-type": "application/json",
      "x-user-id": req.user.id,
      "x-tenant-id": req.user.tenant_id ?? "",
    };
    if (req.headers.authorization) {
      headers.authorization = req.headers.authorization;
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        return reply.code(response.status).send(data);
      }
      const text = await response.text();
      return reply.code(response.status).type(contentType || "text/plain").send(text);
    } catch {
      return reply.code(502).send({ error: "Chat Bridge unavailable" });
    }
  };

  // POST /api/chat/runs (Proxy)
  fastify.post("/api/chat/runs", async (request, reply) => {
    return forwardToBridge(
      `${chatBridgeUrl}/api/chat/runs`,
      "POST",
      request,
      reply,
      request.body || {}
    );
  });

  // GET /api/chat/runs/:id (Proxy with DB fallback)
  fastify.get("/api/chat/runs/:id", async (request, reply) => {
    const { id } = request.params;
    try {
      const response = await fetch(
        `${chatBridgeUrl}/api/chat/runs/${encodeURIComponent(id)}`,
        {
          method: "GET",
          headers: {
            "content-type": "application/json",
            "x-user-id": request.user.id,
            "x-tenant-id": request.user.tenant_id ?? "",
            ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
          },
        }
      );

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        return reply.code(response.status).send(data);
      }
      const text = await response.text();
      return reply.code(response.status).type(contentType || "text/plain").send(text);
    } catch {
      // Bridge unreachable: fallback to DB query in chat.bridge_runs
      try {
        const queryText = `SELECT state FROM chat.bridge_runs WHERE id = $1 AND user_id = $2`;
        const result = await db.query(queryText, [id, request.user.id]);
        if (result.rows && result.rows.length > 0) {
          return reply.code(200).send({ run: result.rows[0].state });
        }
      } catch {
        // Fallback failed
      }
      return reply.code(502).send({ error: "Chat Bridge unavailable" });
    }
  });

  // POST /api/chat/runs/:id/stop (Proxy)
  fastify.post("/api/chat/runs/:id/stop", async (request, reply) => {
    return forwardToBridge(
      `${chatBridgeUrl}/api/chat/runs/${encodeURIComponent(request.params.id)}/stop`,
      "POST",
      request,
      reply,
      request.body
    );
  });
}

export default chatRoutes;
