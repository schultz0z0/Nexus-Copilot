import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConnectionConfig, runMigrations } from '../src/migrate.mjs';

class RecordingClient {
  constructor({ applied = [], failOn = null } = {}) {
    this.applied = applied;
    this.failOn = failOn;
    this.calls = [];
  }

  async query(text, values = []) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    this.calls.push({ text: normalized, values });
    if (this.failOn && normalized.includes(this.failOn)) {
      throw new Error('injected migration failure');
    }
    if (normalized.includes('SELECT version, checksum FROM infra.schema_migrations')) {
      return { rows: this.applied };
    }
    return { rows: [] };
  }
}

const firstMigration = {
  version: '0001',
  name: 'foundation',
  filename: '0001_foundation.sql',
  checksum: 'a'.repeat(64),
  sql: 'select 1;',
};

test('applies a pending migration transactionally as nexus_owner', async () => {
  const client = new RecordingClient();

  const result = await runMigrations({ client, migrations: [firstMigration] });

  assert.deepEqual(result, { applied: ['0001'], skipped: [] });
  const statements = client.calls.map(({ text }) => text);
  assert.match(statements[0], /pg_advisory_lock/);
  assert.ok(statements.includes('BEGIN'));
  assert.ok(statements.includes('SET LOCAL ROLE nexus_owner'));
  assert.ok(statements.includes('select 1;'));
  assert.ok(statements.includes('COMMIT'));
  assert.match(statements.at(-1), /pg_advisory_unlock/);

  const ledgerInsert = client.calls.find(({ text }) =>
    text.startsWith('INSERT INTO infra.schema_migrations'),
  );
  assert.deepEqual(ledgerInsert.values, ['0001', 'foundation', 'a'.repeat(64)]);
});

test('skips an applied migration only when its checksum is unchanged', async () => {
  const client = new RecordingClient({
    applied: [{ version: '0001', checksum: firstMigration.checksum }],
  });

  const result = await runMigrations({ client, migrations: [firstMigration] });

  assert.deepEqual(result, { applied: [], skipped: ['0001'] });
  assert.equal(client.calls.some(({ text }) => text === firstMigration.sql), false);
  assert.match(client.calls.at(-1).text, /pg_advisory_unlock/);
});

test('rejects an altered applied migration and releases the advisory lock', async () => {
  const client = new RecordingClient({
    applied: [{ version: '0001', checksum: 'b'.repeat(64) }],
  });

  await assert.rejects(
    runMigrations({ client, migrations: [firstMigration] }),
    /checksum mismatch.*0001/i,
  );

  assert.equal(client.calls.some(({ text }) => text === firstMigration.sql), false);
  assert.match(client.calls.at(-1).text, /pg_advisory_unlock/);
});

test('rolls back a failed migration and still releases the advisory lock', async () => {
  const client = new RecordingClient({ failOn: 'select broken;' });
  const brokenMigration = { ...firstMigration, sql: 'select broken;' };

  await assert.rejects(
    runMigrations({ client, migrations: [brokenMigration] }),
    /injected migration failure/,
  );

  const statements = client.calls.map(({ text }) => text);
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), true, 'ledger initialization commits before migration');
  assert.match(statements.at(-1), /pg_advisory_unlock/);
});

test('builds a libpq-compatible connection without exposing secret metadata', () => {
  assert.deepEqual(
    buildConnectionConfig(
      {
        PGHOST: 'postgres',
        PGPORT: '5432',
        PGDATABASE: 'nexus',
        PGUSER: 'nexus_migrator',
        PGPASSWORD_FILE: '/run/secrets/postgres_migrator_password',
      },
      () => 'secret-from-file\n',
    ),
    {
      host: 'postgres',
      port: 5432,
      database: 'nexus',
      user: 'nexus_migrator',
      password: 'secret-from-file',
      application_name: 'ens-schema-migrator',
    },
  );

  assert.deepEqual(buildConnectionConfig({ DATABASE_URL: 'postgresql://opaque' }), {
    connectionString: 'postgresql://opaque',
    application_name: 'ens-schema-migrator',
  });
});

