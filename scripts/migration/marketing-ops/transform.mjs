import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { manifestFingerprint, rowsJsonl, sha256 } from './core.mjs';

const identityFields = new Set([
  'created_by', 'updated_by', 'user_id', 'assignee_user_id', 'requested_by',
  'decided_by', 'actor_user_id', 'actor_id', 'artifact_owner_id', 'unlinked_by'
]);

export function transformRow(table, row, mapping, now = new Date()) {
  const next = { ...row };
  if (next.tenant_id) {
    const mapped = mapping.tenants[next.tenant_id];
    if (!mapped) return { quarantine: 'tenant_mapping_missing', row };
    next.tenant_id = mapped;
  }
  for (const field of identityFields) {
    if (!next[field]) continue;
    const mapped = mapping.principals[next[field]];
    if (!mapped) return { quarantine: `principal_mapping_missing:${field}`, row };
    next[field] = mapped;
  }
  if (table === 'delegation_uses' && Date.parse(next.expires_at) <= now.getTime()) {
    return { quarantine: 'expired_technical_delegation', row };
  }
  if (table === 'campaign_materials' && !next.artifact_id) {
    return { quarantine: 'artifact_mapping_missing', row };
  }
  return { row: next };
}

export async function transform({ inputDirectory, outputDirectory, mapping, now = new Date() }) {
  await mkdir(outputDirectory, { recursive: true });
  const source = JSON.parse(await readFile(join(inputDirectory, 'manifest.json'), 'utf8'));
  const tables = [];
  const quarantine = [];
  for (const entry of source.tables) {
    const content = await readFile(join(inputDirectory, entry.file), 'utf8');
    if (sha256(content) !== entry.sha256) throw new Error(`source checksum mismatch: ${entry.name}`);
    const accepted = [];
    for (const line of content.split(/\r?\n/).filter(Boolean)) {
      const outcome = transformRow(entry.name, JSON.parse(line), mapping, now);
      if (outcome.quarantine) quarantine.push({ table: entry.name, reason: outcome.quarantine, source_id: outcome.row.id ?? null });
      else accepted.push(outcome.row);
    }
    const transformed = rowsJsonl(accepted);
    await writeFile(join(outputDirectory, entry.file), transformed, { flag: 'wx' });
    tables.push({ name: entry.name, file: entry.file, source_count: entry.row_count,
      row_count: accepted.length, rejected_count: entry.row_count - accepted.length, sha256: sha256(transformed) });
  }
  const manifest = { ...source, source_fingerprint: source.fingerprint, tables,
    fingerprint: manifestFingerprint(tables) };
  await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(join(outputDirectory, 'quarantine.json'), `${JSON.stringify(quarantine, null, 2)}\n`, { flag: 'wx' });
  return { manifest, quarantine };
}
