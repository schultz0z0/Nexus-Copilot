import { validateSession, updateUserAvatar } from "../auth/service.js";

/**
 * Fastify plugin for attachments upload, access links, and artifact content proxy.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} options
 * @param {object} options.db - Database handle providing query()
 * @param {object} [options.config] - Application config
 */
export async function attachmentRoutes(fastify, options) {
  const { db, config } = options;
  const cookieName = config?.cookieName || "ens_session";
  const artifactConfig = {
    internalUrl: (config?.artifact?.internalUrl || config?.artifactInternalUrl || "http://localhost:8095").replace(/\/$/, ""),
    internalKey: config?.artifact?.internalKey || config?.artifactInternalKey || "",
    accessTokenTtlSeconds: config?.artifact?.accessTokenTtlSeconds || config?.artifactAccessTokenTtlSeconds || 900,
  };

  const authenticateUser = async (request, reply) => {
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
    request.token = token;
  };

  // POST /api/attachments (Upload file)
  fastify.post("/api/attachments", { preHandler: authenticateUser }, async (request, reply) => {
    let fileData;
    try {
      fileData = await request.file();
    } catch {
      return reply.code(400).send({ error: "Invalid multipart request" });
    }

    if (!fileData) {
      return reply.code(400).send({ error: "No file provided" });
    }

    const buffer = await fileData.toBuffer();
    const sessionId = fileData.fields?.session_id?.value || "";

    const uploadHeaders = {
      authorization: `Bearer ${artifactConfig.internalKey}`,
      "x-nexus-owner-id": request.user.id,
      "x-nexus-filename": fileData.filename,
      "x-nexus-content-type": fileData.mimetype,
      "x-nexus-source": "chat-web",
    };
    if (sessionId) {
      uploadHeaders["x-nexus-session-id"] = sessionId;
    }

    let artifactRes;
    try {
      artifactRes = await fetch(`${artifactConfig.internalUrl}/v1/artifacts`, {
        method: "POST",
        headers: uploadHeaders,
        body: buffer,
      });
    } catch {
      return reply.code(502).send({ error: "Artifact Server unavailable" });
    }

    if (!artifactRes.ok) {
      const errText = await artifactRes.text().catch(() => "");
      return reply.code(artifactRes.status).send({ error: "Failed to upload to Artifact Server", details: errText });
    }

    const artifact = await artifactRes.json();

    // Create access link
    let linkRes;
    try {
      linkRes = await fetch(`${artifactConfig.internalUrl}/v1/artifacts/${artifact.id}/access-link`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${artifactConfig.internalKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          owner_id: request.user.id,
          expires_in_seconds: artifactConfig.accessTokenTtlSeconds,
        }),
      });
    } catch {
      return reply.code(502).send({ error: "Artifact Server access link unavailable" });
    }

    if (!linkRes.ok) {
      return reply.code(linkRes.status).send({ error: "Failed to create access link" });
    }

    const accessLink = await linkRes.json();
    const relativeUrl = `/api/artifacts/${artifact.id}/content?token=${accessLink.token}`;

    return reply.code(201).send({
      attachment: {
        id: artifact.id,
        filename: artifact.filename,
        content_type: artifact.content_type,
        byte_size: artifact.size,
        sha256: artifact.sha256,
        url: relativeUrl,
        direct_url: accessLink.url,
        token: accessLink.token,
        expires_at: accessLink.expires_at,
      },
    });
  });

  // POST /api/attachments/:id/access-link (Refresh access link)
  fastify.post("/api/attachments/:id/access-link", { preHandler: authenticateUser }, async (request, reply) => {
    const { id } = request.params;
    let linkRes;
    try {
      linkRes = await fetch(`${artifactConfig.internalUrl}/v1/artifacts/${encodeURIComponent(id)}/access-link`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${artifactConfig.internalKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          owner_id: request.user.id,
          expires_in_seconds: artifactConfig.accessTokenTtlSeconds,
        }),
      });
    } catch {
      return reply.code(502).send({ error: "Artifact Server unavailable" });
    }

    if (!linkRes.ok) {
      return reply.code(linkRes.status).send({ error: "Failed to generate access link" });
    }

    const accessLink = await linkRes.json();
    return {
      artifact_id: id,
      url: `/api/artifacts/${id}/content?token=${accessLink.token}`,
      direct_url: accessLink.url,
      token: accessLink.token,
      expires_at: accessLink.expires_at,
    };
  });

  // GET /api/artifacts/:id/content (Content Proxy)
  fastify.get("/api/artifacts/:id/content", async (request, reply) => {
    const { id } = request.params;
    const token = request.query?.token;
    if (!token) {
      return reply.code(401).send({ error: "Missing token" });
    }

    const targetUrl = `${artifactConfig.internalUrl}/v1/artifacts/${encodeURIComponent(id)}/content?token=${encodeURIComponent(token)}`;
    const headers = {};
    if (request.headers.range) {
      headers.range = request.headers.range;
    }

    let response;
    try {
      response = await fetch(targetUrl, {
        method: "GET",
        headers,
      });
    } catch {
      return reply.code(502).send({ error: "Artifact Server content unavailable" });
    }

    if (!response.ok) {
      return reply.code(response.status).send({ error: "Failed to fetch artifact content" });
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const contentDisposition = response.headers.get("content-disposition");
    const acceptRanges = response.headers.get("accept-ranges");
    const contentRange = response.headers.get("content-range");
    const contentLength = response.headers.get("content-length");

    const replyHeaders = {
      "content-type": contentType,
      "cache-control": "private, max-age=0, no-store",
    };
    if (contentDisposition) replyHeaders["content-disposition"] = contentDisposition;
    if (acceptRanges) replyHeaders["accept-ranges"] = acceptRanges;
    if (contentRange) replyHeaders["content-range"] = contentRange;
    if (contentLength) replyHeaders["content-length"] = contentLength;

    reply.raw.writeHead(response.status, replyHeaders);

    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            reply.raw.write(value);
          }
        } catch {
          // Closed by client
        } finally {
          reply.raw.end();
        }
      };
      await pump();
    } else {
      reply.raw.end();
    }

    return reply;
  });

  // Helper for avatar uploads
  const handleAvatarUploadForUser = async (targetUserId, request, reply) => {
    let fileData;
    try {
      fileData = await request.file();
    } catch {
      return reply.code(400).send({ error: "Invalid multipart request" });
    }

    if (!fileData) {
      return reply.code(400).send({ error: "No file provided" });
    }

    const buffer = await fileData.toBuffer();
    let artifactRes;
    try {
      artifactRes = await fetch(`${artifactConfig.internalUrl}/v1/artifacts`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${artifactConfig.internalKey}`,
          "x-nexus-owner-id": targetUserId,
          "x-nexus-filename": fileData.filename || "avatar.png",
          "x-nexus-content-type": fileData.mimetype || "image/png",
          "x-nexus-source": "user-avatar",
        },
        body: buffer,
      });
    } catch {
      return reply.code(502).send({ error: "Artifact Server unavailable" });
    }

    if (!artifactRes.ok) {
      return reply.code(artifactRes.status).send({ error: "Failed to upload avatar" });
    }

    const artifact = await artifactRes.json();
    const ttl = 3600 * 24 * 365; // 1 year long-lived access token for avatar

    let linkRes;
    try {
      linkRes = await fetch(`${artifactConfig.internalUrl}/v1/artifacts/${artifact.id}/access-link`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${artifactConfig.internalKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          owner_id: targetUserId,
          expires_in_seconds: ttl,
        }),
      });
    } catch {
      return reply.code(502).send({ error: "Artifact Server access link unavailable" });
    }

    if (!linkRes.ok) {
      return reply.code(linkRes.status).send({ error: "Failed to create avatar access link" });
    }

    const accessLink = await linkRes.json();
    const avatarUrl = `/api/artifacts/${artifact.id}/content?token=${accessLink.token}`;

    await updateUserAvatar(db, targetUserId, avatarUrl);
    return { avatar_url: avatarUrl };
  };

  // PATCH /api/users/me (Update current user profile)
  fastify.patch("/api/users/me", { preHandler: authenticateUser }, async (request, reply) => {
    const { full_name } = request.body || {};
    if (full_name !== undefined) {
      await db.query(
        "UPDATE iam.principals SET full_name = $1, updated_at = transaction_timestamp() WHERE id = $2",
        [full_name || null, request.user.id]
      );
    }
    return { ok: true, full_name: full_name || null };
  });

  // POST /api/users/me/avatar
  fastify.post("/api/users/me/avatar", { preHandler: authenticateUser }, async (request, reply) => {
    return handleAvatarUploadForUser(request.user.id, request, reply);
  });

  // DELETE /api/users/me/avatar
  fastify.delete("/api/users/me/avatar", { preHandler: authenticateUser }, async (request, reply) => {
    await updateUserAvatar(db, request.user.id, null);
    return { ok: true, avatar_url: null };
  });

  // POST /api/admin/users/:id/avatar (Admin only)
  fastify.post("/api/admin/users/:id/avatar", { preHandler: authenticateUser }, async (request, reply) => {
    if (request.user.role !== "admin") {
      return reply.code(403).send({ error: "Forbidden" });
    }
    return handleAvatarUploadForUser(request.params.id, request, reply);
  });

  // DELETE /api/admin/users/:id/avatar (Admin only)
  fastify.delete("/api/admin/users/:id/avatar", { preHandler: authenticateUser }, async (request, reply) => {
    if (request.user.role !== "admin") {
      return reply.code(403).send({ error: "Forbidden" });
    }
    await updateUserAvatar(db, request.params.id, null);
    return { ok: true, avatar_url: null };
  });
}

export default attachmentRoutes;
