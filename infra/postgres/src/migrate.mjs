import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { discoverMigrations } from './migration-files.mjs';

const MIGRATION_LOCK_ID = '6133943518902701';
const APPLICATION_NAME = 'ens-schema-migrator';

export function buildConnectionConfig(environment, readSecret = readFileSync) {
  if (environment.DATABASE_URL) {
    return {
      connectionString: environment.DATABASE_URL,
      application_name: APPLICATION_NAME,
    };
  }

  const password = environment.PGPASSWORD_FILE
    ? readSecret(environment.PGPASSWORD_FILE, 'utf8').trim()
    : environment.PGPASSWORD;

  return {
    host: environment.PGHOST,
    port: Number.parseInt(environment.PGPORT ?? '5432', 10),
    database: environment.PGDATABASE,
    user: environment.PGUSER,
    password,
    application_name: APPLICATION_NAME,
  };
}

async function initializeLedger(client) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE nexus_owner');
    await client.query('CREATE SCHEMA IF NOT EXISTS infra AUTHORIZATION nexus_owner');
    await client.query(`
      CREATE TABLE IF NOT EXISTS infra.schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT transaction_timestamp()
      )
    `);
    await client.query('REVOKE ALL ON infra.schema_migrations FROM PUBLIC');
    await client.query('GRANT USAGE ON SCHEMA infra TO nexus_migrator');
    await client.query('GRANT SELECT ON infra.schema_migrations TO nexus_migrator');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function runMigrations({ client, migrations }) {
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_ID]);
    locked = true;
    await initializeLedger(client);

    const { rows } = await client.query(
      'SELECT version, checksum FROM infra.schema_migrations ORDER BY version',
    );
    const appliedChecksums = new Map(rows.map((row) => [row.version, row.checksum]));
    const result = { applied: [], skipped: [] };

    for (const migration of migrations) {
      const appliedChecksum = appliedChecksums.get(migration.version);
      if (appliedChecksum !== undefined) {
        if (appliedChecksum !== migration.checksum) {
          throw new Error(`Checksum mismatch for applied migration ${migration.version}`);
        }
        result.skipped.push(migration.version);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE nexus_owner');
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO infra.schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
        result.applied.push(migration.version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return result;
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_ID]);
    }
  }
}

export async function main({ environment = process.env } = {}) {
  const [{ Client }] = await Promise.all([import('pg')]);
  const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const migrations = discoverMigrations(migrationsDirectory);
  const client = new Client(buildConnectionConfig(environment));

  await client.connect();
  try {
    const result = await runMigrations({ client, migrations });
    console.log(JSON.stringify({ event: 'database_migrations_complete', ...result }));
    return result;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      event: 'database_migrations_failed',
      code: error.code ?? 'MIGRATION_FAILED',
      message: error.message,
    }));
    process.exitCode = 1;
  });
}
