# M6 Plan Receipts and Sequential Planning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep executed Marketing Ops plans as durable receipts in chat and allow a new independently authorized plan later in the same chat without textual reauthorization.

**Architecture:** Extend the existing actor-scoped plan listing with an explicit bounded `status=all` view and a sanitized persisted execution result. The Chat Web renders those server-owned records through the existing `AgentPlanCard`. Update only the ENS profile skill and Chat Bridge system contract to explain sequential Runs; do not change Hermes core, delegation TTLs, token issuance, confirmation, or approval authorization.

**Tech Stack:** Node.js 22, TypeScript, Express, PostgreSQL, React 18, TanStack Query, Vitest, Testing Library, Playwright, Hermes Profile Distribution.

---

### Task 1: Lock the sequential-plan contract with failing tests

**Files:**
- Modify: `services/chat-bridge/test/hermes-payloads.test.js`
- Modify: `test/hermes/distribution-contract.test.mjs`

**Step 1: Write the failing Chat Bridge contract test**

Extend the existing `NEXUS_MARKETING_OPS_OPERATOR_CONTRACT` test to require language that states:

```js
assert.match(NEXUS_MARKETING_OPS_OPERATOR_CONTRACT, /novo pedido.*mesmo chat.*novo Run/i);
assert.match(NEXUS_MARKETING_OPS_OPERATOR_CONTRACT, /referencia opaca.*Run atual/i);
assert.match(NEXUS_MARKETING_OPS_OPERATOR_CONTRACT, /nao.*autoriza.*plano seguinte/i);
assert.match(NEXUS_MARKETING_OPS_OPERATOR_CONTRACT, /nao peca.*autoriza.*novamente.*texto/i);
```

The assertions may use equivalent stable fragments, but must cover all four invariants.

**Step 2: Write the failing distribution test**

Read the packaged `marketing-ops-operator/SKILL.md` fixture and assert that it declares:

- sequential plans are allowed in the same chat after the prior plan is terminal;
- a current pending plan is revised/replaced instead of creating a concurrent executable plan;
- only a real current-Run delegation error may be reported as invalid authorization;
- history credentials/references are never reused.

Also assert distribution version `0.1.3` and skill version `1.3.3`.

**Step 3: Run the tests to verify RED**

Run:

```bash
npm --prefix services/chat-bridge test -- --test-name-pattern="NEXUS_MARKETING_OPS_OPERATOR_CONTRACT"
node --test test/hermes/distribution-contract.test.mjs
```

Expected: FAIL because version `0.1.2`/`1.3.2` and the sequential-plan wording is absent.

**Step 4: Record the observed baseline**

Reference the production homologation evidence in the design/operations docs: with the old skill, Hermes incorrectly asked for renewed textual authorization; after user insistence, the same backend accepted a second plan. This is the RED scenario required for the skill edit.

---

### Task 2: Implement the minimal profile and Bridge contract correction

**Files:**
- Modify: `agents/ens/skills/marketing-ops-operator/SKILL.md`
- Modify: `agents/ens/skills/marketing-ops-operator/references/conversation-safety.md`
- Modify: `agents/ens/distribution.yaml`
- Modify: `services/chat-bridge/src/hermes-payloads.js`

**Step 1: Add the sequential-plan rule to the skill**

Add a concise subsection after the conversation contract:

```markdown
### Sequential plans in one chat

A terminal plan ends only that plan, not the chat's ability to plan. A later
user mutation starts a new Run, uses only the opaque reference injected for
that Run, reads current state, and prepares a new plan with a new button click.
The earlier result is context, never authorization.

If a plan is still pending, revise/replace it through prepare-plan; do not
create or claim a second concurrently executable plan. Never ask for textual
reauthorization or infer expired delegation from history. Report delegation
failure only when the current MCP call returns that sanitized failure.
```

Do not add execution permission or any credential format.

**Step 2: Align the conversation-safety reference**

Clarify that `No prepared plan exists` means normal conversation, including a new mutation request in the same chat. Add recovery language that terminal history does not block a fresh plan and does not authorize it.

**Step 3: Align the injected Bridge contract**

