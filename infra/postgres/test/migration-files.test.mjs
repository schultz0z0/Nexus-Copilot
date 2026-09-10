import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { checksumSql, discoverMigrations } from '../src/migration-files.mjs';

function withMigrationDirectory(files, work) {
  const directory = mkdtempSync(join(tmpdir(), 'ens-migrations-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(directory, name), contents, 'utf8');
    }
    return work(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('discovers valid SQL migrations in numeric order with stable checksums', () => {
  withMigrationDirectory(
    {
      '0002_add_memberships.sql': 'select 2;\n',
      '0001_create_tenants.sql': 'select 1;\n',
    },
    (directory) => {
      const migrations = discoverMigrations(directory);

      assert.deepEqual(
        migrations.map(({ version, name, filename, sql }) => ({ version, name, filename, sql })),
        [
          {
            version: '0001',
            name: 'create_tenants',
            filename: '0001_create_tenants.sql',
            sql: 'select 1;\n',
          },
          {
            version: '0002',
            name: 'add_memberships',
            filename: '0002_add_memberships.sql',
            sql: 'select 2;\n',
          },
        ],
      );
      assert.equal(migrations[0].checksum, checksumSql('select 1;\n'));
    },
  );
});

test('computes a lowercase SHA-256 checksum', () => {
  assert.equal(
    checksumSql('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('rejects SQL files outside the migration naming convention', () => {
  withMigrationDirectory({ 'create_tenants.sql': 'select 1;\n' }, (directory) => {
    assert.throws(() => discoverMigrations(directory), /invalid migration filename.*create_tenants\.sql/i);
  });
});

test('rejects duplicate numeric versions before connecting to PostgreSQL', () => {
  withMigrationDirectory(
    {
      '0001_create_tenants.sql': 'select 1;\n',
      '0001_create_users.sql': 'select 2;\n',
    },
    (directory) => {
      assert.throws(() => discoverMigrations(directory), /duplicate migration version 0001/i);
    },
  );
});

