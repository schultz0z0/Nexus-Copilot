import { randomUUID } from "node:crypto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isValidUuid = (id) => typeof id === "string" && UUID_REGEX.test(id.trim());

/**
 * Extracts string user ID from user object or string.
 *
 * @param {object|string} user
 * @returns {string}
 */
const getUserId = (user) => (typeof user === "object" && user !== null ? user.id : user);

/**
 * Creates a new chat session for a user.
 *
 * @param {object} db - Database connection handle
 * @param {object|string} user - User object or user ID
 * @param {object} [params={}]
 * @param {string} [params.id]
 * @param {string} [params.title='Nova Conversa']
 * @param {string} [params.session_kind='normal']
 * @returns {Promise<object>} Created session
 */
export async function createChatSession(
  db,
  user,
  { id, title = "Nova Conversa", session_kind = "normal" } = {}
) {
  const userId = getUserId(user);
  const sessionId = id && isValidUuid(id) ? id : randomUUID();
  const queryText = `INSERT INTO chat.chat_sessions (id, user_id, title, session_kind)
    VALUES ($1, $2, $3, $4)
    RETURNING *`;

  const result = await db.query(queryText, [sessionId, userId, title, session_kind]);
  return result.rows?.[0] || null;
}

/**
 * Lists chat sessions for a user, filtered by session_kind and ordered by updated_at DESC.
 *
 * @param {object} db - Database connection handle
 * @param {object|string} user - User object or user ID
 * @param {object} [options={}]
 * @param {string|null} [options.session_kind='normal']
 * @param {number} [options.limit=50]
 * @returns {Promise<Array<object>>}
 */
export async function listChatSessions(
  db,
  user,
  { session_kind = "normal", limit = 50 } = {}
) {
  const userId = getUserId(user);
  const queryText = `SELECT * FROM chat.chat_sessions
    WHERE user_id = $1 AND ($2::text IS NULL OR session_kind = $2)
    ORDER BY updated_at DESC
    LIMIT $3`;

  const result = await db.query(queryText, [userId, session_kind ?? null, limit]);
  return result.rows || [];
}

/**
 * Retrieves a chat session by id for a specific user.
 *
 * @param {object} db - Database connection handle
 * @param {object|string} user - User object or user ID
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function getChatSession(db, user, sessionId) {
  if (!isValidUuid(sessionId)) {
    return null;
  }
  const userId = getUserId(user);
  const queryText = `SELECT * FROM chat.chat_sessions WHERE id = $1 AND user_id = $2`;

  const result = await db.query(queryText, [sessionId, userId]);
  return result.rows?.[0] || null;
}

/**
 * Updates a chat session title for a specific user.
 *
 * @param {object} db - Database connection handle
 * @param {object|string} user - User object or user ID
 * @param {string} sessionId
 * @param {object} params
 * @param {string} params.title
 * @returns {Promise<object|null>} Updated session or null
 */
export async function updateChatSession(db, user, sessionId, { title }) {
  if (!isValidUuid(sessionId)) {
    return null;
  }
  const userId = getUserId(user);
  const queryText = `UPDATE chat.chat_sessions
    SET title = $3, updated_at = transaction_timestamp()
    WHERE id = $1 AND user_id = $2
    RETURNING *`;

  const result = await db.query(queryText, [sessionId, userId, title]);
  return result.rows?.[0] || null;
}

/**
 * Deletes a chat session for a specific user.
 *
 * @param {object} db - Database connection handle
 * @param {object|string} user - User object or user ID
 * @param {string} sessionId
 * @returns {Promise<boolean>} True if deleted, false otherwise
 */
export async function deleteChatSession(db, user, sessionId) {
  if (!isValidUuid(sessionId)) {
    return false;
  }
  const userId = getUserId(user);
  const queryText = `DELETE FROM chat.chat_sessions WHERE id = $1 AND user_id = $2`;

  const result = await db.query(queryText, [sessionId, userId]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Lists messages for a chat session with cursor pagination.
 *
 * @param {object} db - Database connection handle
 * @param {object|string} user - User object or user ID
 * @param {string} sessionId
 * @param {object} [options={}]
 * @param {number} [options.limit=50]
 * @param {{ created_at: string, id: string }} [options.before]
 * @returns {Promise<{ messages: Array<object>, hasMore: boolean }|null>}
 */
export async function listChatMessages(db, user, sessionId, { limit = 50, before } = {}) {
  if (!isValidUuid(sessionId)) {
    return null;
  }
  const session = await getChatSession(db, user, sessionId);
  if (!session) {
    return null;
  }

  const parsedLimit = Math.min(Math.max(1, Number.parseInt(limit, 10) || 50), 100);
  const fetchLimit = parsedLimit + 1;

  let queryText;
  let params;

  if (before?.created_at && before?.id) {
    queryText = `SELECT * FROM chat.chat_messages
      WHERE session_id = $1 AND (created_at < $2 OR (created_at = $2 AND id < $3))
      ORDER BY created_at DESC, id DESC
      LIMIT $4`;
    params = [sessionId, before.created_at, before.id, fetchLimit];
  } else {
    queryText = `SELECT * FROM chat.chat_messages
      WHERE session_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`;
    params = [sessionId, fetchLimit];
  }

  const result = await db.query(queryText, params);
  const rows = result.rows || [];
  const hasMore = rows.length > parsedLimit;
  const sliced = hasMore ? rows.slice(0, parsedLimit) : rows;

  return {
    messages: [...sliced].reverse(),
    hasMore,
  };
}

/**
 * Creates a message within a chat session owned by the user.
 * Increments user_message_count when role is 'user'.
 *
 * @param {object} db - Database connection handle
 * @param {object|string} user - User object or user ID
 * @param {string} sessionId
 * @param {object} params
 * @param {string} [params.id]
 * @param {'user'|'assistant'} params.role
 * @param {string} params.content
 * @returns {Promise<object|null>} Created message or null if session not found
 */
export async function createChatMessage(db, user, sessionId, { id, role, content }) {
  if (!isValidUuid(sessionId)) {
    return null;
  }
  const session = await getChatSession(db, user, sessionId);
  if (!session) {
    return null;
  }

  const messageId = id && isValidUuid(id) ? id : randomUUID();
  const insertSql = `INSERT INTO chat.chat_messages (id, session_id, role, content)
    VALUES ($1, $2, $3, $4)
    RETURNING *`;
  const result = await db.query(insertSql, [messageId, sessionId, role, content]);

  const updateSql = `UPDATE chat.chat_sessions
    SET updated_at = transaction_timestamp(),
        user_message_count = user_message_count + (CASE WHEN $2 = 'user' THEN 1 ELSE 0 END)
    WHERE id = $1`;
  await db.query(updateSql, [sessionId, role]);

  return result.rows?.[0] || null;
}
