import { readFile, writeFile } from 'node:fs/promises';

const decisionsPath = new URL('../../../docs/migration/supabase-ledger/object-decisions.json', import.meta.url);
const outputPath = new URL('../../../docs/migration/supabase-ledger/reviews/marketing-ops.json', import.meta.url);
const decisions = JSON.parse(await readFile(decisionsPath, 'utf8')).decisions
  .filter(({ object_id }) => object_id.includes('marketing_ops.'));

function review(decision) {
  const id = decision.object_id;
  const suffix = id.slice(id.indexOf(':') + 1);
  if (id.includes('marketing_ops.schema_versions')) return {
    object_id: id, action: 'remove', target_component: 'postgres-foundation',
    target_name: 'infra.schema_migrations', milestone: 'M6', review_status: 'approved',
    reason_code: 'supabase_runtime_removal'
  };
  if (id.includes('marketing_ops.tenants')) return {
    object_id: id, action: 'transform', target_component: 'iam',
    target_name: suffix.replace('marketing_ops.tenants', 'iam.tenants'),
    milestone: 'M6', review_status: 'approved', reason_code: 'identity_canonicalization'
  };
  if (id.includes('marketing_ops.memberships')) return {
    object_id: id, action: 'transform', target_component: 'iam',
    target_name: suffix.replace('marketing_ops.memberships', 'iam.memberships')
      .replace(/\.user_id$/, '.principal_id'),
    milestone: 'M6', review_status: 'approved', reason_code: 'identity_canonicalization'
  };
  return {
    object_id: id, action: 'transform', target_component: 'marketing-ops-postgres',
    target_name: suffix, milestone: 'M6', review_status: 'approved',
    reason_code: 'marketing_domain_migration'
  };
}

const reviews = decisions.map(review).sort((left, right) => left.object_id.localeCompare(right.object_id));
await writeFile(outputPath, `${JSON.stringify({ reviews }, null, 2)}\n`);
console.log(`wrote ${reviews.length} approved Marketing Ops reviews`);
