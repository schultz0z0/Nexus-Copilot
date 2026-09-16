# M6 Opaque Marketing Ops Delegation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the real Marketing Ops delegation JWT outside Hermes model context by exchanging a short per-Run opaque reference through an authenticated Bridge-to-Marketing-Ops flow.

**Architecture:** Chat Bridge owns an in-memory, hash-indexed registry of short delegation references bound to active Runs. Marketing Ops resolves a `mopref_...` value through a private authenticated Bridge endpoint, then applies the unchanged JWT verifier; direct signed JWT input remains available for compatibility automation. The browser execution button and persisted plan authority remain unchanged.

**Tech Stack:** Node.js 22, JavaScript `node:test`, TypeScript, Vitest, JOSE, Docker Compose, native Hermes MCP profile.

**Status em 2026-09-16:** Tasks 1–6 implementadas em TDD. Registro opaco sem
retenção do valor bruto, resolução interna autenticada, leitura de resposta com
limite durante o streaming, verificação JWT posterior, Compose, profile
`ens@0.1.2` e documentação passaram nos testes focados. As suítes integrais,
builds e ensaio descartável da Task 7 passaram; restam somente integração em
`main`, push e homologação humana pelo Checkpoint 6.

---

### Task 1: Add the ephemeral reference registry

**Files:**
- Modify: `services/chat-bridge/test/marketing-ops-delegation.test.js`
- Modify: `services/chat-bridge/src/marketing-ops-delegation.js`

**Step 1: Write failing tests.**

Add focused tests proving that the wished-for registry:

- emits a `mopref_` value shorter than 80 characters;
- returns the same reference for repeated issuance for one Run;
- stores/looks up by digest rather than exposing claims;
- rejects malformed, unknown and expired references;
- revokes a reference by Run ID;
- never includes the Run ID or JWT segments in the reference.

**Step 2: Verify RED.**

Run:

```bash
npm --prefix services/chat-bridge test -- --test-name-pattern="opaque marketing ops delegation reference"
```

Expected: FAIL because `createMarketingOpsDelegationReferenceRegistry` is not exported.

**Step 3: Implement the minimum registry.**

Use `randomBytes(18)`, SHA-256 indexing, an injected clock/random source, a
per-Run reverse index and opportunistic expiry cleanup. Do not log or persist
the raw reference.

**Step 4: Verify GREEN and refactor.**

Run the focused command and then:

```bash
npm --prefix services/chat-bridge test
```

Expected: all Chat Bridge tests pass.

**Step 5: Commit.**

```bash
git add services/chat-bridge/src/marketing-ops-delegation.js services/chat-bridge/test/marketing-ops-delegation.test.js
git commit -m "feat(m6): add opaque delegation reference registry"
```

### Task 2: Resolve references inside the Chat Bridge

**Files:**
- Modify: `services/chat-bridge/test/server-runtime-scope.test.js`
- Modify: `services/chat-bridge/src/server.js`
- Modify: `services/chat-bridge/src/hermes-payloads.js`
- Modify: `services/chat-bridge/test/marketing-ops-delegation.test.js`

**Step 1: Write failing contract tests.**

Prove that:

- Hermes payloads receive `mopref_...`, not a value with three JWT segments;
- `POST /internal/marketing-ops/delegations/resolve` requires the existing
  internal refresh key;
- the route resolves the reference, loads its Run, requires `running`, and
  emits a freshly signed JWT through `issueRunMarketingOpsDelegation`;
- Run finalization revokes the reference;
- route errors are generic and never echo the reference.

**Step 2: Verify RED.**

```bash
npm --prefix services/chat-bridge test -- --test-name-pattern="delegation reference|delegations resolve"
```

Expected: FAIL because the route/lifecycle do not exist and payloads still carry JWTs.

**Step 3: Implement the minimum Bridge wiring.**

Instantiate one registry, issue an idempotent reference for each browser Run,
use the reference in Hermes request builders, add the authenticated internal
resolve route and revoke in the existing Run cleanup boundary. Keep the current
refresh endpoint unchanged.

**Step 4: Verify GREEN.**

```bash
npm --prefix services/chat-bridge test
```

Expected: all tests pass without printing credentials.

**Step 5: Commit.**

```bash
git add services/chat-bridge/src/server.js services/chat-bridge/src/hermes-payloads.js services/chat-bridge/test
git commit -m "feat(m6): resolve opaque delegations in chat bridge"
```

### Task 3: Add the Marketing Ops reference resolver

**Files:**
- Create: `services/marketing-ops/src/delegation/resolver.ts`
- Create: `services/marketing-ops/src/delegation/resolver.test.ts`
- Modify: `services/marketing-ops/src/config.ts`
- Modify: `services/marketing-ops/src/index.ts`

**Step 1: Write failing client tests.**

Test successful resolution and fail-closed handling for timeout, network error,
401/403/404/409, 5xx, oversized/invalid JSON and missing JWT. Assert that the
request uses only `delegation_reference` and `x-internal-key`.

**Step 2: Verify RED.**

```bash
npm --prefix services/marketing-ops test -- src/delegation/resolver.test.ts
```

Expected: FAIL because `createDelegationResolver` does not exist.

**Step 3: Implement the minimum resolver and configuration.**

Add `MARKETING_OPS_DELEGATION_RESOLVE_URL`, defaulting to the internal Bridge
route in Compose only, and reuse `MARKETING_OPS_INTERNAL_KEY`. Enforce the same
short timeout and bounded response rules as the refresh client.

**Step 4: Verify GREEN.**

