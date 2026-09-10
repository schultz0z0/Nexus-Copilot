# Supabase DDL Ledger Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a deterministic, fail-closed ledger that inventories the active
Supabase SQL and retired service sources without executing them, then validates
an explicit migration decision for every discovered object.

**Architecture:** A Python 3.11 development-only CLI discovers sources under an
explicit read-only legacy root, hashes them, parses active SQL with pinned
`pglast`, classifies every statement and consolidates stable logical object IDs.
Versioned JSON artifacts separate generated source facts from reviewed decisions;
a standard-library verifier and renderer work without the legacy repository.

**Tech Stack:** Python 3.11, `pglast` 8.4 pinned by hashes, `unittest`, JSON,
Docker/Compose, SHA-256.

---

## Constraints

- Work only on `codex/supabase-ddl-ledger` in the isolated worktree.
- Never copy legacy SQL into `infra/postgres/migrations` or version raw SQL in
  generated artifacts.
- Never read `.env`, credentials, dumps or production data.
- Never access the VPS.
- The scanner must fail rather than silently skip a statement.
- The checked-in verifier must work without `pglast` and without the historical
  repository.
- Retired RAG MCP, Graph MCP, Neo4j, fork Hermes and Supabase platform internals
  cannot receive `migrate`.
- Keep the user's untracked `.env.example` in the main checkout untouched.

## Checkpoint A — Safe source discovery

### Task 1: Create the tool contract and source policy

**Files:**

- Create: `tools/supabase-ledger/pyproject.toml`
- Create: `tools/supabase-ledger/src/supabase_ledger/__init__.py`
- Create: `tools/supabase-ledger/src/supabase_ledger/model.py`
- Create: `tools/supabase-ledger/src/supabase_ledger/source_policy.py`
- Create: `tools/supabase-ledger/tests/test_source_policy.py`
- Create: `docs/migration/supabase-ledger/source-policy.json`
- Modify: `package.json`

**Step 1: Write failing tests**

Require the wished-for API:

```python
policy = load_source_policy(policy_path)
snapshot = discover_sources(legacy_root, policy)
self.assertEqual(24, snapshot.critical_source_count)
self.assertTrue(all(not Path(item.path).is_absolute() for item in snapshot.files))
```

Test path traversal, symlinks escaping the root, deterministic order, SHA-256,
missing critical globs and exact classifications `active_sql`, `edge_function`,
`historical_only` and `removed_component`.

**Step 2: Verify RED**

Run:

```text
python -m unittest discover -s tools/supabase-ledger/tests -p "test_*.py"
```

Expected: import failure because the package/API does not exist.

**Step 3: Implement the minimum source model/discovery**

Use immutable dataclasses, POSIX relative paths and streamed SHA-256. Reject
missing roots, absolute globs, `..`, escaping symlinks, duplicate matches and
critical count drift. Do not open excluded non-SQL files beyond hashing.

Policy v1 must explicitly cover:

- 24 active migrations;
- four Edge Function directories;
- `legacy_migrations` and `ignored_migrations` as historical;
- historical `services/rag-mcp` and Neo4j/Graph/Hermes fork paths as removed.

Add root script:

```json
"test:supabase-ledger": "python -m unittest discover -s tools/supabase-ledger/tests -p \"test_*.py\""
```

**Step 4: Verify GREEN**

Run the test command twice. Expected: all discovery tests pass and output order
is stable.

**Step 5: Commit**

```text
git add package.json tools/supabase-ledger docs/migration/supabase-ledger/source-policy.json
git commit -m "feat(inventory): add safe legacy source discovery"
```

## Checkpoint B — PostgreSQL AST and object identities

### Task 2: Pin and isolate the parser dependency

**Files:**

- Create: `tools/supabase-ledger/requirements.lock`
- Create: `tools/supabase-ledger/src/supabase_ledger/sql_parser.py`
- Create: `tools/supabase-ledger/tests/test_sql_parser.py`
- Create: `tools/supabase-ledger/tests/fixtures/sql/parser_cases.sql`

**Step 1: Write failing parser tests**

