import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  createChatSession,
  listChatSessions,
  getChatSession,
  updateChatSession,
  deleteChatSession,
  createChatMessage,
  listChatMessages,
} from "../src/chat/service.js";
import { createApp } from "../src/server.js";

// Helper to create a mock DB instance for testing chat domain and IAM session validation
function createMockChatDb(initialData = {}) {
  const principals = [...(initialData.principals || [])];
  const memberships = [...(initialData.memberships || [])];
  const sessions = [...(initialData.sessions || [])];
  const chatSessions = [...(initialData.chatSessions || [])];
  const chatMessages = [...(initialData.chatMessages || [])];
  const bridgeRuns = [...(initialData.bridgeRuns || [])];

  return {
    principals,
    memberships,
    sessions,
    chatSessions,
    chatMessages,
    bridgeRuns,

    async query(sql, params = []) {
      const normalizedSql = sql.toLowerCase().replace(/\s+/g, " ");

      // IAM resolve_session (for authentication preHandler)
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

      // INSERT INTO chat.chat_sessions
      if (normalizedSql.includes("insert into chat.chat_sessions")) {
        const [id, userId, title, sessionKind] = params;
        const now = new Date().toISOString();
        const row = {
          id,
          user_id: userId,
          title: title ?? "Nova Conversa",
          session_kind: sessionKind ?? "normal",
          user_message_count: 0,
          created_at: now,
          updated_at: now,
        };
        chatSessions.push(row);
        return { rows: [row], rowCount: 1 };
      }

      // UPDATE chat.chat_sessions ... user_message_count
      if (
        normalizedSql.includes("update chat.chat_sessions") &&
        normalizedSql.includes("user_message_count")
      ) {
        const [sessionId, role] = params;
        const session = chatSessions.find((s) => s.id === sessionId);
        if (session) {
          session.updated_at = new Date().toISOString();
          if (role === "user") {
            session.user_message_count = (session.user_message_count || 0) + 1;
          }
          return { rows: [session], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // UPDATE chat.chat_sessions SET title = $3 ...
      if (
        normalizedSql.includes("update chat.chat_sessions") &&
        normalizedSql.includes("title =")
      ) {
        const [sessionId, userId, title] = params;
        const session = chatSessions.find((s) => s.id === sessionId && s.user_id === userId);
        if (session) {
          session.title = title;
          session.updated_at = new Date().toISOString();
          return { rows: [session], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // SELECT FROM chat.chat_sessions WHERE user_id = $1 AND ($2::text IS NULL OR session_kind = $2)
      if (
        normalizedSql.includes("from chat.chat_sessions") &&
        normalizedSql.includes("order by updated_at desc")
      ) {
        const [userId, sessionKind, limit] = params;
        let matched = chatSessions.filter((s) => s.user_id === userId);
        if (sessionKind !== null && sessionKind !== undefined) {
          matched = matched.filter((s) => s.session_kind === sessionKind);
        }
        matched.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
        if (limit) {
          matched = matched.slice(0, limit);
        }
        return { rows: matched, rowCount: matched.length };
      }

      // SELECT FROM chat.chat_sessions WHERE id = $1 AND user_id = $2
      if (
        normalizedSql.includes("select") &&
        normalizedSql.includes("from chat.chat_sessions") &&
        normalizedSql.includes("id = $1") &&
        normalizedSql.includes("user_id = $2")
      ) {
        const [id, userId] = params;
        const session = chatSessions.find((s) => s.id === id && s.user_id === userId);
        return { rows: session ? [session] : [], rowCount: session ? 1 : 0 };
      }

      // DELETE FROM chat.chat_sessions WHERE id = $1 AND user_id = $2
      if (normalizedSql.includes("delete from chat.chat_sessions")) {
        const [id, userId] = params;
        const idx = chatSessions.findIndex((s) => s.id === id && s.user_id === userId);
        if (idx !== -1) {
          chatSessions.splice(idx, 1);
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      // INSERT INTO chat.chat_messages
      if (normalizedSql.includes("insert into chat.chat_messages")) {
        const [id, sessionId, role, content] = params;
        const now = new Date().toISOString();
        const row = {
          id,
          session_id: sessionId,
          role,
          content,
          created_at: now,
        };
        chatMessages.push(row);
        return { rows: [row], rowCount: 1 };
      }

      // SELECT FROM chat.chat_messages
      if (normalizedSql.includes("from chat.chat_messages")) {
        const sessionId = params[0];
        let matched = chatMessages.filter((m) => m.session_id === sessionId);

        // Check if cursor pagination "before" is used
        if (params.length === 4) {
          const [, beforeCreatedAt, beforeId, limit] = params;
          const beforeTime = new Date(beforeCreatedAt).getTime();
          matched = matched.filter((m) => {
            const mTime = new Date(m.created_at).getTime();
            if (mTime < beforeTime) return true;
            if (mTime === beforeTime && m.id < beforeId) return true;
            return false;
          });
          matched.sort((a, b) => {
            const diff = new Date(b.created_at) - new Date(a.created_at);
            if (diff !== 0) return diff;
            return b.id.localeCompare(a.id);
          });
          if (limit) matched = matched.slice(0, limit);
        } else {
          const limit = params[1];
          matched.sort((a, b) => {
            const diff = new Date(b.created_at) - new Date(a.created_at);
            if (diff !== 0) return diff;
            return b.id.localeCompare(a.id);
          });
          if (limit) matched = matched.slice(0, limit);
        }

        return { rows: matched, rowCount: matched.length };
      }

      // SELECT state FROM chat.bridge_runs
      if (normalizedSql.includes("from chat.bridge_runs")) {
        const [id, userId] = params;
        const run = bridgeRuns.find((r) => r.id === id && r.user_id === userId);
        return { rows: run ? [{ state: run.state }] : [], rowCount: run ? 1 : 0 };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

// Helpers for test setup
const TEST_USER = {
  id: "u-11111111-1111-1111-1111-111111111111",
  email: "user1@example.com",
  full_name: "Test User 1",
  tenant_id: "tenant-ens",
  role: "member",
};

const OTHER_USER = {
  id: "u-22222222-2222-2222-2222-222222222222",
  email: "user2@example.com",
  full_name: "Test User 2",
  tenant_id: "tenant-ens",
  role: "member",
};

const TEST_TOKEN = "test-opaque-session-token-123456";
const TEST_TOKEN_HASH = createHash("sha256").update(TEST_TOKEN).digest("hex");

function createTestEnv() {
  const db = createMockChatDb({
    principals: [TEST_USER, OTHER_USER],
    memberships: [
      { principal_id: TEST_USER.id, tenant_id: TEST_USER.tenant_id, role: TEST_USER.role, active: true },
      { principal_id: OTHER_USER.id, tenant_id: OTHER_USER.tenant_id, role: OTHER_USER.role, active: true },
    ],
    sessions: [
      {
        id: "sess-1",
        user_id: TEST_USER.id,
        session_token_hash: TEST_TOKEN_HASH,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
    ],
  });

  const config = {
    cookieSecret: "super-secret-cookie-value-for-testing",
    cookieName: "ens_session",
    chatBridgeUrl: "http://localhost:8080",
    corsOrigin: true,
  };

  return { db, config };
}

// ==========================================
// 1. Unit Tests for Chat Service
// ==========================================
test("Chat Service - Session Operations", async (t) => {
  await t.test("createChatSession creates a session with defaults", async () => {
    const { db } = createTestEnv();
    const session = await createChatSession(db, TEST_USER);

    assert.ok(session.id, "session should have an id");
    assert.strictEqual(session.user_id, TEST_USER.id);
    assert.strictEqual(session.title, "Nova Conversa");
    assert.strictEqual(session.session_kind, "normal");
    assert.strictEqual(session.user_message_count, 0);
  });

  await t.test("createChatSession creates a session with custom id, title and kind", async () => {
    const { db } = createTestEnv();
    const customId = randomUUID();
    const session = await createChatSession(db, TEST_USER, {
      id: customId,
      title: "Custom Title",
      session_kind: "picture",
    });

    assert.strictEqual(session.id, customId);
    assert.strictEqual(session.title, "Custom Title");
    assert.strictEqual(session.session_kind, "picture");
  });

  await t.test("listChatSessions filters by user and session_kind", async () => {
    const { db } = createTestEnv();
    await createChatSession(db, TEST_USER, { title: "Normal 1", session_kind: "normal" });
    await createChatSession(db, TEST_USER, { title: "Normal 2", session_kind: "normal" });
    await createChatSession(db, TEST_USER, { title: "Picture 1", session_kind: "picture" });
    await createChatSession(db, OTHER_USER, { title: "Other User Normal", session_kind: "normal" });

    const normalSessions = await listChatSessions(db, TEST_USER, { session_kind: "normal" });
    assert.strictEqual(normalSessions.length, 2);
    assert.ok(normalSessions.every((s) => s.user_id === TEST_USER.id && s.session_kind === "normal"));

    const pictureSessions = await listChatSessions(db, TEST_USER, { session_kind: "picture" });
    assert.strictEqual(pictureSessions.length, 1);
    assert.strictEqual(pictureSessions[0].title, "Picture 1");

    const allSessions = await listChatSessions(db, TEST_USER, { session_kind: null });
    assert.strictEqual(allSessions.length, 3);
  });

  await t.test("getChatSession returns session for owner and null for non-owner or nonexistent", async () => {
    const { db } = createTestEnv();
    const created = await createChatSession(db, TEST_USER, { title: "Owner Test" });

    const fetched = await getChatSession(db, TEST_USER, created.id);
    assert.ok(fetched);
    assert.strictEqual(fetched.id, created.id);

    const otherUserFetched = await getChatSession(db, OTHER_USER, created.id);
    assert.strictEqual(otherUserFetched, null);

    const notFound = await getChatSession(db, TEST_USER, "non-existent-id");
    assert.strictEqual(notFound, null);
  });

  await t.test("updateChatSession updates title for owner and returns null for non-owner", async () => {
    const { db } = createTestEnv();
    const created = await createChatSession(db, TEST_USER, { title: "Original Title" });

    const updated = await updateChatSession(db, TEST_USER, created.id, { title: "Updated Title" });
    assert.ok(updated);
    assert.strictEqual(updated.title, "Updated Title");

    const failedUpdate = await updateChatSession(db, OTHER_USER, created.id, { title: "Hacked" });
    assert.strictEqual(failedUpdate, null);
  });

  await t.test("deleteChatSession deletes session for owner and returns false for non-owner", async () => {
    const { db } = createTestEnv();
    const created = await createChatSession(db, TEST_USER, { title: "To Delete" });

    const failedDelete = await deleteChatSession(db, OTHER_USER, created.id);
    assert.strictEqual(failedDelete, false);

    const deleted = await deleteChatSession(db, TEST_USER, created.id);
    assert.strictEqual(deleted, true);

    const deletedAgain = await deleteChatSession(db, TEST_USER, created.id);
    assert.strictEqual(deletedAgain, false);
  });
});

test("Chat Service - Message Operations", async (t) => {
  await t.test("createChatMessage creates message and increments user_message_count for user role", async () => {
    const { db } = createTestEnv();
    const session = await createChatSession(db, TEST_USER, { title: "Message Test" });
    assert.strictEqual(session.user_message_count, 0);

    const msg1 = await createChatMessage(db, TEST_USER, session.id, {
      role: "user",
      content: "Hello assistant!",
    });
    assert.ok(msg1.id);
    assert.strictEqual(msg1.role, "user");
    assert.strictEqual(msg1.content, "Hello assistant!");

    const updatedSession = await getChatSession(db, TEST_USER, session.id);
    assert.strictEqual(updatedSession.user_message_count, 1);

    const msg2 = await createChatMessage(db, TEST_USER, session.id, {
      role: "assistant",
      content: "Hello! How can I help you?",
    });
    assert.ok(msg2.id);
    assert.strictEqual(msg2.role, "assistant");

    const sessionAfterAssistant = await getChatSession(db, TEST_USER, session.id);
    assert.strictEqual(sessionAfterAssistant.user_message_count, 1, "assistant messages must not increment count");
  });

  await t.test("createChatMessage returns null if session does not belong to user", async () => {
    const { db } = createTestEnv();
    const session = await createChatSession(db, TEST_USER, { title: "Owner Test" });

    const msg = await createChatMessage(db, OTHER_USER, session.id, {
      role: "user",
      content: "Sneaky message",
    });
    assert.strictEqual(msg, null);
  });

  await t.test("listChatMessages lists messages chronologically and supports pagination", async () => {
    const { db } = createTestEnv();
    const session = await createChatSession(db, TEST_USER, { title: "Paging Test" });

    // Insert 5 messages with distinct timestamps to ensure deterministic pagination
    const baseTime = 1700000000000;
    for (let i = 1; i <= 5; i++) {
      const role = i % 2 === 1 ? "user" : "assistant";
      const now = new Date(baseTime + i * 1000).toISOString();
      const id = `00000000-0000-0000-0000-00000000000${i}`;
      db.chatMessages.push({
        id,
        session_id: session.id,
        role,
        content: `Msg ${i}`,
        created_at: now,
      });
    }

    // Fetch page of 3
    const page1 = await listChatMessages(db, TEST_USER, session.id, { limit: 3 });
    assert.strictEqual(page1.messages.length, 3);
    assert.strictEqual(page1.hasMore, true);
    // Page 1 should be the latest 3 messages in chronological order: Msg 3, Msg 4, Msg 5
    assert.strictEqual(page1.messages[0].content, "Msg 3");
    assert.strictEqual(page1.messages[1].content, "Msg 4");
    assert.strictEqual(page1.messages[2].content, "Msg 5");

    // Fetch next page before Msg 3
    const page2 = await listChatMessages(db, TEST_USER, session.id, {
      limit: 3,
      before: { created_at: page1.messages[0].created_at, id: page1.messages[0].id },
    });
    assert.strictEqual(page2.messages.length, 2);
    assert.strictEqual(page2.hasMore, false);
    assert.strictEqual(page2.messages[0].content, "Msg 1");
    assert.strictEqual(page2.messages[1].content, "Msg 2");
  });

  await t.test("listChatMessages returns null if session does not belong to user", async () => {
    const { db } = createTestEnv();
    const session = await createChatSession(db, TEST_USER, { title: "Owner Test" });

    const res = await listChatMessages(db, OTHER_USER, session.id);
    assert.strictEqual(res, null);
  });
});

// ==========================================
// 2. Route Tests via Fastify app.inject()
// ==========================================
test("Fastify Chat Routes - Authentication Pre-handler", async (t) => {
  const { db, config } = createTestEnv();
  const app = await createApp({ db, config });

  await t.test("rejects unauthenticated requests with 401", async () => {
    const routes = [
      { method: "GET", url: "/api/chat/sessions" },
      { method: "POST", url: "/api/chat/sessions" },
      { method: "GET", url: "/api/chat/sessions/some-id" },
      { method: "PATCH", url: "/api/chat/sessions/some-id" },
      { method: "DELETE", url: "/api/chat/sessions/some-id" },
      { method: "GET", url: "/api/chat/sessions/some-id/messages" },
      { method: "POST", url: "/api/chat/sessions/some-id/messages" },
      { method: "POST", url: "/api/chat/runs" },
      { method: "GET", url: "/api/chat/runs/run-123" },
      { method: "POST", url: "/api/chat/runs/run-123/stop" },
    ];

    for (const route of routes) {
      const response = await app.inject({
        method: route.method,
        url: route.url,
      });
      assert.strictEqual(response.statusCode, 401, `${route.method} ${route.url} should return 401`);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "Unauthorized");
    }
  });

  await t.test("accepts valid session cookie", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/chat/sessions",
      cookies: { ens_session: TEST_TOKEN },
    });
    assert.strictEqual(response.statusCode, 200);
  });

  await t.test("accepts valid Bearer token header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/chat/sessions",
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.strictEqual(response.statusCode, 200);
  });
});

test("Fastify Chat Routes - Session CRUD", async (t) => {
  const { db, config } = createTestEnv();
  const app = await createApp({ db, config });
  const authHeaders = { authorization: `Bearer ${TEST_TOKEN}` };

  let createdSessionId;

  await t.test("POST /api/chat/sessions creates a session with 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/sessions",
      headers: authHeaders,
      payload: { title: "Minha Conversa Nova", session_kind: "normal" },
    });

    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.session);
    assert.strictEqual(body.session.title, "Minha Conversa Nova");
    assert.strictEqual(body.session.session_kind, "normal");
    assert.strictEqual(body.session.user_id, TEST_USER.id);
    createdSessionId = body.session.id;
  });

  await t.test("GET /api/chat/sessions lists user sessions", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/sessions",
      headers: authHeaders,
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.sessions));
    assert.strictEqual(body.sessions.length, 1);
    assert.strictEqual(body.sessions[0].id, createdSessionId);
  });

  await t.test("GET /api/chat/sessions/:id returns session or 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/chat/sessions/${createdSessionId}`,
      headers: authHeaders,
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.session.id, createdSessionId);

    const notFound = await app.inject({
      method: "GET",
      url: "/api/chat/sessions/unknown-id",
      headers: authHeaders,
    });
    assert.strictEqual(notFound.statusCode, 404);
  });

  await t.test("PATCH /api/chat/sessions/:id updates title or returns 404", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/chat/sessions/${createdSessionId}`,
      headers: authHeaders,
      payload: { title: "Titulo Renomeado" },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.session.title, "Titulo Renomeado");

    const notFound = await app.inject({
      method: "PATCH",
      url: "/api/chat/sessions/unknown-id",
      headers: authHeaders,
      payload: { title: "Foo" },
    });
    assert.strictEqual(notFound.statusCode, 404);
  });

  await t.test("DELETE /api/chat/sessions/:id deletes session or returns 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/chat/sessions/${createdSessionId}`,
      headers: authHeaders,
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepStrictEqual(body, { ok: true });

    const notFound = await app.inject({
      method: "DELETE",
      url: `/api/chat/sessions/${createdSessionId}`,
      headers: authHeaders,
    });
    assert.strictEqual(notFound.statusCode, 404);
  });
});

