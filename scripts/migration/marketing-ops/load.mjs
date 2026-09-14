import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertTable, canonicalJson, quoteIdent, sha256, sourceKey } from './core.mjs';

export function decideRun(completedRuns, fingerprint, allowNewRun) {
  const same = completedRuns.find((row) => row.manifest_fingerprint === fingerprint);
  if (same) return { action: 'skip', runId: same.id };
  if (completedRuns.length && !allowNewRun) throw new Error('divergent manifest fingerprint requires --new-run');
  return { action: 'load' };
}

export function selectLoadableColumns(row, columnMetadata) {
  const allowed = new Set(columnMetadata
    .filter(({ is_generated: isGenerated }) => isGenerated === 'NEVER')
    .map(({ column_name: columnName }) => columnName));
  return Object.keys(row).filter((column) => allowed.has(column));
}

export function serializeLoadValues(row, columns, columnMetadata) {
  const dataTypes = new Map(columnMetadata.map((entry) => [entry.column_name, entry.data_type]));
  return columns.map((column) => {
    const value = row[column];
    return (dataTypes.get(column) === 'json' || dataTypes.get(column) === 'jsonb') && value !== null
      ? canonicalJson(value)
      : value;
  });
}

export async function load({ pool, inputDirectory, allowNewRun = false }) {
  const manifest = JSON.parse(await readFile(join(inputDirectory, 'manifest.json'), 'utf8'));
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('begin');
    await client.query('set local role nexus_owner');
    const completed = await client.query(`select id, manifest_fingerprint from migration_control.marketing_ops_runs where status = 'completed' order by completed_at desc`);
    const decision = decideRun(completed.rows, manifest.fingerprint, allowNewRun);
    if (decision.action === 'skip') {
      await client.query('rollback');
      return { status: 'skipped', runId: decision.runId, counts: {} };
    }
    await client.query(`insert into migration_control.marketing_ops_runs
      (id, manifest_fingerprint, status, source_manifest) values ($1, $2, 'loading', $3::jsonb)`,
      [manifest.run_id, manifest.fingerprint, canonicalJson(manifest)]);
    for (const entry of manifest.tables) {
      const table = assertTable(entry.name);
      const content = await readFile(join(inputDirectory, entry.file), 'utf8');
      if (sha256(content) !== entry.sha256) throw new Error(`transformed checksum mismatch: ${table}`);
      const rows = content.split(/\r?\n/).filter(Boolean).map(JSON.parse);
      for (const row of rows) {
        const sourceId = sourceKey(table, row);
        await client.query(`insert into migration_control.marketing_ops_staging_rows
          (run_id, table_name, source_id, payload, payload_hash) values ($1,$2,$3,$4::jsonb,$5)`,
          [manifest.run_id, table, sourceId, canonicalJson(row), sha256(canonicalJson(row))]);
        const columnsResult = await client.query(`select column_name, is_generated, data_type from information_schema.columns
          where table_schema = 'marketing_ops' and table_name = $1`, [table]);
        const columns = selectLoadableColumns(row, columnsResult.rows);
        if (!columns.length) throw new Error(`no loadable columns for ${table}`);
        const values = serializeLoadValues(row, columns, columnsResult.rows);
        await client.query(`insert into marketing_ops.${quoteIdent(table)} (${columns.map(quoteIdent).join(',')})
          values (${columns.map((_, index) => `$${index + 1}`).join(',')}) on conflict do nothing`, values);
        await client.query(`update migration_control.marketing_ops_staging_rows set loaded_at = transaction_timestamp()
          where run_id = $1 and table_name = $2 and source_id = $3`, [manifest.run_id, table, sourceId]);
      }
      counts[table] = rows.length;
    }
    await client.query(`update migration_control.marketing_ops_runs set status = 'completed',
      table_counts = $2::jsonb, completed_at = transaction_timestamp() where id = $1`,
      [manifest.run_id, canonicalJson(counts)]);
    await client.query('commit');
    return { status: 'completed', runId: manifest.run_id, counts };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