Test that `parse_statements(sql)` returns node type and byte/character location
for multiline SQL, quoted identifiers and a dollar-quoted function whose body
contains text resembling `CREATE TABLE`.

**Step 2: Verify RED**

Expected: missing `sql_parser` module.

**Step 3: Resolve and pin `pglast==8.4`**

Read PyPI JSON, verify release metadata and create a hash-locked requirements
file containing the supported Windows CPython 3.11 and Linux container artifacts.
Install with:

```text
python -m pip install --require-hashes -r tools/supabase-ledger/requirements.lock
```

Do not invent hashes or allow an unpinned transitive dependency.

**Step 4: Implement the AST adapter**

Keep `pglast` imports inside `sql_parser.py`. Return a small internal structure;
no pglast nodes cross into the rest of the application. Convert parse failures
to sanitized errors containing only relative source and position.

**Step 5: Verify GREEN and commit**

```text
npm run test:supabase-ledger
git add tools/supabase-ledger
git commit -m "feat(inventory): parse PostgreSQL DDL with a pinned AST"
```

### Task 3: Define canonical object IDs

**Files:**

- Create: `tools/supabase-ledger/src/supabase_ledger/object_identity.py`
- Create: `tools/supabase-ledger/tests/test_object_identity.py`

**Step 1: Write failing tests**

Cover unquoted folding, quoted case preservation, schema qualification,
overloaded function signatures, same policy/trigger name on different tables and
deterministic grant privilege ordering.

Example wished-for assertions:

```python
self.assertEqual("table:public.profiles", table_id(["public", "profiles"]))
self.assertNotEqual(function_id(fn_uuid), function_id(fn_text))
self.assertNotEqual(policy_id("a", "p"), policy_id("b", "p"))
```

**Step 2: Verify RED, implement minimally, verify GREEN**

Object ID functions must reject missing schema when it cannot be inferred safely;
no silent `public` default for ambiguous statements.

**Step 3: Commit**

```text
git add tools/supabase-ledger
git commit -m "feat(inventory): define stable PostgreSQL object identities"
```

## Checkpoint C — Fail-closed classification

### Task 4: Classify DDL and consolidate object lifecycle

**Files:**

- Create: `tools/supabase-ledger/src/supabase_ledger/classifier.py`
- Create: `tools/supabase-ledger/src/supabase_ledger/manifest.py`
- Create: `tools/supabase-ledger/tests/test_classifier.py`
- Create: `tools/supabase-ledger/tests/fixtures/sql/ddl_cases.sql`

**Step 1: Write failing tests by behavior**

Separate tests require classification for schema, extension, enum/type, sequence,
table, view, column, constraint, index, function, trigger, policy, RLS state,
grant/revoke, ownership, comment, alter and drop.

Require:

- every parsed statement returns one or more classified operations;
- `CREATE` + `ALTER` + `DROP` consolidate into one logical object with ordered
  provenance;
- source line/location is preserved without raw SQL;
- unknown AST statement type returns `unclassified` and makes manifest creation
  fail.

**Step 2: Verify RED**

Run only `test_classifier.py`; confirm failure is missing behavior, not a parser
installation issue.

**Step 3: Implement one statement family at a time**

After each family, rerun its test. Use explicit dispatch by AST node type. Do not
add a catch-all success branch. Hash each statement slice before discarding it.

**Step 4: Verify all ledger tests and commit**

```text
npm run test:supabase-ledger
git add tools/supabase-ledger
git commit -m "feat(inventory): classify Supabase DDL without silent skips"
```

### Task 5: Detect buckets, jobs, Edge Functions and retired services

**Files:**

- Create: `tools/supabase-ledger/src/supabase_ledger/resources.py`
- Create: `tools/supabase-ledger/tests/test_resources.py`
- Create: `tools/supabase-ledger/tests/fixtures/source-tree/...`

**Step 1: Write failing tests**

Require sanitized extraction of constant bucket IDs from AST-separated inserts,
job mechanism/name without payload, Edge Function directory names and
`removed_component` source records. Dynamic/nonconstant resource IDs must become
review-required operations rather than guessed names.

Test that RAG MCP, Graph/Neo4j and fork Hermes source kinds reject a later
`migrate` action.

