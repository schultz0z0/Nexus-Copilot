import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  revokeSession,
} from "../src/auth/service.js";
import { createApp } from "../src/server.js";

// Helper to create a mock DB instance for testing
function createMockDb(initialData = {}) {
  const principals = [...(initialData.principals || [])];
  const credentials = [...(initialData.credentials || [])];
  const memberships = [...(initialData.memberships || [])];
  const sessions = [...(initialData.sessions || [])];

  return {
    principals,
    credentials,
    memberships,
    sessions,
    async query(sql, params = []) {
      const normalizedSql = sql.toLowerCase();

      // INSERT INTO iam.user_sessions
      if (normalizedSql.includes("insert into iam.user_sessions")) {
        const [userId, tokenHash, ipAddress, userAgent, expiresAt] = params;
        const session = {
          id: `session-${sessions.length + 1}`,
          user_id: userId,
          session_token_hash: tokenHash,
          ip_address: ipAddress,
          user_agent: userAgent,
          expires_at: expiresAt,
        };
        sessions.push(session);
        return { rows: [session], rowCount: 1 };
      }

      // SELECT from iam.resolve_session or iam.user_sessions (validateSession)
      if (
        normalizedSql.includes("iam.resolve_session") ||
        (normalizedSql.includes("select") && normalizedSql.includes("from iam.user_sessions"))
      ) {
        const [tokenHash] = params;
        const session = sessions.find((s) => s.session_token_hash === tokenHash);
        if (!session) return { rows: [] };

        const expiresAtDate = new Date(session.expires_at);
        if (expiresAtDate.getTime() <= Date.now()) {
          return { rows: [] };
        }

        const principal = principals.find((p) => p.id === session.user_id);
        if (!principal) return { rows: [] };

        const membership = memberships.find(
          (m) => m.principal_id === session.user_id && m.active !== false
        );

        return {
          rows: [
            {
              session_id: session.id,
              user_id: principal.id,
              expires_at: session.expires_at,
              email: principal.email,
              full_name: principal.full_name,
              tenant_id: membership ? membership.tenant_id : null,
              role: membership ? membership.role : null,
            },
          ],
        };
      }

      // DELETE FROM iam.user_sessions (revokeSession)
      if (normalizedSql.includes("delete from iam.user_sessions")) {
        const [tokenHash] = params;
        const idx = sessions.findIndex((s) => s.session_token_hash === tokenHash);
        if (idx !== -1) {
          sessions.splice(idx, 1);
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      // SELECT from iam.authenticate_by_email or iam.principals JOIN iam.user_credentials (login)
      if (
        normalizedSql.includes("iam.authenticate_by_email") ||
        (normalizedSql.includes("from iam.principals") &&
          normalizedSql.includes("iam.user_credentials"))
      ) {
        const [email] = params;
        const principal = principals.find(
          (p) => (p.email || "").toLowerCase() === (email || "").toLowerCase()
        );
        if (!principal) return { rows: [] };

        const credential = credentials.find((c) => c.user_id === principal.id);
        if (!credential) return { rows: [] };

        const membership = memberships.find(
          (m) => m.principal_id === principal.id && m.active !== false
        );

        return {
          rows: [
            {
              id: principal.id,
              email: principal.email,
              full_name: principal.full_name,
              password_hash: credential.password_hash,
              tenant_id: membership ? membership.tenant_id : null,
              role: membership ? membership.role : null,
            },
          ],
        };
      }

      return { rows: [] };
    },
  };
}

test("Password Hashing & Verification", async (t) => {
  await t.test("hashPassword creates valid bcrypt hash and verifyPassword confirms it", async () => {
    const password = "mySecretPassword123!";
    const hash = await hashPassword(password);
    assert.ok(hash.startsWith("$2a$"), "hash should start with $2a$");

    const isValid = await verifyPassword(password, hash);
    assert.strictEqual(isValid, true, "verifyPassword should return true for matching password");

    const isWrongValid = await verifyPassword("wrongPassword", hash);
    assert.strictEqual(isWrongValid, false, "verifyPassword should return false for wrong password");
  });

  await t.test("verifyPassword supports known $2a$ and $2b$ Supabase GoTrue bcrypt hashes", async () => {
    const password = "super-secret-password";
    const knownHash2a = "$2a$10$abcdefghijklmnopqrstuuUGzGZ5UgXqqC72ku7WIWJTj9CKQh1oG";
    const knownHash2b = "$2b$10$abcdefghijklmnopqrstuuUGzGZ5UgXqqC72ku7WIWJTj9CKQh1oG";

    const is2aValid = await verifyPassword(password, knownHash2a);
    assert.strictEqual(is2aValid, true, "$2a$ hash should verify successfully");

    const is2bValid = await verifyPassword(password, knownHash2b);
    assert.strictEqual(is2bValid, true, "$2b$ hash should verify successfully");

    const is2aWrong = await verifyPassword("incorrect-pass", knownHash2a);
    assert.strictEqual(is2aWrong, false, "$2a$ hash should reject incorrect password");

    const is2bWrong = await verifyPassword("incorrect-pass", knownHash2b);
    assert.strictEqual(is2bWrong, false, "$2b$ hash should reject incorrect password");
  });

  await t.test("verifyPassword safely handles empty or invalid inputs", async () => {
    assert.strictEqual(await verifyPassword("", "$2a$10$abcdef"), false);
    assert.strictEqual(await verifyPassword("password", ""), false);
    assert.strictEqual(await verifyPassword(null, null), false);
    assert.strictEqual(await verifyPassword("password", "invalid_not_a_hash"), false);
  });
});

test("Session Management", async (t) => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const userPrincipal = {
    id: userId,
    email: "user@example.com",
    full_name: "Test User",
  };
  const membership = {
    tenant_id: "22222222-2222-4222-8222-222222222222",
    principal_id: userId,
    role: "admin",
    active: true,
  };

  await t.test("createSession generates 32-byte hex token, stores sha256 hash in DB, and returns token", async () => {
    const db = createMockDb({
      principals: [userPrincipal],
      memberships: [membership],
    });

    const { token, expiresAt } = await createSession(db, {
      userId,
      ipAddress: "127.0.0.1",
      userAgent: "TestAgent/1.0",
      ttlDays: 7,
    });

    assert.ok(token, "token should be returned");
    assert.strictEqual(token.length, 64, "token should be 32 bytes hex (64 chars)");
    assert.ok(expiresAt instanceof Date || typeof expiresAt === "string", "expiresAt should be a Date or ISO string");

    // Verify raw token is NOT stored in DB
    assert.strictEqual(db.sessions.length, 1);
    const storedSession = db.sessions[0];
    assert.notStrictEqual(storedSession.session_token_hash, token, "raw token must NOT be stored in DB");

    // Verify stored session contains SHA-256 hash of token
    const expectedHash = createHash("sha256").update(token).digest("hex");
    assert.strictEqual(storedSession.session_token_hash, expectedHash);
    assert.strictEqual(storedSession.user_id, userId);
    assert.strictEqual(storedSession.ip_address, "127.0.0.1");
    assert.strictEqual(storedSession.user_agent, "TestAgent/1.0");
  });

  await t.test("validateSession returns user payload for valid active session", async () => {
    const db = createMockDb({
      principals: [userPrincipal],
      memberships: [membership],
    });

    const { token } = await createSession(db, {
      userId,
      ipAddress: "127.0.0.1",
      userAgent: "TestAgent/1.0",
      ttlDays: 30,
    });

    const user = await validateSession(db, token);
    assert.ok(user, "user payload should not be null");
    assert.strictEqual(user.id, userId);
    assert.strictEqual(user.email, "user@example.com");
    assert.strictEqual(user.full_name, "Test User");
    assert.strictEqual(user.tenant_id, "22222222-2222-4222-8222-222222222222");
    assert.strictEqual(user.role, "admin");
  });

  await t.test("validateSession returns null for nonexistent or invalid token", async () => {
    const db = createMockDb({
      principals: [userPrincipal],
      memberships: [membership],
    });

    const result = await validateSession(db, "nonexistent-token-12345");
    assert.strictEqual(result, null);

    const emptyResult = await validateSession(db, "");
    assert.strictEqual(emptyResult, null);
  });

  await t.test("validateSession returns null for expired session", async () => {
    const db = createMockDb({
      principals: [userPrincipal],
      memberships: [membership],
    });

    const { token } = await createSession(db, {
      userId,
      ipAddress: "127.0.0.1",
      userAgent: "TestAgent/1.0",
      ttlDays: -1, // Expired yesterday
    });

    const result = await validateSession(db, token);
    assert.strictEqual(result, null, "expired session should return null");
  });

  await t.test("revokeSession removes session from DB", async () => {
    const db = createMockDb({
      principals: [userPrincipal],
      memberships: [membership],
    });

    const { token } = await createSession(db, {
      userId,
      ipAddress: "127.0.0.1",
      userAgent: "TestAgent/1.0",
      ttlDays: 30,
    });

    assert.strictEqual(db.sessions.length, 1);
    await revokeSession(db, token);
    assert.strictEqual(db.sessions.length, 0, "session should be removed");

    const validated = await validateSession(db, token);
    assert.strictEqual(validated, null, "revoked session should return null");
  });
});

test("Fastify Auth Routes & Server", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const validPassword = "super-secret-password";
  const passwordHash = "$2a$10$abcdefghijklmnopqrstuuUGzGZ5UgXqqC72ku7WIWJTj9CKQh1oG";

  const principal = {
    id: userId,
    email: "operator@nexus.local",
    full_name: "Nexus Operator",
  };
  const credential = {
    user_id: userId,
    password_hash: passwordHash,
  };
  const membership = {
    tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    principal_id: userId,
    role: "manager",
    active: true,
  };

  const setupApp = async (customDb) => {
    const db =
      customDb ||
      createMockDb({
        principals: [principal],
        credentials: [credential],
        memberships: [membership],
      });
    const config = {
      port: 3000,
      host: "127.0.0.1",
      nodeEnv: "test",
      cookieSecret: "test-cookie-secret-minimum-32-chars-long!",
      cookieName: "ens_session",
      sessionTtlDays: 30,
      secureCookies: false,
      corsOrigin: true,
    };
    const app = await createApp({ db, config });
    return { app, db };
  };

  await t.test("GET /health returns 200 with service info", async () => {
    const { app } = await setupApp();
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepStrictEqual(body, { status: "ok", service: "app-api" });
  });

  await t.test("POST /api/auth/login validates input (returns 400 if missing)", async () => {
    const { app } = await setupApp();

    const resNoBody = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });
    assert.strictEqual(resNoBody.statusCode, 400);

    const resNoPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "operator@nexus.local" },
    });
    assert.strictEqual(resNoPassword.statusCode, 400);

    const resNoEmail = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "password" },
    });
    assert.strictEqual(resNoEmail.statusCode, 400);
  });

  await t.test("POST /api/auth/login with wrong password returns 401", async () => {
    const { app } = await setupApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "operator@nexus.local",
        password: "wrong-password",
      },
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, "Invalid credentials");
    assert.ok(!res.headers["set-cookie"], "Should not set cookie on failed login");
  });

  await t.test("POST /api/auth/login with unknown email returns 401", async () => {
    const { app } = await setupApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "unknown@nexus.local",
        password: "any-password",
      },
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, "Invalid credentials");
  });

  await t.test("POST /api/auth/login with correct credentials sets ens_session cookie and returns user", async () => {
    const { app, db } = await setupApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "operator@nexus.local",
        password: validPassword,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepStrictEqual(body.user, {
      id: userId,
      email: "operator@nexus.local",
      full_name: "Nexus Operator",
      tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      role: "manager",
    });

    // Check set-cookie header
    const setCookie = res.headers["set-cookie"];
    assert.ok(setCookie, "set-cookie header must be present");
    assert.match(setCookie, /ens_session=[a-f0-9]{64}/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//i);
    assert.match(setCookie, /Max-Age=2592000/i);

    // Verify session stored in db
    assert.strictEqual(db.sessions.length, 1);
  });

  await t.test("GET /api/auth/me without cookie returns 401 Unauthorized", async () => {
    const { app } = await setupApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
    });

    assert.strictEqual(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, "Unauthorized");
  });

  await t.test("GET /api/auth/me with valid session cookie returns user payload", async () => {
    const { app } = await setupApp();

    // 1. Login to get cookie
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "operator@nexus.local",
        password: validPassword,
      },
    });

    const setCookie = loginRes.headers["set-cookie"];
    const match = setCookie.match(/ens_session=([^;]+)/);
    assert.ok(match, "ens_session cookie value found");
    const cookieHeader = `ens_session=${match[1]}`;

    // 2. Call /api/auth/me with cookie
    const meRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: cookieHeader,
      },
    });

    assert.strictEqual(meRes.statusCode, 200);
    const meBody = JSON.parse(meRes.body);
    assert.deepStrictEqual(meBody.user, {
      id: userId,
      email: "operator@nexus.local",
      full_name: "Nexus Operator",
      avatar_url: null,
      tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      role: "manager",
    });
  });

  await t.test("POST /api/auth/logout clears cookie and revokes session", async () => {
    const { app, db } = await setupApp();

    // 1. Login
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "operator@nexus.local",
        password: validPassword,
      },
    });

    const setCookie = loginRes.headers["set-cookie"];
    const match = setCookie.match(/ens_session=([^;]+)/);
    const cookieHeader = `ens_session=${match[1]}`;

    assert.strictEqual(db.sessions.length, 1);

    // 2. Logout
    const logoutRes = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: cookieHeader,
      },
    });

    assert.strictEqual(logoutRes.statusCode, 200);
    const logoutBody = JSON.parse(logoutRes.body);
    assert.deepStrictEqual(logoutBody, { ok: true });

    // Cookie should be cleared (Max-Age=0 or Expires in past)
    const clearCookie = logoutRes.headers["set-cookie"];
    assert.ok(clearCookie, "clear cookie header should be present");
    assert.match(clearCookie, /ens_session=/);

    // Session must be removed from DB
    assert.strictEqual(db.sessions.length, 0, "session in db should be revoked");

    // 3. /api/auth/me should now fail with 401
    const meResAfterLogout = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: cookieHeader,
      },
    });
    assert.strictEqual(meResAfterLogout.statusCode, 401);
  });

  await t.test("GET /api/auth/session works as an alias to /api/auth/me", async () => {
    const { app } = await setupApp();

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "operator@nexus.local",
        password: validPassword,
      },
    });

    const setCookie = loginRes.headers["set-cookie"];
    const match = setCookie.match(/ens_session=([^;]+)/);
    const cookieHeader = `ens_session=${match[1]}`;

    const sessionRes = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: cookieHeader,
      },
    });

    assert.strictEqual(sessionRes.statusCode, 200);
    const body = JSON.parse(sessionRes.body);
    assert.strictEqual(body.user.email, "operator@nexus.local");
  });

  await t.test("POST /api/auth/login is case-insensitive for email", async () => {
    const { app } = await setupApp();

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "OPERATOR@NEXUS.LOCAL",
        password: validPassword,
      },
    });

    assert.strictEqual(loginRes.statusCode, 200);
    const body = JSON.parse(loginRes.body);
    assert.strictEqual(body.user.email, "operator@nexus.local");
  });
});

