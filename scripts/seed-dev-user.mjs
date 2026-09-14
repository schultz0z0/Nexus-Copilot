import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import pg from "../services/app-api/node_modules/pg/lib/index.js";
import bcrypt from "../services/app-api/node_modules/bcryptjs/index.js";

const rootDir = resolve(import.meta.dirname, "..");
const bootstrapSecretPath = join(rootDir, "infra", "postgres", "secrets", "postgres_bootstrap_password");
const bootstrapPassword = readFileSync(bootstrapSecretPath, "utf8").trim();

const client = new pg.Client({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number.parseInt(process.env.PGPORT || "55432", 10),
  database: process.env.PGDATABASE || "nexus",
  user: "nexus_bootstrap",
  password: bootstrapPassword,
});

async function seed() {
  await client.connect();
  console.log(`Connected to PostgreSQL at ${client.host}:${client.port} as nexus_bootstrap`);

  const tenantId = process.env.DEV_TENANT_ID || "a0000000-0000-0000-0000-000000000001";
  const tenantSlug = process.env.DEV_TENANT_SLUG || "dev-tenant";
  const tenantName = process.env.DEV_TENANT_NAME || "Desenvolvimento ENS";

  const userId = process.env.DEV_USER_ID || "b0000000-0000-0000-0000-000000000001";
  const email = (process.env.DEV_USER_EMAIL || "admin@ens.local").toLowerCase();
  const rawPassword = process.env.DEV_USER_PASSWORD || "AdminDev123!";
  const fullName = process.env.DEV_USER_FULL_NAME || "Administrador Dev";
  const role = process.env.DEV_USER_ROLE || "admin";
  if (!["member", "manager", "admin"].includes(role)) {
    throw new Error("DEV_USER_ROLE must be member, manager or admin");
  }

  const passwordHash = await bcrypt.hash(rawPassword, 12);

  // 1. Ensure tenant exists
  await client.query(
    `INSERT INTO iam.tenants (id, slug, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [tenantId, tenantSlug, tenantName]
  );
  console.log(`Tenant verified: ${tenantSlug} (${tenantId})`);

  // 2. Ensure principal exists
  await client.query(
    `INSERT INTO iam.principals (id, email, full_name, external_subject)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name`,
    [userId, email, fullName, `dev:${email}`]
  );
  console.log(`Principal verified: ${email} (${userId})`);

  // 3. Ensure credentials exist
  await client.query(
    `INSERT INTO iam.user_credentials (user_id, password_hash, algorithm)
     VALUES ($1, $2, 'bcrypt')
     ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [userId, passwordHash]
  );
  console.log(`Credentials updated for user ${email}`);

  // 4. Ensure active membership with the requested canonical role
  await client.query(
    `INSERT INTO iam.memberships (tenant_id, principal_id, role, active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (tenant_id, principal_id) DO UPDATE SET role = EXCLUDED.role, active = true`,
    [tenantId, userId, role]
  );
  console.log(`Membership verified: ${userId} is ${role} of tenant ${tenantId}`);

  // 5. Test authentication function
  const authCheck = await client.query(`SELECT * FROM iam.authenticate_by_email($1)`, [email]);
  if (authCheck.rows.length > 0 && authCheck.rows[0].email === email) {
    console.log("Authentication check SUCCESSFUL via iam.authenticate_by_email!");
  } else {
    throw new Error("Authentication check failed!");
  }

  await client.end();
  console.log("\nDev seed completed successfully!");
  console.log(`Principal: ${email} (${userId})`);
  console.log("Password configured from local input (value not logged)");
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