Add equivalent pt-BR instructions to `NEXUS_MARKETING_OPS_OPERATOR_CONTRACT`. Explicitly distinguish a new Run/current opaque reference from history and prohibit asking for textual reauthorization unless the current MCP call fails delegation.

**Step 4: Bump auditable versions**

- `agents/ens/distribution.yaml`: `0.1.2` -> `0.1.3`
- `marketing-ops-operator/SKILL.md`: `1.3.2` -> `1.3.3`

**Step 5: Run the focused tests to verify GREEN**

Run the two commands from Task 1.

Expected: PASS.

**Step 6: Validate the packaged profile**

Run:

```bash
npm run validate:hermes-profile
npm run test:hermes
```

Expected: PASS with no core Hermes files introduced.

---

### Task 3: Add a safe bounded plan-receipt read model with TDD

**Files:**
- Modify: `services/marketing-ops/src/plans/contracts.ts`
- Modify: `services/marketing-ops/src/plans/repository.ts`
- Modify: `services/marketing-ops/src/plans/repository.test.ts`
- Modify: `services/marketing-ops/src/plans/service.ts`
- Modify: `services/marketing-ops/src/plans/service.test.ts`
- Modify: `services/marketing-ops/src/http/routes/agentPlans.ts`
- Modify: `services/marketing-ops/src/http/routes/agentPlans.test.ts`
- Modify: `services/marketing-ops/openapi/marketing-ops.v1.yaml`

**Step 1: Write failing repository tests**

Add tests proving a general recent-plan query:

- opportunistically expires stale pending records before selection;
- scopes by `tenant_id`, `prepared_by`, and optional `chat_session_id`;
- accepts an optional real status filter;
- with no status filter returns pending and terminal records ordered by `created_at DESC`;
- caps `limit` at 50.

The SQL assertions must prove no cross-actor or cross-tenant widening.

**Step 2: Verify repository RED**

Run:

```bash
npm --prefix services/marketing-ops test -- src/plans/repository.test.ts
```

Expected: FAIL because the general recent-plan repository method does not exist.

**Step 3: Implement the repository query**

Add `listRecent(actor, chatSessionId, status, limit)` using `withActorTransaction`. Keep `listPending` behavior intact for compatibility, or make it a wrapper whose observable SQL/security behavior remains covered.

**Step 4: Write failing DTO/service tests**

Require the safe summary to contain:

```ts
{
  id,
  planHash,
  status,
  expiresAt,
  actions,
  requiredScopes,
  result,
  executedAt,
  createdAt,
  updatedAt
}
```

Test a persisted completed result with `completed`, `failed`, `pending`, and `deep_links`. Assert absence of `tenantId`, `preparedBy`, `sourceRunId`, `preparedDelegationJti`, `executionKey`, `executedBy`, and raw unexpected result fields.

**Step 5: Verify service RED**

Run:

```bash
npm --prefix services/marketing-ops test -- src/plans/service.test.ts
```

Expected: FAIL because terminal result/timestamps and `status=all` are not exposed.

**Step 6: Implement a sanitized result projection**

Add a closed schema/projection for the existing execution result fields. Legacy `null` remains `null`; unknown fields are stripped or rejected according to existing fail-closed conventions. Route `pending` through the existing behavior and `all` through the general recent query.

**Step 7: Write failing route tests**

Test:

- omitted status still becomes `pending`;
- `status=all` is accepted and mapped to the service's all-status filter;
- unknown statuses fail validation;
- limit remains bounded.

**Step 8: Implement and document `status=all`**

Extend the query parser and OpenAPI enum without changing the default. Do not change App API authentication or delegation behavior.

**Step 9: Verify GREEN**

Run repository, service, and route test files, then:

```bash
npm --prefix services/marketing-ops run typecheck
```

Expected: PASS.

---

### Task 4: Propagate the receipt contract through the client and BFF

**Files:**
- Modify: `apps/chat-web/src/lib/marketingOps/types.ts`
- Modify: `apps/chat-web/src/lib/marketingOps/client.ts`
- Modify: `apps/chat-web/src/lib/marketingOps/client.test.ts`
- Modify: `services/app-api/test/marketing.test.js` only if the existing generic proxy test does not already prove query preservation for `status=all`

