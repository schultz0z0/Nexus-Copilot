import { randomBytes, createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * Hashes a plain text password using bcrypt with salt rounds = 10.
 *
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
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

  const queryText = `SELECT * FROM iam.resolve_session($1)`;

  const result = await db.query(queryText, [tokenHash]);
  if (!result.rows || result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  let avatarUrl = null;
  try {
    const pResult = await db.query(`SELECT avatar_url FROM iam.principals WHERE id = $1`, [row.user_id]);
    avatarUrl = pResult.rows?.[0]?.avatar_url ?? null;
  } catch {
    // fallback if table/column does not exist in mock
  }

  return {
    id: row.user_id,
    email: row.email,
    full_name: row.full_name,
    avatar_url: avatarUrl,
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

/**
 * Changes a user's password after verifying their current password.
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} currentPassword
 * @param {string} newPassword
 * @returns {Promise<{ ok: boolean }>}
 */
export async function changeUserPassword(db, userId, currentPassword, newPassword) {
  if (!currentPassword || typeof currentPassword !== "string") {
    throw new Error("Current password is required");
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters long");
  }

  const credRes = await db.query(
    "SELECT password_hash FROM iam.user_credentials WHERE user_id = $1",
    [userId]
  );
  if (!credRes.rows || credRes.rows.length === 0) {
    throw new Error("User credentials not found");
  }

  const isCurrentValid = await verifyPassword(currentPassword, credRes.rows[0].password_hash);
  if (!isCurrentValid) {
    throw new Error("Invalid current password");
  }

  const newHash = await hashPassword(newPassword);
  await db.query(
    `UPDATE iam.user_credentials
     SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL, updated_at = transaction_timestamp()
     WHERE user_id = $2`,
    [newHash, userId]
  );

  return { ok: true };
}

/**
 * Lists all users belonging to a tenant, with their membership and integration info.
 *
 * @param {object} db
 * @param {string|null} tenantId
 * @returns {Promise<Array<object>>}
 */
export async function listAdminUsers(db, tenantId) {
  const queryText = `
    SELECT 
      p.id, 
      p.email, 
      p.full_name, 
      p.avatar_url,
      p.created_at, 
      p.updated_at,
      m.role,
      m.active,
      uci.hermes_enabled,
      uci.hermes_base_url
    FROM iam.principals p
    JOIN iam.memberships m ON m.principal_id = p.id
    LEFT JOIN iam.user_chat_integrations uci ON uci.user_id = p.id
    WHERE ($1::uuid IS NULL OR m.tenant_id = $1::uuid)
    ORDER BY p.full_name ASC NULLS LAST, p.created_at ASC
  `;

  const result = await db.query(queryText, [tenantId ?? null]);
  return (result.rows || []).map((row) => ({
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    avatar_url: row.avatar_url ?? null,
    role: row.role,
    active: row.active !== false,
    hermes_enabled: Boolean(row.hermes_enabled),
    hermes_base_url: row.hermes_base_url ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

/**
 * Creates a new user in the given tenant with principal, credentials, and membership.
 *
 * @param {object} db
 * @param {string|null} tenantId
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @param {string} [params.fullName]
 * @param {string} [params.role='member']
 * @returns {Promise<object>}
 */
export async function createAdminUser(db, tenantId, { email, password, fullName, role = "member" }) {
  if (!email || typeof email !== "string" || !email.includes("@")) {
    throw new Error("Valid email is required");
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }
  if (!["member", "manager", "admin"].includes(role)) {
    throw new Error("Invalid role. Allowed roles: member, manager, admin");
  }

  const execute = async (client) => {
    const normalizedEmail = email.trim().toLowerCase();
    const cleanName = fullName ? fullName.trim() : null;
    const userId = randomUUID();

    const pRes = await client.query(
      `INSERT INTO iam.principals (id, email, full_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, full_name, avatar_url, created_at, updated_at`,
      [userId, normalizedEmail, cleanName]
    );
    const principal = pRes.rows[0];

    const passwordHash = await hashPassword(password);
    await client.query(
      `INSERT INTO iam.user_credentials (user_id, password_hash)
       VALUES ($1, $2)`,
      [principal.id, passwordHash]
    );

    if (tenantId) {
      await client.query(
        `INSERT INTO iam.memberships (tenant_id, principal_id, role, active)
         VALUES ($1, $2, $3, true)`,
        [tenantId, principal.id, role]
      );
    }

    return {
      id: principal.id,
      email: principal.email,
      full_name: principal.full_name,
      avatar_url: null,
      role,
      active: true,
      hermes_enabled: false,
      hermes_base_url: null,
      created_at: principal.created_at,
      updated_at: principal.updated_at,
    };
  };

  if (typeof db.withTransaction === "function") {
    return await db.withTransaction(execute);
  }
  return await execute(db);
}

/**
 * Updates an admin user's principal details, role, and Hermes integration.
 *
 * @param {object} db
 * @param {string|null} tenantId
 * @param {string} userId
 * @param {object} updates
 * @returns {Promise<object|null>}
 */
export async function updateAdminUser(db, tenantId, userId, updates = {}) {
  const execute = async (client) => {
    const fullName = updates.fullName !== undefined ? updates.fullName : updates.full_name;
    const avatarUrl = updates.avatarUrl !== undefined ? updates.avatarUrl : updates.avatar_url;
    const role = updates.role;
    const active = updates.active;
    const hermesEnabled = updates.hermesEnabled !== undefined ? updates.hermesEnabled : updates.hermes_enabled;
    const hermesBaseUrl = updates.hermesBaseUrl !== undefined ? updates.hermesBaseUrl : updates.hermes_base_url;

    if (fullName !== undefined || avatarUrl !== undefined) {
      await client.query(
        `UPDATE iam.principals
         SET full_name = COALESCE($1, full_name),
             avatar_url = COALESCE($2, avatar_url),
             updated_at = transaction_timestamp()
         WHERE id = $3`,
        [fullName !== undefined ? fullName : null, avatarUrl !== undefined ? avatarUrl : null, userId]
      );
    }

    if ((role !== undefined || active !== undefined) && tenantId) {
      await client.query(
        `UPDATE iam.memberships
         SET role = COALESCE($1, role),
             active = COALESCE($2, active),
             updated_at = transaction_timestamp()
         WHERE principal_id = $3 AND tenant_id = $4`,
        [role !== undefined ? role : null, active !== undefined ? active : null, userId, tenantId]
      );
    }

    if (hermesEnabled !== undefined || hermesBaseUrl !== undefined) {
      await client.query(
        `INSERT INTO iam.user_chat_integrations (user_id, hermes_enabled, hermes_base_url, updated_at)
         VALUES ($1, $2, $3, transaction_timestamp())
         ON CONFLICT (user_id) DO UPDATE
         SET hermes_enabled = COALESCE(EXCLUDED.hermes_enabled, iam.user_chat_integrations.hermes_enabled),
             hermes_base_url = COALESCE(EXCLUDED.hermes_base_url, iam.user_chat_integrations.hermes_base_url),
             updated_at = transaction_timestamp()`,
        [
          userId,
          hermesEnabled !== undefined ? Boolean(hermesEnabled) : false,
          hermesBaseUrl !== undefined ? hermesBaseUrl : null,
        ]
      );
    }

    const res = await client.query(
      `SELECT 
         p.id, p.email, p.full_name, p.avatar_url, p.created_at, p.updated_at,
         m.role, m.active,
         uci.hermes_enabled, uci.hermes_base_url
       FROM iam.principals p
       LEFT JOIN iam.memberships m ON m.principal_id = p.id AND ($1::uuid IS NULL OR m.tenant_id = $1::uuid)
       LEFT JOIN iam.user_chat_integrations uci ON uci.user_id = p.id
       WHERE p.id = $2`,
      [tenantId ?? null, userId]
    );

    if (!res.rows || res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      avatar_url: row.avatar_url ?? null,
      role: row.role,
      active: row.active !== false,
      hermes_enabled: Boolean(row.hermes_enabled),
      hermes_base_url: row.hermes_base_url ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  };

  if (typeof db.withTransaction === "function") {
    return await db.withTransaction(execute);
  }
  return await execute(db);
}

/**
 * Resets a user's password without needing current password (admin only).
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} newPassword
 * @returns {Promise<{ ok: boolean }>}
 */
export async function resetAdminUserPassword(db, userId, newPassword) {
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters long");
  }

  const newHash = await hashPassword(newPassword);
  await db.query(
    `UPDATE iam.user_credentials
     SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL, updated_at = transaction_timestamp()
     WHERE user_id = $2`,
    [newHash, userId]
  );

  // Invalidate any active sessions for the user so they must log in again
  await db.query("DELETE FROM iam.user_sessions WHERE user_id = $1", [userId]);

  return { ok: true };
}

/**
 * Deletes an admin user (principal cascade deletes memberships, credentials, sessions).
 *
 * @param {object} db
 * @param {string|null} tenantId
 * @param {string} userId
 * @returns {Promise<{ ok: boolean }>}
 */
export async function deleteAdminUser(db, tenantId, userId) {
  await db.query("DELETE FROM iam.principals WHERE id = $1", [userId]);
  return { ok: true };
}

/**
 * Updates a user's avatar URL in iam.principals.
 *
 * @param {object} db
 * @param {string} userId
 * @param {string|null} avatarUrl
 * @returns {Promise<{ avatar_url: string|null }>}
 */
export async function updateUserAvatar(db, userId, avatarUrl) {
  await db.query(
    "UPDATE iam.principals SET avatar_url = $1, updated_at = transaction_timestamp() WHERE id = $2",
    [avatarUrl ?? null, userId]
  );
  return { avatar_url: avatarUrl ?? null };
}