**Step 2: Verify RED, implement, verify GREEN**

Use AST expression nodes for literal values. Never scan PL/pgSQL bodies with a
global regex. Hash source content and store only allowlisted identifiers.

**Step 3: Commit**

```text
git add tools/supabase-ledger
git commit -m "feat(inventory): track Supabase resources and retired services"
```

## Checkpoint D — Decisions and portable verification

### Task 6: Generate proposals and validate decisions

**Files:**

- Create: `tools/supabase-ledger/src/supabase_ledger/decisions.py`
- Create: `tools/supabase-ledger/src/supabase_ledger/verify.py`
- Create: `tools/supabase-ledger/tests/test_decisions.py`
- Create: `docs/migration/supabase-ledger/object-decisions.json`

**Step 1: Write failing tests**

Cover rule proposals for IAM, chat, Marketing Ops, Picture, Storage, Supabase
internals, Graph/Neo4j/RAG and generic extensions. Require explicit output row per
object.

Verify failures for missing, duplicate and orphan decisions; `approved+pending`;
retired component with `migrate`; incompatible format; invalid milestone/action;
and manifest source drift.

**Step 2: Verify RED, implement proposal/overlay, verify GREEN**

Rules emit `proposed`, never `approved`. Preserve approved human rows byte-for-
byte semantically when rescanning. Overrides beat group rules and must cite an
allowlisted reason code.

**Step 3: Commit**

```text
git add tools/supabase-ledger docs/migration/supabase-ledger/object-decisions.json
git commit -m "feat(inventory): require a decision for every legacy object"
```

### Task 7: Add deterministic CLI, sanitization and Markdown rendering

**Files:**

- Create: `tools/supabase-ledger/src/supabase_ledger/cli.py`
- Create: `tools/supabase-ledger/src/supabase_ledger/render.py`
- Create: `tools/supabase-ledger/src/supabase_ledger/sanitize.py`
- Create: `tools/supabase-ledger/tests/test_cli.py`
- Create: `tools/supabase-ledger/tests/test_render.py`
- Create: `docs/migration/supabase-ledger/source-manifest.json`
- Create: `docs/migration/supabase-ledger/supabase-object-ledger.md`
- Modify: `package.json`

**Step 1: Write failing tests**

Test `scan`, `verify`, `render`; stable JSON key/order/newline; byte-identical
second scan; Markdown drift; no absolute Windows/POSIX paths; no SQL bodies; and
redaction of common secret formats.

**Step 2: Verify RED, implement minimal CLI, verify GREEN**

CLI must use explicit paths and atomic replacement. `verify` and `render` must
import only the standard library. Add root commands:

```json
"scan:supabase-ledger": "python -m supabase_ledger.cli scan ...",
"verify:supabase-ledger": "python -m supabase_ledger.cli verify ...",
"render:supabase-ledger": "python -m supabase_ledger.cli render ..."
```

Use a small launcher or `PYTHONPATH`-independent module entry so commands work on
PowerShell and POSIX shells.

**Step 3: Commit**

```text
git add package.json tools/supabase-ledger docs/migration/supabase-ledger
git commit -m "feat(inventory): add portable Supabase ledger verification"
```

## Checkpoint E — Real historical scan

### Task 8: Scan the historical project and close classifier gaps

**Files:**

- Modify only as tests require: `tools/supabase-ledger/src/**`
- Add minimal sanitized fixtures for every newly discovered AST family
- Update generated artifacts under `docs/migration/supabase-ledger/`

**Step 1: Run against the explicit historical root**

```text
python tools/supabase-ledger/ledger.py scan --source <historical-root> ...
```

Expected first run: fail with a bounded list of unclassified AST families or
ambiguous resources. It must not print SQL.

**Step 2: For each real gap, add a failing sanitized fixture**

Copy only the minimal SQL shape needed to reproduce parser behavior. Remove
business text, IDs, credentials and function bodies not required by the test.

**Step 3: Implement the classifier case and rerun**

Repeat until all 24 active migrations and four Edge Functions are covered with
`unclassified = 0`. Do not weaken the gate.

**Step 4: Generate candidate decisions**

