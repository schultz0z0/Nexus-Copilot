# M6 Structured Marketing Ops Plan Execution — Implementation Plan

> **Executor:** use `executing-plans` and implement one task at a time. Follow
> `test-driven-development` for every behavior change and
> `verification-before-completion` before claiming a gate.

**Goal:** Persist immutable agent-prepared Marketing Ops plans and let an
authenticated user execute the exact plan through an explicit **Executar plano**
button, without a new Hermes turn or any private Hermes endpoint.

**Architecture:** `marketing_ops_prepare_plan_v1` validates and records the plan
in PostgreSQL. App API/BFF exposes only actor-scoped structured plan routes.
Chat Web renders an allowlisted card and posts the ID/hash with an idempotency
key. Marketing Ops reserves, executes through the existing plan executor and
records a terminal result. Hermes remains official and unmodified.

**Tech stack:** PostgreSQL 18 migrations/RLS, Node.js 22, TypeScript, Express,
Fastify BFF proxy, React 18, TanStack Query, Vitest, Node test runner, Playwright,
Docker Compose.

**Authoritative documents:**

- [ADR-0004](../decisions/ADR-0004-structured-marketing-ops-plan-execution.md)
- [Approved design](2026-09-14-structured-marketing-ops-plan-execution-design.md)
- [M6 design](2026-09-13-m6-marketing-ops-and-cutover-design.md)
- [M6 production runbook](../operations/m6-marketing-ops-cutover.md)

## Execution rules

- Work on a feature branch/worktree; do not push directly to `main`.
- Do not access or change the VPS. Production remains operator-only.
- Do not modify, vendor or fork the Hermes Agent core.
- Do not add Supabase, Graph MCP or Neo4j.
- Never persist or expose `delegation_token`/`plan_token` to the browser.
- Never create a card by parsing assistant text or Markdown.
- Keep `MARKETING_OPS_STRUCTURED_PLAN_EXECUTION=false` by default until the local
  gate passes.
- For each task: write a failing focused test, run it and record the expected
  failure, implement the smallest change, rerun focused tests, then run the
  affected suite.
- Commit after each green task. Stop on any unexplained failure or scope drift.

## Task 1 — Freeze the database contract with failing tests

**Files:**

- Modify: `infra/postgres/test/marketing-ops-migrations.test.mjs`
- Modify: `infra/postgres/test/marketing-ops.integration.test.mjs`
- Create after the tests fail: `infra/postgres/migrations/0017_marketing_ops_prepared_plans.sql`

**Step 1: add static tests before the migration exists.** Require:

- table `marketing_ops.prepared_agent_plans` and all fields from the design;
- FK to `iam.tenants` and `iam.principals`;
- `ENABLE` and `FORCE ROW LEVEL SECURITY`;
- revoke from `PUBLIC`, minimal grants to `nexus_app`;
- immutable identity, actions, scopes and hash;
- valid state transitions and terminal-state lock;
- partial pending lookup index and unique execution key per tenant;
- no token-named column.

Representative assertion:

```js
assert.match(sql, /CREATE TABLE marketing_ops\.prepared_agent_plans/i);
assert.doesNotMatch(sql, /\b(plan_token|delegation_token)\b/i);
assert.match(sql, /FORCE ROW LEVEL SECURITY/i);
```

**Step 2: run the red test.**

```bash
npm --prefix infra/postgres test
```

Expected: failure because migration `0017` and the new table do not exist.

**Step 3: add integration tests** for no SQL context, correct actor/tenant,
cross-user, cross-tenant, immutability, illegal transitions and duplicate
execution keys.

**Step 4: run the isolated integration test and confirm red.**

```bash
npm --prefix infra/postgres run test:integration
```

**Step 5: implement migration `0017`.** Use `nexus_owner`, fixed search paths,
RLS helpers already present, bounded JSON checks and an explicit check/trigger
for the transition graph. Do not add a new tenant or membership table.

**Step 6: rerun both suites and make them green.**

**Commit:** `feat(m6): add durable prepared agent plans`

