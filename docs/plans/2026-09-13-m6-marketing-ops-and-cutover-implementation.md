# M6 Marketing Ops and Cutover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**Goal:** Activate Marketing Ops on the canonical ENS PostgreSQL/App API/Hermes stack, migrate accepted legacy data idempotently, validate local cutover and prepare operator-only production checkpoints.

**Architecture:** The browser uses the existing HttpOnly session and calls only `/api/marketing/*` on App API. App API signs a short-lived internal actor assertion for the private Marketing Ops REST service; MCP keeps its independent run-bound delegation. Marketing Ops uses `iam.*` as identity authority and `nexus_app` with transaction-local `app.*` settings under forced tenant RLS.

**Tech Stack:** PostgreSQL 18 migrations, Node.js 22, Fastify 5, Express 4, `jose`, `pg`, MCP SDK 1.30, React 18/Vite, Vitest, Node test runner, Playwright, Docker Compose.

---

## Execution rules

- Follow TDD for every behavior change: failing focused test, minimal implementation, passing focused test, then affected suite.
- Preserve the approved architecture in `docs/plans/2026-09-13-m6-marketing-ops-and-cutover-design.md`.
- Do not execute against the VPS. Stop after local gates and provide only Checkpoint 1 to the human operator.
- Do not commit `.env`, dumps, extracts, credentials or real reconciliation data.
- Use small milestone commits after each task passes.

### Task 1: Freeze canonical schema contracts

**Files:**
- Create: `infra/postgres/test/marketing-ops-migrations.test.mjs`
- Create: `infra/postgres/migrations/0006_marketing_ops_core.sql`
- Modify: `services/marketing-ops/src/migration-contract.test.ts`

**Steps:**

1. Write a Node contract test requiring the 16 canonical tables, IAM foreign keys, absence of duplicate tenant/membership/schema-version tables, ownership-safe DDL and no Supabase roles/functions.
2. Rewrite the service migration contract test to read `infra/postgres/migrations/0006_*.sql` through `0009_*.sql`, initially failing because later files do not exist.
3. Run the focused migration tests and confirm failure.
4. Implement `0006_marketing_ops_core.sql` with types, tables, primary/foreign/unique/check constraints and no destructive DDL.
5. Run focused tests and confirm only security/integrity/index contracts remain failing.
6. Commit: `feat(m6): add canonical marketing ops core schema`.

### Task 2: Implement grants and forced tenant RLS

**Files:**
- Create: `infra/postgres/migrations/0007_marketing_ops_security.sql`
- Modify: `infra/postgres/test/marketing-ops-migrations.test.mjs`
- Modify: `infra/postgres/test/foundation.integration.test.mjs`

**Steps:**

1. Add failing integration cases for no context, valid tenant, cross-tenant, inactive membership and insufficient role.
2. Run the PostgreSQL integration test against an isolated Docker database and confirm failure.
3. Add private helpers for `app.user_id`, `app.tenant_id`, `app.actor_role`, `app.actor_type`, correlation and membership checks.
4. Revoke `PUBLIC`, grant minimal `nexus_app` access and apply `ENABLE/FORCE ROW LEVEL SECURITY` to every tenant table.
5. Add policies for tenant isolation plus campaign/role checks; keep helpers fail-closed.
6. Run migration and integration suites.
7. Commit: `feat(m6): enforce marketing ops tenant rls`.

### Task 3: Implement database integrity and query indexes

**Files:**
- Create: `infra/postgres/migrations/0008_marketing_ops_integrity.sql`
- Create: `infra/postgres/migrations/0009_marketing_ops_indexes.sql`
- Modify: `infra/postgres/test/marketing-ops-migrations.test.mjs`
- Modify: `services/marketing-ops/src/migration-contract.test.ts`

**Steps:**

1. Add failing contracts for optimistic versions, legal campaign/item/approval/package transitions, append-only ledgers, payload immutability, one primary owner and acyclic dependencies.
2. Add failing contracts for all FK indexes and cursor/schedule/queue/outbox indexes.
3. Implement transaction-safe triggers/functions with fixed `search_path`; use `SECURITY DEFINER` only for the bounded approval expiry operation.
4. Implement indexes matching repository queries.
5. Run static migration tests and PostgreSQL integration/concurrency suites.
6. Commit: `feat(m6): enforce marketing ops state integrity`.

### Task 4: Replace Supabase SQL context with canonical IAM

**Files:**
- Modify: `services/marketing-ops/src/auth/actor.ts`
- Modify: `services/marketing-ops/src/db/actorTransaction.ts`
- Modify: `services/marketing-ops/src/domain/approvalExpiryWorker.ts`
- Modify: affected tests under `services/marketing-ops/src/**/*.test.ts`
- Delete: `services/marketing-ops/src/auth/supabaseAuth.ts`

**Steps:**