Review group rules. Explicitly preserve removed-service decisions. Leave
unresolved RAG/auth/storage details as `pending+proposed`; do not fabricate an
ADR decision.

**Step 5: Verify portability**

Temporarily run `verify` with no source argument and confirm it uses committed
manifest/decisions only. Run scan twice and compare SHA-256 of outputs.

**Step 6: Commit**

```text
git add tools/supabase-ledger docs/migration/supabase-ledger
git commit -m "data(inventory): record the sanitized Supabase DDL ledger"
```

## Checkpoint F — Reproducible development container

### Task 9: Add Docker parity for the scanner

**Files:**

- Create: `tools/supabase-ledger/Dockerfile`
- Create: `tools/supabase-ledger/compose.yaml`
- Create: `tools/supabase-ledger/.dockerignore`
- Create: `tools/supabase-ledger/tests/test_container_contract.py`
- Create: `tools/supabase-ledger/README.md`
- Modify: `package.json`

**Step 1: Write failing container contract tests**

Require Python 3.11 image with tag+digest, non-root user, hash-locked install,
read-only source mount, no production networks/secrets, explicit entrypoint and
no copied historical SQL.

**Step 2: Verify RED**

Expected: Docker files missing.

**Step 3: Resolve real image digest and implement**

Resolve an official supported Python 3.11 slim image; record the observed digest.
Build, run unit tests in container, run offline `verify`, and scan with source
mounted read-only and network disabled after build.

**Step 4: Verify GREEN and commit**

```text
npm run test:supabase-ledger
docker compose -f tools/supabase-ledger/compose.yaml build --pull
docker compose -f tools/supabase-ledger/compose.yaml run --rm ledger test
docker compose -f tools/supabase-ledger/compose.yaml run --rm --network none ledger verify
git add package.json tools/supabase-ledger
git commit -m "build(inventory): containerize the offline DDL ledger"
```

## Checkpoint G — Documentation and final gates

### Task 10: Record evidence and update migration state

**Files:**

- Modify: `docs/migration/supabase-capability-inventory.md`
- Modify: `docs/migration/roadmap.md`
- Modify: `docs/README.md`
- Modify: `docs/plans/2026-09-10-supabase-ddl-ledger-implementation.md`

Document exact counts by source/object/operation, parser/container pins, pending
decision counts, tests, known limitations and next safe command. Do not mark M3
complete while decisions, backup/restore and domain migrations remain open.

### Task 11: Run final verification

Run and record:

1. `npm run test:supabase-ledger`;
2. `npm run verify:supabase-ledger` without historical root;
3. ledger Docker build/test/verify;
4. real-source scan twice with byte equality;
5. `npm run test:postgres`;
6. `npm run test:postgres:integration`;
7. `npm run typecheck`;
8. `git diff --check`;
9. secret/path scan across new artifacts;
10. `git status --short` and Docker resource check.

The known full Marketing Ops baseline remains separately documented; do not copy
old migrations to make it green.

### Task 12: Review and publish

1. Commit evidence: `docs: record Supabase DDL ledger evidence`.
2. Review `git diff origin/main...HEAD` for raw SQL, secrets, absolute paths and
   accidental reintroduction of removed services.
3. Integrate by fast-forward into local `main`, preserving `.env.example`.
4. Rerun `verify:supabase-ledger` and ledger unit tests on `main`.
5. Push `main` to `origin/main` only when all gates for this lot pass.
6. Remove only the clean worktree owned by this plan.

## Execution state

| Checkpoint | State | Evidence |
| --- | --- | --- |
| Design | Complete | `3c73a9d` |
| A — sources | Complete | safe policy/discovery, 87 classified records; `4d34dfb` |
| B — AST/identity | Complete | pinned parser and stable IDs; `e3c633e`, `bb72cdb` |
| C — classification | Complete | fail-closed DDL/resources classifier; `4108d97`, `a683fb7` |
| D — decisions/report | Complete | decision verifier `33e0a36`; portable CLI/report `471fc19` |
| E — real scan | Complete | 87 sources, 2,904 operations, 2,672 objects, zero unclassified; `ebaf727` |
| F — container | Complete | Python 3.11.16 digest pin, 39 Linux tests and offline scan/verify; `6ed0e5a`, `d37a700` |
| G — final gates | Complete | all Task 11 gates passed locally; production untouched |