## Task 2 — Implement the prepared-plan repository and lifecycle

**Files:**

- Create: `services/marketing-ops/src/plans/repository.ts`
- Create: `services/marketing-ops/src/plans/repository.test.ts`
- Modify: `services/marketing-ops/src/plans/contracts.ts`
- Modify: `services/marketing-ops/src/domain/context.ts` only if a typed context
  field is required

**Step 1: write repository tests** for:

- canonical hash and derived sorted scopes;
- insert-or-return for `(tenant, prepared_by, source_run_id, plan_hash)`;
- invalidation of a prior pending plan for the same Run and different hash;
- actor/session-scoped listing;
- opportunistic expiry;
- reservation with lock, hash, execution key and lease;
- same-key retry, different-key conflict and stale lease recovery;
- terminal result storage without changing immutable fields.

Use a fake pool for focused unit tests and real PostgreSQL in the integration
task. A core behavior should look like:

```ts
const first = await repository.prepare(context, input);
const replay = await repository.prepare(context, input);
expect(replay.id).toBe(first.id);
```

**Step 2: run red.**

```bash
npm --prefix services/marketing-ops test -- src/plans/repository.test.ts
```

**Step 3: implement the repository.** Keep SQL parameterized, all reads scoped
by tenant + actor, and use `actorTransaction`/existing `app.*` context rather
than a privileged connection.

**Step 4: run focused and full service suites.**

```bash
npm --prefix services/marketing-ops test -- src/plans/repository.test.ts
npm --prefix services/marketing-ops test
npm --prefix services/marketing-ops run typecheck
```

**Commit:** `feat(m6): persist prepared plan lifecycle`

## Task 3 — Persist plans from the MCP preparation tool

**Files:**

- Modify: `services/marketing-ops/src/mcp/createServer.ts`
- Modify: `services/marketing-ops/src/mcp.test.ts`
- Modify: `services/marketing-ops/src/production-gate.test.ts`
- Modify: `services/marketing-ops/src/plans/token.ts`
- Modify: `services/marketing-ops/src/index.ts`
- Modify: `agents/ens/skills/marketing-ops-operator/SKILL.md`
- Modify: `agents/ens/skills/marketing-ops-operator/references/mcp-contract.md`
- Modify: `agents/ens/skills/marketing-ops-operator/templates/plan-preview.md`

**Step 1: change MCP tests first.** They must expect:

```json
{
  "persisted": true,
  "confirmation": "product_ui_required",
  "plan": { "status": "pending" }
}
```

Also prove same Run/hash is idempotent and a revised hash invalidates the first
pending plan. Tests must prove the persisted record has no token value.

**Step 2: run red.**

```bash
npm --prefix services/marketing-ops test -- src/mcp.test.ts
```

Expected: current tool returns `persisted:false` and has no repository call.

**Step 3: inject the repository** into MCP dependencies and persist after all
delegation/feature/schema checks succeed. Preserve the signed `plan_token` only
for transitional MCP compatibility; never make it part of the REST DTO.

**Step 4: update the ENS operator skill.** It must tell Hermes to prepare and
explain the plan, then wait for the product card. It must not ask the user to
type a confirmation and must not call execute for the browser channel.

**Step 5: rerun affected gates.**

```bash
npm --prefix services/marketing-ops test
npm --prefix services/marketing-ops run typecheck
npm run validate:hermes-profile
npm run test:hermes
```

**Commit:** `feat(m6): persist plans prepared through mcp`

## Task 4 — Add actor-scoped Marketing Ops REST routes

**Files:**

- Create: `services/marketing-ops/src/http/routes/agentPlans.ts`
- Create: `services/marketing-ops/src/http/routes/agentPlans.test.ts`
- Create: `services/marketing-ops/src/plans/service.ts`
- Create: `services/marketing-ops/src/plans/service.test.ts`
- Modify: `services/marketing-ops/src/http/routes/index.ts`
- Modify: `services/marketing-ops/src/plans/executor.ts` only for a clean shared
  service boundary; preserve its action semantics
