import { verifyPassword, createSession, validateSession, revokeSession, changeUserPassword } from "./service.js";

// Constant-time dummy hash for unknown user login attempts (prevents timing enumeration)
const DUMMY_HASH = "$2a$12$e8Y7z7r0xL9fXyUoA1b2c.o1kP9rQ8sT7uV6wX5yZ4aB3cD2eF1gH";

/**
 * Fastify plugin for authentication routes.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} options
 * @param {object} options.db
 * @param {object} [options.config]
 */
export async function authRoutes(fastify, options) {
  const { db, config } = options;
  const cookieName = config?.cookieName || "ens_session";
  const sessionTtlDays = config?.sessionTtlDays ?? 30;
  const secureCookies = Boolean(config?.secureCookies);

  // POST /api/auth/login
  fastify.post("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body || {};

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return reply.code(400).send({ error: "Email and password are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const queryText = `SELECT * FROM iam.authenticate_by_email($1)`;

    const result = await db.query(queryText, [normalizedEmail]);
    if (!result.rows || result.rows.length === 0) {
      await verifyPassword(password, DUMMY_HASH);
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const row = result.rows[0];
    const isPasswordValid = await verifyPassword(password, row.password_hash);
    if (!isPasswordValid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const { token } = await createSession(db, {
      userId: row.id,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
      ttlDays: sessionTtlDays,
    });

    reply.setCookie(cookieName, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: sessionTtlDays * 86400,
    });

    return {
      user: {
        id: row.id,
        email: row.email,
        full_name: row.full_name,
        tenant_id: row.tenant_id ?? null,
        role: row.role ?? null,
      },
    };
  });

  // POST /api/auth/logout
  fastify.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies?.[cookieName];
    if (token) {
      await revokeSession(db, token);
    }

    reply.clearCookie(cookieName, {
      path: "/",
    });

    return { ok: true };
  });

  // Handler for /api/auth/me and /api/auth/session alias
  const handleSession = async (request, reply) => {
    const token = request.cookies?.[cookieName];
    if (!token) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const user = await validateSession(db, token);
    if (!user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    return { user };
  };

  // POST /api/auth/change-password
  fastify.post("/api/auth/change-password", async (request, reply) => {
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

    const currentPassword = request.body?.currentPassword ?? request.body?.current_password;
    const newPassword = request.body?.newPassword ?? request.body?.new_password;

    if (!currentPassword || !newPassword) {
      return reply.code(400).send({ error: "Current password and new password are required" });
    }

    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return reply.code(400).send({ error: "New password must be at least 8 characters long" });
    }

    try {
      await changeUserPassword(db, user.id, currentPassword, newPassword);
      return { ok: true };
    } catch (err) {
      if (err.message === "Invalid current password") {
        return reply.code(400).send({ error: "Invalid current password" });
      }
      request.log?.error(err);
      return reply.code(500).send({ error: "Failed to change password" });
    }
  });

  // GET /api/auth/me & GET /api/auth/session
  fastify.get("/api/auth/me", handleSession);
  fastify.get("/api/auth/session", handleSession);
}

export default authRoutes;