1. Change tests to expect `iam.tenants`, `iam.memberships(principal_id)` and transaction-local `app.*`; confirm failures.
2. Replace actor resolution and role mapping with IAM queries.
3. Replace `request.jwt.claim.*` and legacy role switching with `app.user_id`, `app.tenant_id`, `app.actor_role`, `app.actor_type`, `app.origin`, `app.correlation_id`.
4. Route the expiry worker through the bounded canonical database function.
5. Prove no active service source contains `auth.uid`, `request.jwt`, `authenticated`, `service_role` or Supabase authentication.
6. Run service unit/typecheck suites.
7. Commit: `refactor(m6): use canonical iam and app sql context`.

### Task 5: Add signed App API actor assertions

**Files:**
- Create: `services/app-api/src/marketing/assertion.js`
- Create: `services/app-api/test/marketing-assertion.test.js`
- Create: `services/marketing-ops/src/auth/bffAssertion.ts`
- Create: `services/marketing-ops/src/auth/bffAssertion.test.ts`
- Modify: both services' config and package manifests/lockfiles

**Steps:**

1. Write failing tests for valid claims and denial of wrong issuer/audience/algorithm/kid, expiry, future token, method/path mismatch and placeholder keys.
2. Implement HS256 keyrings with separate active/previous BFF keys, 30-second maximum lifetime and required claims.
3. Ensure keys never appear in logs or error envelopes.
4. Run focused tests, service suites and typechecks.
5. Commit: `feat(m6): authenticate bff calls with signed actor assertions`.

### Task 6: Add the authenticated Marketing Ops BFF proxy

**Files:**
- Create: `services/app-api/src/marketing/routes.js`
- Create: `services/app-api/test/marketing.test.js`
- Modify: `services/app-api/src/server.js`
- Modify: `services/app-api/src/config.js`
- Modify: `services/marketing-ops/src/http/middleware.ts`
- Modify: `services/marketing-ops/src/http/routes/index.ts`
- Modify: `services/marketing-ops/src/index.ts`

**Steps:**

1. Add failing tests for anonymous denial, forged identity stripping, signed upstream identity, query/body/upload forwarding, ETag/correlation preservation and stable timeout errors.
2. Extract/reuse App API session authentication and register `/api/marketing/*`.
3. Implement streaming proxy with explicit allowlisted headers, no redirects and bounded timeouts/body sizes.
4. Replace REST Bearer auth in Marketing Ops with BFF assertion middleware plus live IAM membership check.
5. Run App API and Marketing Ops suites.
6. Commit: `feat(m6): proxy marketing ops through app api`.

### Task 7: Switch frontend to same-origin session auth

**Files:**
- Modify: `apps/chat-web/src/lib/marketingOps/client.ts`
- Modify: `apps/chat-web/src/lib/marketingOps/runtime.ts`
- Modify: related client tests
- Modify: `apps/chat-web/src/components/TopBar.tsx`
- Modify: `apps/chat-web/src/components/Sidebar.tsx`
- Modify: `apps/chat-web/src/App.tsx`
- Modify: `apps/chat-web/Dockerfile`

**Steps:**

1. Change tests to require `/api/marketing`, same-origin credentials and no Authorization/user ID token.
2. Implement the client contract and preserve mutation/idempotency/ETag headers.
3. Wire TopBar and existing Sidebar routes under the flag matrix.
4. Add Docker build args for all Marketing Ops flags and kill switch.
5. Run frontend unit tests, typecheck/lint and build.
6. Commit: `feat(m6): activate marketing ops frontend through bff`.

### Task 8: Add Marketing Ops to the local application stack

**Files:**
- Modify: `infra/app/compose.yaml`
- Modify: `infra/app/compose.development.yaml`
- Modify: `infra/app/compose.production.yaml`
- Modify: `infra/app/README.md`
- Modify: `.env.example`
- Create/modify: Compose contract tests under `infra/app/test/`

**Steps:**

1. Add failing static Compose tests for service, secrets, healthcheck, networks and absence of production port/Traefik labels.
2. Add `marketing-ops` on `app-internal`, `postgres-data`, `hermes-net`, using `nexus_app` password secret and internal URLs.
3. Add App API URL/keyring and frontend build args.
4. Align environment variable names with actual service config and remove active Marketing Ops Supabase settings.
5. Validate merged development and production Compose configurations without exposing secret values.
6. Commit: `feat(m6): add marketing ops to ens app stack`.

### Task 9: Validate Hermes MCP integration

**Files:**
- Modify: `agents/ens/config.yaml`
- Modify: `agents/ens/README.md`
- Modify: `agents/ens/skills/marketing-ops-operator/SKILL.md`
- Modify: MCP and distribution validation tests
- Modify: `scripts/smoke-app-stack.mjs`

**Steps:**

1. Add failing tests for internal MCP URL, distributable no-secret config and exact tool contracts.
2. Align runtime config and operator skill with prepare/confirm/execute and current tool names.
3. Extend smoke coverage for MCP initialize/capabilities, denied missing delegation, valid read and idempotent confirmed write.
4. Run distribution validation, bridge tests and Marketing Ops MCP tests.
5. Commit: `feat(m6): connect hermes to marketing ops mcp`.