- Modify: `services/marketing-ops/src/config.ts`

**Step 1: add route/service tests** for:

- list only current tenant/user/session and only allowlisted DTO fields;
- 404 for other tenant/user;
- 409 hash mismatch/not-pending/precondition conflict;
- 410 expired;
- 503 write/structured flag disabled;
- approvals action denied when approvals flag is false;
- exact stored actions used even if request contains an `actions` property;
- successful completion/partial/failure terminal states;
- same idempotency key returns the same result;
- concurrent keys execute once;
- stale `executing` resumes only with the original key.

Representative malicious request:

```ts
await request(app)
  .post(`/v1/agent-plans/${plan.id}/execute`)
  .set('Idempotency-Key', executionKey)
  .send({ planHash: plan.planHash, actions: [{ type: 'campaign.create_draft' }] })
  .expect(400);
```

Prefer a strict body schema that rejects unknown fields.

**Step 2: run red.**

```bash
npm --prefix services/marketing-ops test -- src/http/routes/agentPlans.test.ts src/plans/service.test.ts
```

**Step 3: implement:**

- `GET /v1/agent-plans?chat_session_id=&status=pending&limit=`;
- `POST /v1/agent-plans/:planId/execute` with `{ planHash }` only;
- reservation/finalization around `executeMarketingOpsPlan`;
- current BFF assertion/membership checks and correlation IDs;
- stable errors from the approved design;
- no action payload in logs.

**Step 4: add metrics** to the existing registry and focused observability tests.

**Step 5: run service tests/typecheck/build.**

```bash
npm --prefix services/marketing-ops test
npm --prefix services/marketing-ops run typecheck
npm --prefix services/marketing-ops run build
```

**Commit:** `feat(m6): execute prepared plans through bff routes`

## Task 5 — Prove the App API/BFF boundary

**Files:**

- Modify: `services/app-api/test/marketing.test.js`
- Modify: `services/app-api/src/marketing/routes.js` only if the generic proxy
  does not already satisfy the contract
- Modify: `services/app-api/src/config.js` if the structured flag is enforced at
  the BFF

**Step 1: add failing integration-style proxy tests** for the two public paths:

- anonymous request denied before upstream;
- cookie session resolves actor/tenant;
- client-supplied identity/authorization headers stripped;
- signed internal assertion binds the exact forwarded method/path;
- query `chat_session_id` is preserved;
- `Idempotency-Key` is required/preserved for execute;
- `planHash` is preserved and extra `actions` is rejected upstream;
- 404/409/410/503 and correlation ID pass through without topology leakage;
- response never contains a field matching `/token|secret|delegation/i`.

**Step 2: run red or confirm the generic proxy passes without production code.**

```bash
npm --prefix services/app-api test -- test/marketing.test.js
```

If it already passes, retain the new regression tests and do not add needless
route code.

**Step 3: implement only gaps**, preserving same-origin cookies, allowlisted
headers, bounded body size, timeout and no redirects.

**Step 4: run the App API suite.**

```bash
npm --prefix services/app-api test
```

**Commit:** `test(m6): lock structured plan bff contract` or
`feat(m6): proxy structured plan execution`

## Task 6 — Add frontend types and client methods

**Files:**

- Modify: `apps/chat-web/src/lib/marketingOps/types.ts`
- Modify: `apps/chat-web/src/lib/marketingOps/client.ts`
- Modify: `apps/chat-web/src/lib/marketingOps/client.test.ts`
- Modify: `apps/chat-web/src/lib/marketingOps/queryKeys.ts`
- Modify: `apps/chat-web/src/lib/marketingOps/queryKeys.test.ts`
- Modify: `apps/chat-web/src/lib/marketingOps/flags.ts`
- Modify: `apps/chat-web/src/lib/marketingOps/runtime.ts`

**Step 1: write failing tests** for:

- `listAgentPlans(chatSessionId, 'pending')` same-origin URL;
- `executeAgentPlan(id, hash, idempotencyKey)` exact POST body/header;
- no token/action body sent during execute;
- query key scoped by session;
- structured flag disabled unless master/read/write and its own flag are true.

