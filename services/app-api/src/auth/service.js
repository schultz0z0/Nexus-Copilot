import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * Hashes a plain text password using bcrypt with salt rounds = 10.
 *
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

/**
 * Verifies a plain text password against a bcrypt hash.
 * Supports $2a$ and $2b$ hashes.
 *
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hash) {
  if (!password || !hash || typeof password !== "string" || typeof hash !== "string") {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/**
 * Creates a new user session with a cryptographically secure opaque token.
 * Only the SHA-256 hash of the token is stored in the database.
 *
 * @param {object} db - Database handle providing query()
 * @param {object} params
 * @param {string} params.userId
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {number} [params.ttlDays=30]
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function createSession(db, { userId, ipAddress, userAgent, ttlDays = 30 }) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO iam.user_sessions (user_id, session_token_hash, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, ipAddress ?? null, userAgent ?? null, expiresAt]
  );

  return { token, expiresAt };
}

/**
 * Validates a session token and returns the principal & active tenant info.
 *
 * @param {object} db - Database handle providing query()
 * @param {string} token - Raw session token
 * @returns {Promise<{ id: string, email: string, full_name: string, tenant_id: string|null, role: string|null }|null>}
 */
export async function validateSession(db, token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  const queryText = `
    SELECT s.id AS session_id, s.user_id, s.expires_at,
           p.email, p.full_name,
           m.tenant_id, m.role
    FROM iam.user_sessions s
    JOIN iam.principals p ON s.user_id = p.id
    LEFT JOIN iam.memberships m ON m.principal_id = p.id AND m.active = true
    WHERE s.session_token_hash = $1
      AND s.expires_at > transaction_timestamp()
  `;

  const result = await db.query(queryText, [tokenHash]);
  if (!result.rows || result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.user_id,
    email: row.email,
    full_name: row.full_name,
    tenant_id: row.tenant_id ?? null,
    role: row.role ?? null,
  };
}

/**
 * Revokes an existing session by deleting its hash from the database.
 *
 * @param {object} db - Database handle providing query()
 * @param {string} token - Raw session token
 * @returns {Promise<void>}
 */
export async function revokeSession(db, token) {
  if (!token || typeof token !== "string") {
    return;
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.query("DELETE FROM iam.user_sessions WHERE session_token_hash = $1", [tokenHash]);
}