```bash
npm --prefix services/marketing-ops test -- src/delegation/resolver.test.ts
npm --prefix services/marketing-ops run typecheck
```

Expected: focused tests and typecheck pass.

**Step 5: Commit.**

```bash
git add services/marketing-ops/src/delegation services/marketing-ops/src/config.ts services/marketing-ops/src/index.ts
git commit -m "feat(m6): add delegation reference resolver"
```

### Task 4: Resolve opaque credentials before JWT verification

**Files:**
- Modify: `services/marketing-ops/src/delegation/verifier.ts`
- Modify: `services/marketing-ops/src/mcp.test.ts`

**Step 1: Write failing verifier/MCP tests.**

Prove that a `mopref_...` credential is resolved exactly once and then receives
all current JWT, membership and scope validation. Prove that direct JWT
compatibility remains, malformed references fail closed, and a resolver cannot
bypass scope checks.

**Step 2: Verify RED.**

```bash
npm --prefix services/marketing-ops test -- src/mcp.test.ts
```

Expected: FAIL because the verifier tries to parse the reference as a JWT.

**Step 3: Implement the minimum verifier branch.**

Resolve only the strict `mopref_` format. Never decode reference contents or
fall back from an invalid JWT to reference resolution. Feed the returned JWT
through the existing single verification path.

**Step 4: Verify GREEN and regression.**

```bash
npm --prefix services/marketing-ops test -- src/mcp.test.ts
npm --prefix services/marketing-ops test
npm --prefix services/marketing-ops run typecheck
```

Expected: all Marketing Ops tests and typecheck pass.

**Step 5: Commit.**

```bash
git add services/marketing-ops/src/delegation/verifier.ts services/marketing-ops/src/mcp.test.ts
git commit -m "fix(m6): keep delegation jwt outside hermes context"
```

### Task 5: Wire Compose and profile guidance

**Files:**
- Modify: `infra/app/compose.yaml`
- Modify: `test/app/compose-contract.test.mjs`
- Modify: `agents/ens/skills/marketing-ops-operator/SKILL.md`
- Modify: `agents/ens/skills/marketing-ops-operator/references/diagnostics.md`

**Step 1: Write failing Compose/profile tests.**

Require the Marketing Ops container to receive the internal resolve URL, keep
the Bridge private, and prohibit a raw JWT-shaped delegation in the Hermes
payload fixture/contract.

**Step 2: Verify RED.**

```bash
npm run test:app:contract
npm run validate:hermes-profile
```

Expected: the new Compose assertion fails before wiring.

**Step 3: Add configuration and operator guidance.**

Document that `delegation_token` is an opaque per-turn reference, must be copied
unchanged, and authorization failure must not be described specifically as
expiry unless the server says so.

**Step 4: Verify GREEN.**

```bash
npm run test:app:contract
npm run validate:hermes-profile
```

Expected: both commands pass.

**Step 5: Commit.**

```bash
git add infra/app/compose.yaml test/app/compose-contract.test.mjs agents/ens
git commit -m "chore(m6): wire opaque delegation resolution"
```

### Task 6: Update M6 durable documentation

**Files:**
- Modify: `docs/decisions/ADR-0004-structured-marketing-ops-plan-execution.md`
- Modify: `docs/plans/2026-09-14-structured-marketing-ops-plan-execution-design.md`
- Modify: `docs/plans/2026-09-13-m6-marketing-ops-and-cutover-design.md`
- Modify: `docs/migration/roadmap.md`
- Modify: `docs/README.md`
- Modify: `docs/operations/m6-marketing-ops-cutover.md`

**Step 1: Record the sanitized incident and status.**

Record the three fingerprints, lengths and changed claim classes without any
raw credential. Mark the previous `f2a598f` production gate blocked and explain
that M6 remains incomplete.

**Step 2: Update the new rollout gate.**

Require a fresh release, rebuilding only Chat Bridge and Marketing Ops, a new
chat session, proof that stored Hermes messages contain `mopref_` but no JWT,
successful inert plan preparation, card execution and exactly one pending
approval.

**Step 3: Check links and whitespace.**

```bash
git diff --check
rg -n "opaque|mopref|8d8aa0d20c32f2f2|ea9e310df5df11a3" docs
```

Expected: no whitespace errors and all durable documents point to this design.

**Step 4: Commit.**

```bash
git add docs
git commit -m "docs(m6): record delegation integrity blocker"
```

### Task 7: Full verification and release handoff

**Files:**
- Modify if evidence changes: `docs/operations/m6-marketing-ops-cutover.md`

**Step 1: Run focused suites.**

```bash
npm --prefix services/chat-bridge test
npm --prefix services/marketing-ops test
npm --prefix services/marketing-ops run typecheck
npm run test:app:contract
npm run validate:hermes-profile
```

Expected: all pass.

**Step 2: Run repository regression suites.**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all pass.

**Step 3: Run isolated Docker verification.**

```bash
npm run test:stack:isolated
```

Expected: clean PostgreSQL/app/Hermes rehearsal passes and confirms no JWT is
stored in Hermes messages for the tested Run.

**Step 4: Review the complete diff and repository state.**

```bash
git diff main...HEAD --check
git status --short
git log --oneline --decorate main..HEAD
```

Expected: only planned files differ and the tree is clean.

**Step 5: Merge to `main` and push only after verification.**

Use a fast-forward merge from the primary checkout, verify `main` equals
`origin/main` plus the reviewed commits, then push. Do not issue VPS commands
until the pushed release hash is recorded in the runbook.
