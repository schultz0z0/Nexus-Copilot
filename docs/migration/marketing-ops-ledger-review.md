# M6 Marketing Ops ledger review

Status: approved for the local M6 implementation and migration rehearsal.

The review overlay `supabase-ledger/reviews/marketing-ops.json` resolves all 801
objects whose canonical identity belongs directly to `marketing_ops.*`: 241
columns, 394 constraints, 50 indexes, 51 policies, 19 tables, 28 triggers and 18
types. The rendered decision ledger and report include this overlay and pass the
ledger verifier.

## Resolution of the table-count discrepancy

The source manifest contains 19 Marketing Ops tables, not 20. The M6 target has
16 product tables. The difference is intentional:

- `marketing_ops.tenants` is consolidated into `iam.tenants`;
- `marketing_ops.memberships.user_id` is consolidated into
  `iam.memberships.principal_id`;
- `marketing_ops.schema_versions` is removed and superseded by
  `infra.schema_migrations`.

No `public.*` or `smart_mail.*` object is included by similarity of name.

## Destination and verification contract

Every remaining table maps to the same table name in the canonical
`marketing_ops` schema created by migrations 0006-0009. The executable mapping
and load order live under `scripts/migration/marketing-ops/schema/` and
`core.mjs`. Verification is performed by:

- the ledger verifier for object-level review completeness;
- the transform quarantine rules for missing IAM/artifact mappings and expired
  technical delegations;
- manifest/file SHA-256 verification before load;
- the idempotent run ledger in `migration_control`;
- reconciliation of counts and canonical checksums per table;
- business invariants for primary owners, terminal approvals, authorized action
  packages and outbox visibility.

Real exports, identity maps, quarantine contents and reconciliation reports may
contain operational data and therefore remain in ignored local storage. They
must never be committed.