Expected call:

```ts
expect(fetch).toHaveBeenCalledWith(
  `/api/marketing/agent-plans/${planId}/execute`,
  expect.objectContaining({
    method: 'POST',
    credentials: 'same-origin',
    body: JSON.stringify({ planHash })
  })
);
```

**Step 2: run red.**

```bash
npm --prefix apps/chat-web test -- src/lib/marketingOps/client.test.ts src/lib/marketingOps/queryKeys.test.ts
```

**Step 3: implement strict DTOs/client/query keys/flag.** Avoid `unknown` action
rendering in components; expose a discriminated union for supported actions and
a safe `unsupported` state.

**Step 4: run focused tests and typecheck.**

```bash
npm --prefix apps/chat-web test -- src/lib/marketingOps/client.test.ts src/lib/marketingOps/queryKeys.test.ts
npm --prefix apps/chat-web run typecheck
```

**Commit:** `feat(m6): add structured plan frontend client`

## Task 7 — Build the trusted plan card

**Files:**

- Create: `apps/chat-web/src/components/marketing-ops/AgentPlanCard.tsx`
- Create: `apps/chat-web/src/components/marketing-ops/AgentPlanCard.test.tsx`
- Create: `apps/chat-web/src/components/marketing-ops/agentPlanPresentation.ts`
- Create: `apps/chat-web/src/components/marketing-ops/agentPlanPresentation.test.ts`

**Step 1: write presentation tests** for all current action types in
`plans/contracts.ts`. Each renderer must use allowlisted fields and escape text.
Unknown action types render “Ação não suportada” and disable execution.

**Step 2: write component tests** for:

- action list, expiry, status, plan ID/hash short form;
- explicit accessible name **Executar plano**;
- keyboard activation and focus preservation;
- busy/disabled/terminal/expired/unsupported states;
- `aria-live` result announcement;
- same UUID idempotency key reused after a retry;
- approval copy says “Solicitação de aprovação criada — pendente”;
- no autoapproval or external-action claim;
- optional critical-risk confirmation, driven by a server field only.

**Step 3: run red.**

```bash
npm --prefix apps/chat-web test -- src/components/marketing-ops/AgentPlanCard.test.tsx src/components/marketing-ops/agentPlanPresentation.test.ts
```

**Step 4: implement the smallest accessible card** using existing UI primitives.
Do not parse `ChatMessageContent`; the card receives a typed plan prop.

**Step 5: run focused tests, lint and typecheck.**

```bash
npm --prefix apps/chat-web test -- src/components/marketing-ops/AgentPlanCard.test.tsx src/components/marketing-ops/agentPlanPresentation.test.ts
npm --prefix apps/chat-web run lint
npm --prefix apps/chat-web run typecheck
```

**Commit:** `feat(m6): render trusted agent plan card`

## Task 8 — Attach plans to chat sessions without parsing messages

**Files:**

- Modify: `apps/chat-web/src/components/ChatInterface.tsx`
- Create: `apps/chat-web/src/components/ChatInterface.agentPlans.test.tsx`
- Modify: `apps/chat-web/src/components/AuthenticatedQueryProvider.tsx` only if
  query invalidation needs a shared hook
- Modify: `apps/chat-web/src/components/chat/chatStreamClient.ts` only to expose
  the existing terminal Run event; do not inject plan data into assistant text

**Step 1: add failing integration component tests** proving:

- opening an authenticated chat queries plans by the fixed session UUID;
- a terminal assistant Run invalidates/refetches the plan query;
- assistant Markdown containing a fake plan ID/button text creates no card;
- only structured API data creates a card;
- successful execution updates/removes pending state without sending a message;
- no POST `/api/chat/runs` occurs on the button click;
- feature/kill switch hides the card and prevents fetch/execute.

**Step 2: run red.**

```bash
npm --prefix apps/chat-web test -- src/components/ChatInterface.agentPlans.test.tsx
```

