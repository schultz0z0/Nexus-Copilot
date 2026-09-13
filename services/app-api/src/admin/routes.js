import {
  validateSession,
  listAdminUsers,
  createAdminUser,
  updateAdminUser,
  resetAdminUserPassword,
  deleteAdminUser,
} from "../auth/service.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isValidUuid = (id) => typeof id === "string" && UUID_REGEX.test(id.trim());

/**
 * Fastify plugin for administrative routes.
 * Requires active session with role === 'admin'.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} options
 * @param {object} options.db
 * @param {object} [options.config]
 */
export async function adminRoutes(fastify, options) {
  const { db, config } = options;
  const cookieName = config?.cookieName || "ens_session";

  // Authorization pre-handler: requires valid session and role === 'admin'
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

    if (user.role !== "admin") {
      return reply.code(403).send({ error: "Forbidden: Admin access required" });
    }

    request.user = user;
    request.token = token;
  });

  // GET /api/admin/users
  fastify.get("/api/admin/users", async (request, reply) => {
    const users = await listAdminUsers(db, request.user.tenant_id);
    return { users };
  });

  // POST /api/admin/users
  fastify.post("/api/admin/users", async (request, reply) => {
    const { email, password, full_name, fullName, role } = request.body || {};

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return reply.code(400).send({ error: "Valid email is required" });
    }

    if (!password || typeof password !== "string" || password.length < 8) {
      return reply.code(400).send({ error: "Password must be at least 8 characters long" });
    }

    const assignedRole = role || "member";
    if (!["member", "manager", "admin"].includes(assignedRole)) {
      return reply.code(400).send({ error: "Invalid role. Allowed roles: member, manager, admin" });
    }

    try {
      const user = await createAdminUser(db, request.user.tenant_id, {
        email,
        password,
        fullName: fullName || full_name,
        role: assignedRole,
      });

      return reply.code(201).send({ user });
    } catch (err) {
      if (err.code === "23505" || err.message?.includes("duplicate key") || err.message?.includes("already exists")) {
        return reply.code(409).send({ error: "A user with this email already exists" });
      }
      request.log?.error(err);
      return reply.code(500).send({ error: "Failed to create user" });
    }
  });

  // PATCH /api/admin/users/:id
  fastify.patch("/api/admin/users/:id", async (request, reply) => {
    const { id } = request.params;
    if (!isValidUuid(id)) {
      return reply.code(400).send({ error: "Invalid user ID format" });
    }

    const body = request.body || {};

    if (body.role && !["member", "manager", "admin"].includes(body.role)) {
      return reply.code(400).send({ error: "Invalid role. Allowed roles: member, manager, admin" });
    }

    const hermesBaseUrl = body.hermes_base_url ?? body.hermesBaseUrl;
    if (hermesBaseUrl) {
      try {
        const parsed = new URL(hermesBaseUrl.trim());
        if (parsed.protocol !== "https:") {
          return reply.code(400).send({ error: "Custom Hermes base URL must use HTTPS" });
        }
      } catch {
        return reply.code(400).send({ error: "Invalid Hermes base URL format" });
      }
    }

    try {
      const updated = await updateAdminUser(db, request.user.tenant_id, id, body);
      if (!updated) {
        return reply.code(404).send({ error: "User not found" });
      }
      return { user: updated };
    } catch (err) {
      request.log?.error(err);
      return reply.code(500).send({ error: "Failed to update user" });
    }
  });

  // POST /api/admin/users/:id/reset-password
  fastify.post("/api/admin/users/:id/reset-password", async (request, reply) => {
    const { id } = request.params;
    if (!isValidUuid(id)) {
      return reply.code(400).send({ error: "Invalid user ID format" });
    }

    const { password } = request.body || {};
    if (!password || typeof password !== "string" || password.length < 8) {
      return reply.code(400).send({ error: "Password must be at least 8 characters long" });
    }

    try {
      await resetAdminUserPassword(db, id, password);
      return { ok: true };
    } catch (err) {
      request.log?.error(err);
      return reply.code(500).send({ error: "Failed to reset password" });
    }
  });

  // DELETE /api/admin/users/:id
  fastify.delete("/api/admin/users/:id", async (request, reply) => {
    const { id } = request.params;
    if (!isValidUuid(id)) {
      return reply.code(400).send({ error: "Invalid user ID format" });
    }

    if (id === request.user.id) {
      return reply.code(400).send({ error: "Cannot delete your own account" });
    }

    try {
      await deleteAdminUser(db, request.user.tenant_id, id);
      return { ok: true };
    } catch (err) {
      request.log?.error(err);
      return reply.code(500).send({ error: "Failed to delete user" });
    }
  });
}

export default adminRoutes;
