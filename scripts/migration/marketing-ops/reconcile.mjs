import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertTable, rowsJsonl, sha256 } from './core.mjs';

export async function reconcile({ pool, inputDirectory, outputFile }) {
  const manifest = JSON.parse(await readFile(join(inputDirectory, 'manifest.json'), 'utf8'));
  const tables = [];
  for (const entry of manifest.tables) {
    const table = assertTable(entry.name);
    const result = await pool.query(`select to_jsonb(destination) as row from marketing_ops."${table}" as destination order by to_jsonb(destination)::text`);
    const checksum = sha256(rowsJsonl(result.rows.map(({ row }) => row)));
    tables.push({ table, accepted: entry.row_count, rejected: entry.rejected_count ?? 0,
      destination: result.rows.length, difference: result.rows.length - entry.row_count,
      expected_checksum: entry.sha256, destination_checksum: checksum,
      passed: result.rows.length === entry.row_count && checksum === entry.sha256 });
  }
  const invariants = {};
  const checks = {
    campaigns_without_primary_owner: `select count(*)::int as count from marketing_ops.campaigns c where not exists
      (select 1 from marketing_ops.campaign_members m where m.campaign_id=c.id and m.member_role='owner' and m.is_primary)`,
    terminal_approvals_without_decision: `select count(*)::int as count from marketing_ops.approval_requests r where r.status <> 'pending' and not exists
      (select 1 from marketing_ops.approval_decisions d where d.tenant_id=r.tenant_id and d.request_id=r.id and d.decision=r.status)`,
    authorized_packages_without_approval: `select count(*)::int as count from marketing_ops.action_packages p where p.status='authorized' and not exists
      (select 1 from marketing_ops.approval_requests r where r.tenant_id=p.tenant_id and r.id=p.authorized_by_request_id and r.status='approved')`,
    pending_outbox: `select count(*)::int as count from marketing_ops.domain_events where published_at is null`
  };
  for (const [name, sql] of Object.entries(checks)) invariants[name] = (await pool.query(sql)).rows[0]?.count ?? 0;
  const passed = tables.every((entry) => entry.passed)
    && invariants.campaigns_without_primary_owner === 0
    && invariants.terminal_approvals_without_decision === 0
    && invariants.authorized_packages_without_approval === 0;
  const report = { format_version: 1, manifest_fingerprint: manifest.fingerprint,
    generated_at: new Date().toISOString(), passed, tables, invariants };
  if (outputFile) await writeFile(outputFile, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}