**Step 3: implement a session-scoped query** and render plan cards outside
`ChatMessageContent`, visually adjacent to the originating Run when
`source_run_id` matches, or after the latest assistant message as fallback.

**Step 4: run affected frontend suite.**

```bash
npm --prefix apps/chat-web test
npm --prefix apps/chat-web run typecheck
npm --prefix apps/chat-web run build
```

**Commit:** `feat(m6): connect prepared plans to chat ux`

## Task 9 — Remove the private Hermes decision dependency

**Files:**

- Modify: `services/chat-bridge/src/server.js`
- Modify: `services/chat-bridge/src/marketing-ops-delegation.js`
- Modify: `services/chat-bridge/src/hermes-payloads.js`
- Modify: `services/chat-bridge/test/server-runtime-scope.test.js`
- Modify: `services/chat-bridge/test/marketing-ops-delegation.test.js`
- Modify: `services/chat-bridge/test/hermes-payloads.test.js`
- Modify: `agents/ens/skills/marketing-ops-operator/SKILL.md`

**Step 1: invert the existing contract test.** It must fail while active source
still contains `/v1/internal/marketing-ops-decision`.

```js
assert.doesNotMatch(source, /\/v1\/internal\/marketing-ops-decision/);
```

Add tests that all browser-originated delegations remain
`confirmation_intent=false` and that prompt text tells the model to wait for the
product card after preparation.

**Step 2: run red.**

```bash
npm --prefix services/chat-bridge test
```

**Step 3: remove only the obsolete classifier path.** Do not remove generic
official Hermes Run approvals or delegation refresh used elsewhere. Do not add
a replacement Hermes endpoint.

**Step 4: run Bridge/profile gates and scan.**

```bash
npm --prefix services/chat-bridge test
npm run validate:hermes-profile
npm run test:hermes
```

```bash
rg -n "/v1/internal/marketing-ops-decision" services agents test
```

Expected scan: documentation/history only; zero active source/test expectation.

**Commit:** `refactor(m6): remove private hermes decision dependency`

## Task 10 — Wire feature flags and Compose contracts

**Files:**

- Modify: `services/marketing-ops/src/config.ts`
- Modify: `infra/app/compose.yaml`
- Modify: `infra/app/compose.production.yaml`
- Modify: `infra/app/compose.development.yaml`
- Modify: `apps/chat-web/Dockerfile`
- Modify: `.env.example`
- Modify: `test/app/compose-contract.test.mjs`
- Modify: `infra/app/README.md`

**Step 1: add failing contracts** for backend/frontend structured flags,
production default false, Vite build arg, no new published port/router, and no
new secret in the frontend image.

**Step 2: run red.**

```bash
npm run test:app:contract
```

**Step 3: implement both flags** and startup logging as boolean markers only.
Do not log env contents. Preserve separate read/write/approvals/kill-switch
gates.

**Step 4: render all Compose variants and run contracts.**

```bash
npm run test:app:contract
docker compose -f infra/app/compose.yaml -f infra/app/compose.development.yaml config --quiet
docker compose -f infra/app/compose.yaml -f infra/app/compose.production.yaml config --quiet
```

Use only sanitized local env fixtures required by the existing contract setup.

**Commit:** `feat(m6): gate structured plan execution rollout`

## Task 11 — Extend automated smoke and browser E2E

**Files:**

- Modify: `scripts/smoke-app-stack.mjs`
- Modify: `services/marketing-ops/src/mcp/smoke.ts`
- Create: `apps/chat-web/e2e/structured-plan-execution.spec.ts`
- Modify: `apps/chat-web/e2e/helpers/hermesOperatorFake.ts`
- Modify: `apps/chat-web/e2e/helpers/hermesOperatorFixtures.ts`

**Step 1: add failing E2E scenarios:**

1. login and open a chat;
2. simulated official Hermes prepares one inert operational approval plan;
3. trusted card appears with exact actions and **Executar plano**;
4. fake Markdown plan does not create a card;
5. click creates one pending approval and no decision/external action;
6. double click/network retry still creates one approval;
7. expired/hash-mismatch/cross-user/cross-tenant are denied;
8. request log shows no second Hermes Run for execution;
9. kill switch hides/disables the flow.