### Checkpoint after Tasks 4–6 — 2026-09-10

- The classifier fails closed on unknown AST families and does not retain SQL
  bodies in its manifest model.
- Buckets, scheduled jobs, Edge Functions and explicitly retired service sources
  receive stable, sanitized identities.
- Decision proposals cover the approved local-service boundaries and are always
  emitted as `proposed`, never `approved`.
- Verification rejects source drift, missing/duplicate/orphan rows, invalid
  action or milestone, unapproved reason codes, `approved+pending`, and attempts
  to migrate retired components.
- Evidence: 27 ledger unit tests passed; one symlink-escape test was skipped on
  this Windows host because symlink creation was unavailable. The non-symlink
  path-escape controls passed.
- `object-decisions.json` is intentionally not bootstrapped with empty data. It
  will be atomically generated in Task 7 from the matching deterministic source
  manifest, preventing a stale or misleading checked-in overlay.

**Next safe command at that checkpoint:** start Task 7 with failing deterministic CLI, sanitization
and renderer tests; materialize the manifest and decisions only as one matched
digest pair.

### Checkpoint after Tasks 7–9 — 2026-09-10

- The Windows and Linux scans produced byte-identical manifest, decisions and
  Markdown report. The Linux scan ran with no network and a read-only legacy
  mount.
- Offline verification passed under `python -S`, proving it does not require
  `pglast` or the historical repository.
- Proposal totals: 1,542 `transform`, 60 `remove`, 1,070 `pending`; all 2,672
  rows remain `proposed` and therefore require human review.
- No retired component received `migrate`; Graph/Neo4j technology remains
  removed and RAG remains pending its ADR.
- Container evidence: 39 tests passed on Linux, including the symlink escape
  test unavailable on the Windows host. No ledger container remained running.
- Existing dependency audit debt observed during lockfile installation, outside
  this ledger change: chat frontend reported 9 advisories (1 low, 5 moderate,
  3 high); Marketing Ops reported 8 (6 moderate, 2 high). No automatic upgrade
  was applied because that would change unrelated dependency versions.

### Final gate evidence — 2026-09-10

- `npm run test:supabase-ledger`: 39 tests passed locally; the Windows-only run
  skipped one symlink-creation case. The same suite passed 39/39 in Linux.
- `python -S ... verify`: passed without `site-packages` or historical source.
- Docker build, test, verify and real-source scan passed with no network,
  read-only root filesystem and read-only legacy mount.
- Two consecutive real scans were byte-identical and matched the committed
  artifacts. SHA-256: manifest `3c5e5e4102aa9fce070c3ae98584f7cb591eb324480036516e11d445f13774a0`,
  decisions `0d10ac3f9a43d06a52a35d53ea400d09816832344a116df584d4bdb68cc722d3`,
  report `e5336d81d54ec3f31b754ab9067ffd94fb43caa2a5e9461b4dd075e7d9582049`.
- `npm run test:postgres`: 12 contract tests and 9 migration-runner tests
  passed. `npm run test:postgres:integration`: 5 integration tests passed
  against the Docker runtime.
- `npm run typecheck`: chat frontend and Marketing Ops passed after reproducible
  `npm ci` installation; package manifests and lockfiles were unchanged.
- The additional root `npm test` check confirmed 147/147 frontend tests, then
  stopped in the known non-hermetic Marketing Ops baseline: tests reference
  intentionally uncopied Supabase migrations, the absent legacy database on
  port 55322, the retired root Compose and time-bound legacy delegations. Those
  dependencies were not recreated. Run separately, Chat Bridge passed 124/124
  and Artifact Server passed 13/13.
- Branch diff/check and the generated-artifact safety scan found no credential,
  absolute path, raw SQL body or accidental `migrate` decision for a retired
  component. No ledger container remained active.
- No VPS, production network, production database or external Supabase service
  was accessed.

**Next safe command:** fast-forward local `main`, rerun offline verification and
unit tests there, then push `main` to `origin/main`.