### Task 10: Build the idempotent migration pipeline

**Files:**
- Create: `scripts/migration/marketing-ops/` source modules and CLI
- Create: `scripts/migration/marketing-ops/schema/` manifest/mapping schemas
- Create: `scripts/migration/marketing-ops/test/` tests and synthetic fixtures
- Modify: `.gitignore`
- Modify: root/package scripts as appropriate

**Steps:**

1. Write failing tests for deterministic extract manifests, canonical hashes, IAM mapping, enum/timezone normalization, quarantine and no secret/PII logging.
2. Implement read-only snapshot extraction to ignored local output.
3. Implement pure transform with explicit mapping file and deterministic quarantine reasons.
4. Implement staging tables/run ledger and batched upserts in dependency order.
5. Prove same-manifest rerun changes no rows and divergent fingerprint requires a new run.
6. Run tests against synthetic fixtures and isolated PostgreSQL.
7. Commit: `feat(m6): add idempotent marketing ops migration pipeline`.

### Task 11: Implement reconciliation and ledger review

**Files:**
- Create: `scripts/migration/marketing-ops/reconcile.*`
- Create: `docs/migration/supabase-ledger/reviews/marketing-ops.json`
- Modify: ledger generation/validation inputs as required
- Create: `docs/migration/marketing-ops-data-mapping.md`

**Steps:**

1. Add failing tests for counts, PK sets, chunk hashes, FK orphans, primary owners, dependency cycles, content versions, approvals/packages, artifacts, idempotency and outbox.
2. Implement machine-readable redacted reconciliation output and nonzero failure on unexplained differences.
3. Reconcile the 20-versus-19 table discrepancy.
4. Mark IAM consolidations and schema-version removal explicitly in the review.
5. Validate all accepted Marketing Ops ledger objects have destination, test and status.
6. Commit: `feat(m6): reconcile marketing ops migration scope`.

### Task 12: Run the full local database and service gates

**Files:**
- Modify only when a failing test reveals a scoped defect.
- Record sanitized evidence in `docs/migration/evidence/` if that convention exists; otherwise in the M6 runbook.

**Steps:**

1. Run PostgreSQL static/unit tests.
2. Start a fresh isolated PostgreSQL volume and apply `0001`–`0009`.
3. Run RLS, integration, concurrency, performance and migration-pipeline suites.
4. Run App API, Marketing Ops, Chat Bridge and frontend test/typecheck/build suites.
5. Run secret/Supabase boundary scans.
6. Stop on any failure; fix through focused TDD before rerunning the complete gate.

### Task 13: Validate the complete Docker Desktop stack

**Files:**
- Modify: `scripts/smoke-app-stack.mjs`
- Modify: `apps/chat-web/e2e/marketing-ops.spec.ts`
- Create: local cutover rehearsal script/tests as needed

**Steps:**

1. Build and start the canonical local stack with fresh data.
2. Verify all containers healthy and private services unexposed in the production merge.
3. Seed synthetic IAM/Marketing Ops data and run extract/transform/load/reconcile twice.
4. Execute authenticated REST smoke and MCP smoke.
5. Execute browser E2E for campaigns, calendar, approvals, kill switch and Hermes commands.
6. Record duration, counts, reconciliation and rollback rehearsal; tear down only task-specific disposable state.
7. Commit: `test(m6): prove local marketing ops cutover`.

### Task 14: Prepare operator-only production checkpoints

**Files:**
- Create: `docs/operations/m6-marketing-ops-cutover.md`
- Modify after real evidence only: `MIGRATION_STATUS.md`
- Modify after real evidence only: `docs/migration/roadmap.md`

**Steps:**

1. Write Checkpoint 1 (migrations) with exact command, impact, expected output, stop condition and immediate rollback.
2. Stop and wait for the operator's sanitized Checkpoint 1 output.
3. Only after validation, release Checkpoint 2 (pull/build/containers) with the same five fields.
4. Repeat sequentially for Checkpoint 3 (data + automated smoke) and Checkpoint 4 (browser/Hermes homologation).
5. Update status/roadmap only after all returned evidence is validated.
6. Run final repository verification and commit: `docs(m6): record validated marketing ops cutover`.

### Task 15: Complete the structured plan execution gate

**Status:** required after the production finding of 2026-09-14; not implemented.

The original conversational confirmation design is superseded for browser
execution by:

- [ADR-0004](../decisions/ADR-0004-structured-marketing-ops-plan-execution.md);
- [approved complementary design](2026-09-14-structured-marketing-ops-plan-execution-design.md);
- [TDD implementation plan](2026-09-14-structured-marketing-ops-plan-execution-implementation.md).

M6 remains incomplete until that plan passes locally and the human operator
returns validated production evidence. Do not restore the private Hermes
decision endpoint or solve the gate with natural-language confirmation.