**Step 2: run red.**

```bash
npm --prefix apps/chat-web run e2e -- structured-plan-execution.spec.ts
```

**Step 3: extend smoke** to check persistence, actor-scoped GET, execution and
idempotency. Use synthetic/inert data only.

**Step 4: run focused E2E and smoke against the local stack.**

**Commit:** `test(m6): prove structured plan execution end to end`

## Task 12 — Full local verification and Docker Desktop gate

**Files:**

- Modify only when a focused failing test proves a scoped defect.
- Update after evidence: `docs/operations/m6-marketing-ops-cutover.md`
- Update after evidence: `MIGRATION_STATUS.md`
- Update after evidence: `docs/migration/roadmap.md`

**Step 1: run repository gates from a clean dependency install.**

```bash
npm run test:postgres
npm run test:postgres:integration
npm run test:app:contract
npm run test:hermes
npm run validate:hermes-profile
npm run test
npm run typecheck
npm run build
```

**Step 2: run security scans.** Prove:

- no active private Hermes decision endpoint;
- no plan/delegation token in frontend bundles or REST DTOs;
- no browser -> Hermes/PostgreSQL route;
- no Supabase/Graph/Neo4j introduced;
- Marketing Ops remains private in production Compose.

**Step 3: fresh Docker Desktop rehearsal.** Use a unique project name and fresh
PostgreSQL volume. Apply `0001`–`0017`, start the complete stack with the
structured flags enabled only in the test env, run authenticated HTTP/MCP smoke
and Playwright, then run the inert approval plan twice with the same key.

Expected evidence:

- every container healthy;
- migrations `0001`–`0017`, second run all skipped;
- exactly one plan and one pending approval;
- zero approval decisions and zero external actions;
- zero second Hermes Run during the click;
- cross-user/tenant and expired/hash mismatch denied;
- no host ports for private services in production merge.

**Step 4: exercise local rollback.** Disable both structured flags, recreate only
Marketing Ops and Chat Web, prove ordinary chat/read still work and the pending
plan is inert. Do not delete the migration or data.

**Step 5: update documentation with sanitized commands/results.** Do not mark M6
complete. Change it only to “gate local aprovado; checkpoint produtivo pendente”.

**Step 6: request code review** focused on authorization, idempotency,
concurrency, secret leakage, UI trust boundary and no-fork compliance. Resolve
findings with focused red/green tests.

**Commit:** `test(m6): validate structured plan execution locally`

## Task 13 — Prepare, but do not execute, the production checkpoint

**Files:**

- Modify: `docs/operations/m6-marketing-ops-cutover.md`

Only after Task 12 is green, append an operator checkpoint containing:

1. exact approved commit and clean-tree preflight;
2. impact: backup + migration `0017` + backend/frontend rolling recreation;
3. expected results for migration, flags, health, structured card and one inert
   approval;
4. stop conditions for any health, authorization, hash, idempotency or audit
   failure;
5. rollback by disabling both flags and recreating Marketing Ops/Chat Web, never
   dropping the new table;
6. sanitized evidence to return.

Stop after committing the runbook. Do not run SSH, Docker or deploy commands on
the VPS. M6 remains open until the human operator returns production evidence
and this task performs an independent validation pass.

**Commit:** `docs(m6): prepare structured execution production gate`

## Definition of done for the implementation agent

The implementation handoff is ready for independent validation only when:

- all 13 tasks above are completed with commits and test evidence;
- branch is clean and contains no credentials or production data;
- full local and Docker Desktop gates are green;
- code review findings are resolved;
- production runbook is prepared but not executed;
- M6 is still marked incomplete/pending production validation.

The agent must finish with: branch name, commit list, changed-file summary,
commands and exact pass/fail counts, remaining risks, rollback rehearsal result
and the first operator-only checkpoint. It must not merge or push to `main`
unless the responsible human explicitly asks.
