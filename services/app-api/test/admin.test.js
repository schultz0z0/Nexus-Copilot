import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashPassword, createSession } from "../src/auth/service.js";
import { createApp } from "../src/server.js";

function createMockAdminDb() {
  const tenants = [{ id: "11111111-1111-1111-1111-111111111111", slug: "test-tenant", name: "Test Tenant" }];
  const principals = [];
  const credentials = [];
  const memberships = [];
  const sessions = [];
  const integrations = [];

  const db = {
    tenants,
    principals,
    credentials,
    memberships,
    sessions,
    integrations,
    async withTransaction(cb) {
      return cb(db);
    },
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

      // SELECT iam.resolve_session
      if (normalizedSql.includes("iam.resolve_session")) {
        const [tokenHash] = params;
        const session = sessions.find((s) => s.session_token_hash === tokenHash);
        if (!session) return { rows: [] };

        const principal = principals.find((p) => p.id === session.user_id);
        if (!principal) return { rows: [] };

        const membership = memberships.find((m) => m.principal_id === session.user_id && m.active !== false);

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

      // SELECT from iam.user_credentials
      if (normalizedSql.includes("select") && normalizedSql.includes("from iam.user_credentials")) {
        const [userId] = params;
        const cred = credentials.find((c) => c.user_id === userId);
        return { rows: cred ? [cred] : [], rowCount: cred ? 1 : 0 };
      }

      // UPDATE iam.user_credentials
      if (normalizedSql.includes("update iam.user_credentials")) {
        const [newHash, userId] = params;
        const cred = credentials.find((c) => c.user_id === userId);
        if (cred) {
          cred.password_hash = newHash;
        }
        return { rowCount: cred ? 1 : 0 };
      }

      // DELETE FROM iam.user_sessions
      if (normalizedSql.includes("delete from iam.user_sessions")) {
        const [target] = params;
        const initialLen = sessions.length;
        // Could be by token hash or by user_id
        for (let i = sessions.length - 1; i >= 0; i--) {
          if (sessions[i].session_token_hash === target || sessions[i].user_id === target) {
            sessions.splice(i, 1);
          }
        }
        return { rowCount: initialLen - sessions.length };
      }

      // SELECT single user (after update / get)
      if (normalizedSql.includes("from iam.principals p") && normalizedSql.includes("where p.id = $2")) {
        const [tenantId, userId] = params;
        const p = principals.find((pr) => pr.id === userId);
        if (!p) return { rows: [], rowCount: 0 };
        const m = memberships.find((mem) => mem.principal_id === userId);
        const uci = integrations.find((i) => i.user_id === userId);
        return {
          rows: [
            {
              id: p.id,
              email: p.email,
              full_name: p.full_name,
              avatar_url: p.avatar_url || null,
              created_at: p.created_at,
              updated_at: p.updated_at,
              role: m ? m.role : "member",
              active: m ? m.active !== false : true,
              hermes_enabled: uci ? uci.hermes_enabled : false,
              hermes_base_url: uci ? uci.hermes_base_url : null,
            },
          ],
          rowCount: 1,
        };
      }

      // SELECT listAdminUsers / iam.principals JOIN iam.memberships
      if (normalizedSql.includes("from iam.principals p") && normalizedSql.includes("join iam.memberships m")) {
        const [tenantId] = params;
        const rows = principals
          .map((p) => {
            const m = memberships.find((mem) => mem.principal_id === p.id && (!tenantId || mem.tenant_id === tenantId));
            if (!m) return null;
            const uci = integrations.find((i) => i.user_id === p.id);
            return {
              id: p.id,
              email: p.email,
              full_name: p.full_name,
              avatar_url: p.avatar_url || null,
              created_at: p.created_at,
              updated_at: p.updated_at,
              role: m.role,
              active: m.active !== false,
              hermes_enabled: uci ? uci.hermes_enabled : false,
              hermes_base_url: uci ? uci.hermes_base_url : null,
            };
          })
          .filter(Boolean);
        return { rows, rowCount: rows.length };
      }

      // INSERT INTO iam.principals
      if (normalizedSql.includes("insert into iam.principals")) {
        let id, email, fullName;
        if (params.length === 3) {
          [id, email, fullName] = params;
        } else {
          [email, fullName] = params;
          id = `00000000-0000-0000-0000-00000000000${principals.length + 1}`;
        }
        const newPrincipal = {
          id,
          email,
          full_name: fullName,
          avatar_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        principals.push(newPrincipal);
        return { rows: [newPrincipal], rowCount: 1 };
      }

      // INSERT INTO iam.user_credentials
      if (normalizedSql.includes("insert into iam.user_credentials")) {
        const [userId, passwordHash] = params;
        const cred = { user_id: userId, password_hash: passwordHash };
        credentials.push(cred);
        return { rows: [cred], rowCount: 1 };
      }

      // INSERT INTO iam.memberships
      if (normalizedSql.includes("insert into iam.memberships")) {
        const [tenantId, principalId, role, active] = params;
        const mem = { tenant_id: tenantId, principal_id: principalId, role, active: active !== false };
        memberships.push(mem);
        return { rows: [mem], rowCount: 1 };
      }

      // UPDATE iam.principals
      if (normalizedSql.includes("update iam.principals")) {
        const [fullName, avatarUrl, userId] = params;
        const p = principals.find((pr) => pr.id === userId);
        if (p) {
          if (fullName !== null && fullName !== undefined) p.full_name = fullName;
          if (avatarUrl !== null && avatarUrl !== undefined) p.avatar_url = avatarUrl;
        }
        return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
      }

      // UPDATE iam.memberships
      if (normalizedSql.includes("update iam.memberships")) {
        const [role, active, userId, tenantId] = params;
        const m = memberships.find((mem) => mem.principal_id === userId && mem.tenant_id === tenantId);
        if (m) {
          if (role !== null && role !== undefined) m.role = role;
          if (active !== null && active !== undefined) m.active = active;
        }
        return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
      }

      // INSERT INTO iam.user_chat_integrations ON CONFLICT
      if (normalizedSql.includes("insert into iam.user_chat_integrations")) {
        const [userId, hermesEnabled, hermesBaseUrl] = params;
        let uci = integrations.find((i) => i.user_id === userId);
        if (!uci) {
          uci = { user_id: userId, hermes_enabled: hermesEnabled, hermes_base_url: hermesBaseUrl };
          integrations.push(uci);
        } else {
          uci.hermes_enabled = hermesEnabled;
          uci.hermes_base_url = hermesBaseUrl;
        }
        return { rows: [uci], rowCount: 1 };
      }


      // DELETE FROM iam.principals
      if (normalizedSql.includes("delete from iam.principals")) {
        const [userId] = params;
        const pIdx = principals.findIndex((p) => p.id === userId);
        if (pIdx !== -1) principals.splice(pIdx, 1);
        for (let i = memberships.length - 1; i >= 0; i--) {
          if (memberships[i].principal_id === userId) memberships.splice(i, 1);
        }
        for (let i = credentials.length - 1; i >= 0; i--) {
          if (credentials[i].user_id === userId) credentials.splice(i, 1);
        }
        for (let i = sessions.length - 1; i >= 0; i--) {
          if (sessions[i].user_id === userId) sessions.splice(i, 1);
        }
        return { rowCount: pIdx !== -1 ? 1 : 0 };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  return db;
}

test("Admin Routes & Authorization", async (t) => {
  const db = createMockAdminDb();
  const tenantId = db.tenants[0].id;

  // Create admin user
  const adminHash = await hashPassword("AdminSecret123!");
  const adminId = "00000000-0000-0000-0000-000000000001";
  db.principals.push({
    id: adminId,
    email: "admin@ens.local",
    full_name: "Admin User",
    avatar_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  db.credentials.push({ user_id: adminId, password_hash: adminHash });
  db.memberships.push({ tenant_id: tenantId, principal_id: adminId, role: "admin", active: true });

  // Create standard member user
  const memberHash = await hashPassword("MemberSecret123!");
  const memberId = "00000000-0000-0000-0000-000000000002";
  db.principals.push({
    id: memberId,
    email: "member@ens.local",
    full_name: "Member User",
    avatar_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  db.credentials.push({ user_id: memberId, password_hash: memberHash });
  db.memberships.push({ tenant_id: tenantId, principal_id: memberId, role: "member", active: true });

  // Create sessions for admin and member
  const { token: adminToken } = await createSession(db, { userId: adminId });
  const { token: memberToken } = await createSession(db, { userId: memberId });

  const app = await createApp({
    config: {
      cookieSecret: "test-secret",
      cookieName: "ens_session",
      corsOrigin: true,
    },
    db,
  });

  await t.test("GET /api/admin/users rejects unauthenticated requests with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
    });
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test("GET /api/admin/users rejects non-admin users with 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      cookies: { ens_session: memberToken },
    });
    assert.strictEqual(res.statusCode, 403);
    const body = res.json();
    assert.match(body.error, /admin access required/i);
  });

  await t.test("GET /api/admin/users lists tenant users for admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      cookies: { ens_session: adminToken },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.users));
    assert.strictEqual(body.users.length, 2);
    assert.ok(body.users.some((u) => u.email === "admin@ens.local" && u.role === "admin"));
    assert.ok(body.users.some((u) => u.email === "member@ens.local" && u.role === "member"));
  });

  await t.test("POST /api/admin/users validates input parameters", async () => {
    const invalidRes = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      cookies: { ens_session: adminToken },
      payload: { email: "invalid", password: "short" },
    });
    assert.strictEqual(invalidRes.statusCode, 400);
  });

  let createdUserId = "";
  await t.test("POST /api/admin/users creates a new user with 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      cookies: { ens_session: adminToken },
      payload: {
        email: "newuser@ens.local",
        password: "StrongPassword123!",
        full_name: "Novo Usuário",
        role: "manager",
      },
    });
    assert.strictEqual(res.statusCode, 201);
    const body = res.json();
    assert.ok(body.user);
    assert.strictEqual(body.user.email, "newuser@ens.local");
    assert.strictEqual(body.user.full_name, "Novo Usuário");
    assert.strictEqual(body.user.role, "manager");
    createdUserId = body.user.id;
  });

  await t.test("PATCH /api/admin/users/:id updates user name and role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${createdUserId}`,
      cookies: { ens_session: adminToken },
      payload: {
        full_name: "Usuário Atualizado",
        role: "member",
        hermes_enabled: true,
        hermes_base_url: "https://hermes-custom.internal:8642",
      },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = res.json();
    assert.strictEqual(body.user.full_name, "Usuário Atualizado");
    assert.strictEqual(body.user.role, "member");
    assert.strictEqual(body.user.hermes_enabled, true);
    assert.strictEqual(body.user.hermes_base_url, "https://hermes-custom.internal:8642");
  });

  await t.test("PATCH /api/admin/users/:id rejects non-HTTPS Hermes base URL", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${createdUserId}`,
      cookies: { ens_session: adminToken },
      payload: {
        hermes_base_url: "http://insecure-hermes.local",
      },
    });
    assert.strictEqual(res.statusCode, 400);
  });

  await t.test("POST /api/admin/users/:id/reset-password resets password and invalidates sessions", async () => {
    const resetRes = await app.inject({
      method: "POST",
      url: `/api/admin/users/${createdUserId}/reset-password`,
      cookies: { ens_session: adminToken },
      payload: {
        password: "NewPassword123!",
      },
    });
    assert.strictEqual(resetRes.statusCode, 200);
    assert.strictEqual(resetRes.json().ok, true);
  });

  await t.test("DELETE /api/admin/users/:id prevents self deletion", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${adminId}`,
      cookies: { ens_session: adminToken },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.json().error, /cannot delete your own account/i);
  });

  await t.test("DELETE /api/admin/users/:id deletes user successfully", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${createdUserId}`,
      cookies: { ens_session: adminToken },
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json().ok, true);
  });
});

test("Self Password Change (/api/auth/change-password)", async (t) => {
  const db = createMockAdminDb();
  const initialPassword = "OldPassword123!";
  const hash = await hashPassword(initialPassword);
  const userId = "00000000-0000-0000-0000-000000000099";

  db.principals.push({
    id: userId,
    email: "user@ens.local",
    full_name: "Test User",
    avatar_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  db.credentials.push({ user_id: userId, password_hash: hash });
  db.memberships.push({
    tenant_id: db.tenants[0].id,
    principal_id: userId,
    role: "member",
    active: true,
  });

  const { token } = await createSession(db, { userId });
  const app = await createApp({
    config: { cookieSecret: "test", cookieName: "ens_session" },
    db,
  });

  await t.test("POST /api/auth/change-password rejects unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      payload: { currentPassword: initialPassword, newPassword: "NewSecret123!" },
    });
    assert.strictEqual(res.statusCode, 401);
  });

  await t.test("POST /api/auth/change-password rejects wrong current password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      cookies: { ens_session: token },
      payload: { currentPassword: "WrongPassword!", newPassword: "NewSecret123!" },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.json().error, /invalid current password/i);
  });

  await t.test("POST /api/auth/change-password updates password on valid current password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      cookies: { ens_session: token },
      payload: { currentPassword: initialPassword, newPassword: "NewValidPassword123!" },
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.json().ok, true);
  });
});
