import { createHash } from 'node:crypto';

export const TABLE_ORDER = [
  'campaigns', 'campaign_members', 'campaign_materials', 'campaign_items',
  'item_dependencies', 'content_assets', 'content_versions', 'item_artifacts',
  'action_packages', 'approval_requests', 'approval_decisions', 'audit_events',
  'domain_events', 'idempotency_records', 'delegation_uses', 'in_app_notifications'
];

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stable(nested)])
  );
  return value;
}

export const canonicalJson = (value) => JSON.stringify(stable(value));
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const rowsJsonl = (rows) => rows
  .map((row) => canonicalJson(row)).sort().map((row) => `${row}\n`).join('');

export function manifestFingerprint(tables) {
  return sha256(canonicalJson(tables.map(({ name, row_count, sha256: checksum }) => ({
    name, row_count, sha256: checksum
  })).sort((a, b) => a.name.localeCompare(b.name))));
}

export function assertTable(name) {
  if (!TABLE_ORDER.includes(name)) throw new Error(`unsupported Marketing Ops table: ${name}`);
  return name;
}

export const quoteIdent = (value) => `"${String(value).replaceAll('"', '""')}"`;

export function sourceKey(table, row) {
  if (row.id) return String(row.id);
  if (table === 'campaign_members') return `${row.campaign_id}:${row.user_id}`;
  if (table === 'item_dependencies') return `${row.item_id}:${row.depends_on_item_id}`;
  if (table === 'content_versions') return `${row.asset_id}:${row.version_number}`;
  if (table === 'idempotency_records') return `${row.tenant_id}:${row.actor_id}:${row.operation}:${row.idempotency_key}`;
  if (table === 'delegation_uses') return String(row.jti);
  throw new Error(`cannot derive source key for ${table}`);
}