test("Fastify Chat Routes - Message Endpoints", async (t) => {
  const { db, config } = createTestEnv();
  const app = await createApp({ db, config });
  const authHeaders = { authorization: `Bearer ${TEST_TOKEN}` };

  const session = await createChatSession(db, TEST_USER, { title: "Message Route Test" });

  await t.test("POST /api/chat/sessions/:id/messages validates input", async () => {
    // Missing role
    const res1 = await app.inject({
      method: "POST",
      url: `/api/chat/sessions/${session.id}/messages`,
      headers: authHeaders,
      payload: { content: "hello" },
    });
    assert.strictEqual(res1.statusCode, 400);

    // Invalid role
    const res2 = await app.inject({
      method: "POST",
      url: `/api/chat/sessions/${session.id}/messages`,
      headers: authHeaders,
      payload: { role: "system", content: "hello" },
    });
    assert.strictEqual(res2.statusCode, 400);

    // Missing content
    const res3 = await app.inject({
      method: "POST",
      url: `/api/chat/sessions/${session.id}/messages`,
      headers: authHeaders,
      payload: { role: "user" },
    });
    assert.strictEqual(res3.statusCode, 400);
  });

  await t.test("POST /api/chat/sessions/:id/messages creates message with 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/chat/sessions/${session.id}/messages`,
      headers: authHeaders,
      payload: { role: "user", content: "Como emitir apolice?" },
    });
    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.message);
    assert.strictEqual(body.message.content, "Como emitir apolice?");
    assert.strictEqual(body.message.role, "user");
  });

  await t.test("POST /api/chat/sessions/:id/messages returns 404 for unknown session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/sessions/unknown-session/messages",
      headers: authHeaders,
      payload: { role: "user", content: "hello" },
    });
    assert.strictEqual(res.statusCode, 404);
  });

  await t.test("GET /api/chat/sessions/:id/messages returns messages and pagination", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/chat/sessions/${session.id}/messages`,
      headers: authHeaders,
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.messages));
    assert.strictEqual(body.messages.length, 1);
    assert.strictEqual(body.hasMore, false);
  });

  await t.test("GET /api/chat/sessions/:id/messages returns 404 for unknown session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/sessions/unknown-session/messages",
      headers: authHeaders,
    });
    assert.strictEqual(res.statusCode, 404);
  });
});

test("Fastify Chat Routes - Chat Bridge Proxy Endpoints", async (t) => {
  const { db, config } = createTestEnv();
  const app = await createApp({ db, config });
  const authHeaders = { authorization: `Bearer ${TEST_TOKEN}` };

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("POST /api/chat/runs forwards to chat-bridge with identity headers", async () => {
    let capturedUrl;
    let capturedMethod;
    let capturedHeaders;
    let capturedBody;

    globalThis.fetch = async (url, options) => {
      capturedUrl = String(url);
      capturedMethod = options.method;
      capturedHeaders = options.headers;
      capturedBody = JSON.parse(options.body);

      return new Response(JSON.stringify({ run: { id: "run-999", status: "queued" } }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/chat/runs",
      headers: authHeaders,
      payload: { session_id: "sess-123", message: "Quero uma cotacao" },
    });

    assert.strictEqual(res.statusCode, 202);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.run.id, "run-999");
    assert.strictEqual(capturedUrl, "http://localhost:8080/api/chat/runs");
    assert.strictEqual(capturedMethod, "POST");
    assert.strictEqual(capturedHeaders["x-user-id"], TEST_USER.id);
    assert.strictEqual(capturedHeaders["x-tenant-id"], TEST_USER.tenant_id);
    assert.strictEqual(capturedBody.session_id, "sess-123");
  });

  await t.test("GET /api/chat/runs/:id forwards to chat-bridge", async () => {
    let capturedUrl;
    let capturedHeaders;

    globalThis.fetch = async (url, options) => {
      capturedUrl = String(url);
      capturedHeaders = options.headers;

      return new Response(JSON.stringify({ run: { id: "run-999", status: "completed" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const res = await app.inject({
      method: "GET",
      url: "/api/chat/runs/run-999",
      headers: authHeaders,
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.run.status, "completed");
    assert.strictEqual(capturedUrl, "http://localhost:8080/api/chat/runs/run-999");
    assert.strictEqual(capturedHeaders["x-user-id"], TEST_USER.id);
  });

  await t.test("POST /api/chat/runs/:id/stop forwards to chat-bridge stop endpoint", async () => {
    let capturedUrl;
    let capturedMethod;
    let capturedHeaders;

    globalThis.fetch = async (url, options) => {
      capturedUrl = String(url);
      capturedMethod = options.method;
      capturedHeaders = options.headers;

      return new Response(JSON.stringify({ run: { id: "run-999", status: "cancelled" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/chat/runs/run-999/stop",
      headers: authHeaders,
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.run.status, "cancelled");
    assert.strictEqual(capturedUrl, "http://localhost:8080/api/chat/runs/run-999/stop");
    assert.strictEqual(capturedMethod, "POST");
    assert.strictEqual(capturedHeaders["x-user-id"], TEST_USER.id);
  });

  await t.test("proxy returns 502 when chat-bridge is unreachable", async () => {
    globalThis.fetch = async () => {
      throw new Error("Connection refused");
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/chat/runs",
      headers: authHeaders,
      payload: { message: "test" },
    });

    assert.strictEqual(res.statusCode, 502);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.error, "Chat Bridge unavailable");
  });

  await t.test("GET /api/chat/runs/:id falls back to DB if chat-bridge is unreachable", async () => {
    db.bridgeRuns.push({
      id: "run-fallback",
      user_id: TEST_USER.id,
      state: { id: "run-fallback", status: "interrupted", text: "Saved in DB" },
    });

    globalThis.fetch = async () => {
      throw new Error("Connection refused");
    };

    const res = await app.inject({
      method: "GET",
      url: "/api/chat/runs/run-fallback",
      headers: authHeaders,
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.run.id, "run-fallback");
    assert.strictEqual(body.run.status, "interrupted");
  });
});