**Step 1: Write failing client tests**

Test that `listAgentPlans(sessionId, 'all', 10)` requests:

```text
/api/marketing/agent-plans?chat_session_id=<uuid>&status=all&limit=10
```

and accepts sanitized receipt fields. Keep the existing pending call compatible.

**Step 2: Verify RED**

Run:

```bash
npm --prefix apps/chat-web test -- src/lib/marketingOps/client.test.ts
```

Expected: FAIL because the client type excludes `all` and has no limit argument.

**Step 3: Implement the client types and request**

Add `MarketingOpsPreparedPlanListStatus = MarketingOpsPreparedPlanStatus | 'all'`, the safe result/timestamps in `MarketingOpsPreparedPlanSummary`, and an optional bounded limit in `listAgentPlans`.

**Step 4: Confirm BFF preservation**

If the current App API proxy test already proves arbitrary query preservation, extend that fixture to `status=all&limit=10`; otherwise add one focused test. No production BFF code should be necessary.

**Step 5: Verify GREEN**

Run the focused client and App API marketing tests.

---

### Task 5: Render durable terminal receipts with TDD

**Files:**
- Modify: `apps/chat-web/src/components/marketing-ops/agentPlanPresentation.ts`
- Modify: `apps/chat-web/src/components/marketing-ops/agentPlanPresentation.test.ts`
- Modify: `apps/chat-web/src/components/marketing-ops/AgentPlanCard.tsx`
- Modify: `apps/chat-web/src/components/marketing-ops/AgentPlanCard.test.tsx`

**Step 1: Write failing presentation tests**

Add exact pt-BR labels and semantic tones:

- `completed`: `Concluído`, success;
- completed with pending approval: `Enviado para aprovação`, info/success treatment;
- `partial`: `Concluído parcialmente`, warning;
- `failed`: `Falhou`, destructive;
- `expired`: `Expirado`, muted/warning;
- `invalidated`: `Substituído`, muted.

**Step 2: Write failing card tests**

For persisted terminal plans loaded directly from props, verify:

- terminal receipt renders without any local click;
- no `Executar plano` button exists;
- completion time uses `executedAt` when present;
- approved-submission result shows the pending-approval message;
- only server-returned `deep_links` become links;
- partial/failed counts and sanitized messages are visible;
- missing legacy result still shows an honest status receipt;
- live transition keeps a stable status region and calls `onExecuted` once.

**Step 3: Verify RED**

Run:

```bash
npm --prefix apps/chat-web test -- src/components/marketing-ops/agentPlanPresentation.test.ts src/components/marketing-ops/AgentPlanCard.test.tsx
```

Expected: FAIL because persisted result/timestamps are not rendered.

**Step 4: Implement the receipt UI**

Reuse the existing card, badges, iconography, spacing, and focus styles. Derive presentation from `plan.result` first and local mutation result only during the immediate transition. Keep feedback inline with an accessible status region. Keep button dimensions stable during execution and remove it from terminal states.

Do not add a second card component, native dialog, or toast-only success.

**Step 5: Verify GREEN and accessibility**

Run the focused tests and inspect that every link/button has an accessible name and terminal states have no false affordance.

---

### Task 6: Fetch recent plans and preserve receipts across refetch/reload

**Files:**
- Modify: `apps/chat-web/src/components/ChatInterface.tsx`
- Modify: `apps/chat-web/src/components/ChatInterface.agentPlans.test.tsx`
- Modify: `apps/chat-web/e2e/helpers/hermesOperatorFake.ts`
- Modify: `apps/chat-web/e2e/helpers/hermesOperatorFixtures.ts`
- Modify: `apps/chat-web/e2e/structured-plan-execution.spec.ts`

**Step 1: Write failing ChatInterface tests**

Require the interface to:

- query `listAgentPlans(sessionId, 'all', 10)` when structured execution is enabled;
- render pending and terminal plans from the same server response;
- replace/update the just-executed plan in cache immediately;
- invalidate/refetch the `all` query after execution;
- keep the terminal card after the refetch returns it;
- treat an empty message list with only receipts as non-empty content.

**Step 2: Verify RED**

Run:

```bash
npm --prefix apps/chat-web test -- src/components/ChatInterface.agentPlans.test.tsx
```

