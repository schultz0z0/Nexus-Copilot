# Unified Marketing Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the approved four-tab marketing hub with real organic/campaign insights and direct integrated work.

**Architecture:** Reuse the existing BFF, forced RLS, canonical roles and independent integration services. Preserve full GA4 channel measurements in JSON snapshots and read an explicit organic scope. Compose existing views with lazy tab queries, URL filters and source-specific failures; no provider calls on GET, schema migrations or external writes on navigation.

**Tech Stack:** TypeScript, React, TanStack Query, Recharts, PostgreSQL, existing Prometeus primitives.

---

Approved specification: `2026-10-02-unified-marketing-dashboard-design.md`.
Execute in the current clean feature branch, using independent file ownership.
No additional design approval needed. Apply @test-driven-development and
@verification-before-completion, with an independent review before merging.

### Task 1: Organic read model

Files: `services/marketing-ops/src/integrations/analytics/{providers,types}.ts`,
`services/marketing-ops/src/domain/{webAnalytics,webAnalyticsContracts}.ts`,
`services/marketing-ops/src/http/routes/webAnalytics.ts` and their tests;
`apps/chat-web/src/lib/marketingOps/analytics.ts` and its client tests.

1. Add RED tests asserting `sessionDefaultChannelGroup` and retained channel metrics,
   organic-only totals, known zero, legacy unknown, partial fallback, wrong-provider
   rejection and strict HTTP query forwarding. Use real PostgreSQL for aggregation/IAM.
2. Run provider/contracts/HTTP tests: `rtk proxy npm --prefix services/marketing-ops test -- src/integrations/analytics/providers.test.ts src/domain/webAnalyticsContracts.test.ts src/http/routes/webAnalytics.test.ts`.
3. Implement optional `scope=organic` GET input and client third argument `organic`;
   extend query keys with scope. Reuse snapshot payloads without a SQL migration.
   Never derive engagement/key events from global totals for organic scope.
4. GREEN tests and backend typecheck. Full isolated PostgreSQL verification is shared
   after independent work: `rtk proxy node scripts/test-repository-with-postgres.mjs --marketing-ops-only`.

### Task 2: Dashboard shell and embedded views

Files: `apps/chat-web/src/pages/marketing-ops/LiveMarketingDashboard.tsx`, its tests,
new dashboard organic/campaign/site components and tests. Reuse
`LeadResultsView`, `WebAnalyticsResults`, `WorkspaceWorkbench`, existing clients.

1. Add RED tests for four tabs, URL dates/campaign/provider/service, source errors
   preserving other sections, no auto-sync and role-appropriate queries.
2. Run focused frontend tests with `--maxWorkers=1`.
3. Keep overview at four KPIs/two charts; add insights and compact source entry points.
   Embed organic Search Console/GA4 reads, campaign UTM results and site/Clarity
   detail disclosure; work services embed without an extra sidebar.
4. Queries load on demand and preserve dates; dates must not silently clamp.
   Show exact Clarity window and safe unavailable states. Refresh is explicit per
   source. Each tab has keyboard focus and wraps at mobile widths.
5. GREEN tests and frontend typecheck. No demonstration/persisted data mixing.

### Task 3: Evidence-based insights and navigation entry points

Files: `apps/chat-web/src/lib/marketingOps/dashboardInsights.ts` and tests;
workspace controlled-service extension, existing integration links and legacy pages;
`docs/brandbook/`, `apps/chat-web/DESIGN.md`, testing/integration docs.

1. RED tests: missing/partial/stale evidence prevents performance assertions;
   organic insights identify source/date; no leads from visits; cold contacts stay
   cold; Clarity snapshots do not fabricate friction or period comparisons.
2. Implement bounded deterministic insights with evidence, source and next action.
   Add a small accessible shared insight view if necessary.
3. Update native integration result links to dashboard targets and preserve old
   routes through compatible redirects. Sync workspace selection with dashboard URL.
4. Document approved composition and limits in brandbook Markdown/JSON/manual,
   interaction contract and rapid manual test. Token values remain unchanged.

### Task 4: Review, local validation, publication

1. Run focused tests then backend PostgreSQL suite, typechecks and builds. Broaden
   only for new changes/failures. Resolve independent review findings.
2. Rebuild local Docker using `rtk proxy python tmp/ads-local-runtime.py rebuild`;
   preserve private env/key/volumes. Check five local health endpoints.
3. Verify actual authorized data and tab navigation in the app; test mobile and
   desktop, keyboard and source-specific empty/error states. Do not send emails,
   create events, import leads or spend unnecessary Clarity quota.
4. Audit staged files/credentials and diff; commit, fast-forward main and push under
   existing authorization. Delete only this merged temporary branch; VPS unchanged.

## Implementation and verification

Implemented the four approved tabs, source-specific explicit updates, bounded
insights, controlled work-service URL state and compatible legacy redirects.
Brandbook/interaction/IAM contracts remain aligned; runtime brand tokens are
unchanged. No SQL migration, provider writes or production-host operations.

Evidence on 2026-10-02:

- TDD failures demonstrated the missing organic metrics/scope, missing tabs,
  source isolation, member gating, default dates, on-demand attribution and
  dialog focus return before the corresponding fixes.
- Isolated PostgreSQL Marketing Ops suite: 529 passed, 2 skipped. Backend
  typecheck and Docker backend compilation passed.
- Full frontend suite: 331 passed across 65 files. Subsequent dialog-focus
  regression and date presentation changes: 22 relevant tests passed, followed
  by 20 final dashboard/insight tests. Actual `tsconfig.app.json` typecheck passed
  (the root references-only tsc script does not check app sources).
- Independent backend and frontend reviews completed. Search date defaults,
  stale insight identity, member gates, premature attribution warning and
  combined Clarity/GA4 period issues were fixed and regression-tested.
- Local Docker rebuild completed with existing private configuration preserved;
  web/BFF/Marketing Ops/Bridge/Artifact health endpoints returned 200.
- Authorized GA4 update through the UI succeeded with the expanded provider
  report. The measured organic result was zero for the seven closed days; no
  unknown metric was filled with an invented value. Search Console loaded its
  persisted clicks/impressions and coverage. Clarity displayed its persisted
  rolling UTC snapshot without consuming another export call.
- Work opened whole Drive and the Sheets library; campaigns used a persisted
  UUID and attributed detail loaded only after disclosure. Mobile 390 px and
  desktop 1440 px had no page overflow. Escape returned focus to the site-dialog
  opener; the close target measured 44 × 44 px. Screenshot evidence stays ignored
  in `tmp/dashboard-unificado-desktop.jpg`.

Real campaign return cannot be validated before campaign sources, measured
reports and/or exact UTM links exist. Ads without an authorized advertising
account remains unconnected. The dashboard preserves these honest states.
