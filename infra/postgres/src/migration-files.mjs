import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_FILENAME = /^(\d{4})_([a-z][a-z0-9_]*)\.sql$/;

export function checksumSql(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function discoverMigrations(directory) {
  const migrations = [];
  const versions = new Set();

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;

    const match = MIGRATION_FILENAME.exec(entry.name);
    if (!match) throw new Error(`Invalid migration filename: ${entry.name}`);

    const [, version, name] = match;
    if (versions.has(version)) throw new Error(`Duplicate migration version ${version}`);
    versions.add(version);

    const path = join(directory, entry.name);
    const sql = readFileSync(path, 'utf8');
    migrations.push({
      version,
      name,
      filename: entry.name,
      path,
      sql,
      checksum: checksumSql(sql),
    });
  }

  return migrations.sort((left, right) => left.version.localeCompare(right.version));
}
