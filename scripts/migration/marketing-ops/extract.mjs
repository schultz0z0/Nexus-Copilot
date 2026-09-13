import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { TABLE_ORDER, assertTable, manifestFingerprint, rowsJsonl, sha256 } from './core.mjs';

export async function extract({ pool, outputDirectory, tables = TABLE_ORDER, now = new Date() }) {
  await mkdir(outputDirectory, { recursive: true });
  const client = await pool.connect();
  const entries = [];
  try {
    await client.query('begin isolation level repeatable read read only');
    for (const name of tables) {
      assertTable(name);
      const result = await client.query(`select to_jsonb(source) as row from marketing_ops."${name}" as source order by to_jsonb(source)::text`);
      const content = rowsJsonl(result.rows.map(({ row }) => row));
      const file = `${name}.jsonl`;
      await writeFile(join(outputDirectory, file), content, { flag: 'wx' });
      entries.push({ name, file, row_count: result.rows.length, sha256: sha256(content) });
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally { client.release(); }
  const manifest = {
    format_version: 1, run_id: randomUUID(), created_at: now.toISOString(), tables: entries,
    fingerprint: manifestFingerprint(entries)
  };
  await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}