Expected: FAIL because the interface only requests and invalidates `pending`.

**Step 3: Implement the all-status query and cache transition**

Use one bounded query key for `all`. On execution, merge the returned sanitized result into the matching cached plan before invalidation so success cannot disappear during refetch. Render the ordered plan list through the existing card location.

**Step 4: Add E2E receipt persistence**

Update the fake to persist a terminal result after execution. Assert the card shows its terminal receipt, no execute button, and remains after `page.reload()`.

**Step 5: Verify GREEN**

Run focused component tests and:

```bash
npm --prefix apps/chat-web run e2e -- structured-plan-execution.spec.ts
```

Expected: PASS.

---

### Task 7: Establish durable design context without changing visual tokens

**Files:**
- Create: `DESIGN.md`

**Step 1: Inventory the existing canonical UI**

Record the established ENS/Nexus visual language from the current app tokens, `AgentPlanCard`, approval cards, buttons, typography, spacing, semantic tones, focus treatment, responsive layout, and pt-BR copy.

**Step 2: Create the project design context**

Document existing runtime token ownership and the receipt-card state contract. State explicitly that this task introduces no palette, typography, radius, or spacing change; it extends an existing canonical component.

**Step 3: Run the premium static audit**

Run:

```bash
python "C:/Users/rapha/.codex/plugins/cache/openai-curated-remote/frontend-design-premium/1.4.0/skills/frontend-design-premium/scripts/audit_project.py" . --mode strict
```

Classify pre-existing findings separately. Fix blocking findings introduced by this work.

---

### Task 8: Update M6 operational documentation and roadmap

**Files:**
- Modify: `docs/operations/m6-marketing-ops-cutover.md`
- Modify: `docs/migration/roadmap.md`
- Modify: `docs/README.md` if the new design/implementation docs are indexed there

**Step 1: Record the diagnosed causes and implemented contracts**

Document:

- old pending-only frontend query;
- old ambiguous same-chat planning instruction;
- profile `0.1.3` / skill `1.3.3` rollout boundary;
- no migration, TTL, core Hermes, or authorization changes;
- one-pending-plan and fresh-Run invariants.

**Step 2: Add the VPS checkpoint**

Provide stage-by-stage operator commands with impact, expected result, stop condition, and rollback for:

1. source sync;
2. image build and rollback tags;
3. Marketing Ops, Chat Bridge, App API only if changed, Chat Web recreation;
4. profile update and Hermes recreation;
5. technical smoke;
6. manual same-chat two-plan homologation and receipt reload.

Do not include secrets or direct SSH actions.

**Step 3: Keep M6 open until production evidence exists**

Mark local implementation complete only after verification. Mark M6 complete only after the operator returns the final VPS/browser evidence.

---

### Task 9: Full verification and release candidate commit

**Files:**
- Verify all modified files

**Step 1: Run formatting/static checks**

```bash
git diff --check
npm --prefix apps/chat-web run lint
npm run validate:hermes-profile
```

**Step 2: Run typechecks and builds**

```bash
npm run typecheck
npm run build
```

**Step 3: Run all relevant suites**

```bash
npm run test:chat-web
npm run test:marketing-ops
npm run test:chat-bridge
npm run test:app-api
npm run test:hermes
npm run test:app:contract
```

**Step 4: Run the browser matrix locally**

Exercise with Docker Desktop or the isolated stack:

- pending -> busy -> completed;
- completed with pending approval;
- partial, failed, expired, invalidated;
- page reload persistence;
- second plan in the same chat with a fresh Run/ref and new click;
- keyboard focus and a narrow viewport;
- no concurrent executable cards.

**Step 5: Review security invariants**

Search browser DTOs, logs, tests, and diffs for `delegation_token`, `plan_token`, JTI, execution keys, secrets, direct Hermes/browser calls, and accidental Supabase/Graph/Neo4j additions.

**Step 6: Commit and push**

After all evidence is fresh:

```bash
git add <changed files>
git commit -m "feat(m6): persist plan receipts across chat runs"
git push origin main
```

Expected: clean tree, `main` equals `origin/main`, and the final commit hash is recorded in the cutover runbook.
