import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(scriptDir, "../../../.env"), quiet: true });

const testPath = process.argv[2];
const migrationFlagIndex = process.argv.indexOf("--migration");
const migrationPath = migrationFlagIndex >= 0 ? process.argv[migrationFlagIndex + 1] : null;
if (!testPath) {
  console.error("Usage: node scripts/run_sql_test.mjs <sql-test-file>");
  process.exit(2);
}

const connectionString =
  process.env.NEXUS_SUPABASE_DATABASE_URL ||
  process.env.NEXUS_DATABASE_URL;
if (!connectionString) {
  console.error("Picture SQL test database URL is not configured.");
  process.exit(2);
}

const sql = await fs.readFile(path.resolve(testPath), "utf8");
const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  if (migrationPath) {
    const migration = await fs.readFile(path.resolve(migrationPath), "utf8");
    await client.query("begin");
    await client.query(migration);
  }
  const results = await client.query(sql);
  const queryResults = Array.isArray(results) ? results : [results];
  const tapLines = queryResults.flatMap((result) =>
    (result.rows ?? []).flatMap((row) => Object.values(row).filter((value) => typeof value === "string"))
  );
  for (const line of tapLines) console.log(line);
  const failures = tapLines.filter((line) => /^not ok\b/i.test(line));
  if (failures.length > 0) {
    console.error(`SQL test failed with ${failures.length} not-ok assertion(s).`);
    process.exitCode = 1;
  }
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(`SQL test execution failed: ${error.code ?? "unknown"} ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
