# Workspace Marketing Integrations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver usable, native Google Workspace and Microsoft 365 marketing workflows in the Prometeus app, including files, mail, calendars, reviewed Sheets imports and Search Console.

**Architecture:** Browser → App API/BFF → Marketing Ops → authorized provider APIs. PostgreSQL owns tenant authorization, opaque session-bound one-use OAuth states, encrypted token references, generation/version fences, campaign links, measurements and durable operation receipts. Reuse the installation encryption key without modifying Hermes core or introducing Graph MCP. Microsoft Graph REST is a provider API, not the prohibited Graph MCP.

**Tech Stack:** Existing React/Vite/TanStack Query/shadcn/Recharts, Express/TypeScript, Fastify BFF, PostgreSQL forced RLS, native fetch, Vitest and Playwright. Existing dependencies only.

## Approved design and acceptance

User approved all five proposed areas: Google Drive / SharePoint / OneDrive; Gmail / Outlook; Google / Outlook Calendar; Google Sheets; Google Search Console. Eight independently authorized service capabilities use two installation-owned application configurations. End users connect, choose and replace resources without seeing client secrets. Admin prepares applications through the app, including callbacks and step-by-step API requirements. Existing Google credentials can be reused server-side where feasible without invalidating Ads or GA4. No consent alone counts as a working integration: validate identity and provider resources.

Connectors have portable provider interfaces in `services/marketing-ops/src/integrations/workspace/types.ts`. OAuth uses dedicated callbacks `/api/workspace/oauth/{google|microsoft}/callback`. The BFF redirects only to known integration paths using safe result codes. Each service keeps independent tokens/scopes and version/generation; disconnect and application replacement preserve historical links/results and invalidate pending operations. Refresh must be fenced and preserve rotating refresh tokens. Failure does not imply zero or erase data.

### Task 1: Provider adapters (independent)

Create `services/marketing-ops/src/integrations/workspace/providers.ts` and `providers.test.ts`. Export `createWorkspaceProviderClient(service, config, fetcher?)` and `workspaceScopes(service)`. Write failing tests for both OAuth/refresh/identity flows, resource discovery and native operations, malformed/paged/throttled responses, safe errors and response bounds. Use official primary provider documentation. Limit requests and rows, prohibit arbitrary origins/redirects/pagination URLs. Implement Drive file/folder reads, Sheets first-tab bounded values, Gmail/Outlook messages/drafts/send, calendars list/publish, Microsoft OneDrive and SharePoint resources and Search Console totals/daily/pages/queries. Explicitly label Search Console top-row limitations and keep weighted totals from independent aggregate query. Never fabricate sales or identified leads from search traffic.

### Task 2: Domain, storage, migrations and routes

Create `infra/postgres/migrations/0023_marketing_ops_workspace_integrations.sql`, `domain/workspace.ts`, `domain/workspaceContracts.ts`, `http/routes/workspace.ts`, associated tests and private setup store. Reuse existing installation key and use a separate secret-file namespace; Ads pruning must not remove workspace configs. Add forced RLS and canonical admin/manager gates. Support public setup GET/POST, service connect/select/disconnect/resources, bounded file/message/sheet/event/report operations and campaign links. External write operations use durable reservation receipts and require explicit human confirmation. Never auto-retry an uncertain mail send. Application replacement and disconnect cannot allow old-generation results to publish. Search Console snapshots remain site analytics, not business results. Sheet import must enter existing mapping/review flows before changing campaign results or creating contacts.

### Task 3: User interface and campaign workflows

Create `apps/chat-web/src/lib/marketingOps/workspace.ts` client and tests, integration tabs and dialogs plus a workspace campaign panel/page. Read all brandbook contracts first. Reuse opaque dialogs, semantic tokens, explicit busy/error/retry states. Native file picker through BFF; service cards contain actual connect/select/change/disconnect controls. Mail previews, editable drafts and explicit send confirmation; calendar event review/publication with existing action/campaign relation; Sheets bounded preview and reusable contact/result import review. Search Console graphs and accessible tables on site analytics. Setup has client ID, masked secret, Microsoft tenant and server-owned copyable callback, help and readiness. Responsive desktop/mobile/keyboard checks, no secret persistence in browser. Tests first for missing config/resource/permissions, replacements, preview and mutating confirmations.

### Task 4: Wiring, BFF, installation and Hermes boundaries

Update `services/app-api/src/marketing/routes.js`, add `workspaceOAuth.js` and tests/register in `server.js`; update Marketing Ops startup/router; migration runners and test fixtures recognize 0023. Keep current Ads/GA4/Clarity working. No external send/calendar write during developer validation. Hermes can obtain prepared context through existing application-controlled boundaries; do not grant raw provider tokens or let model prose execute external effects. Document capabilities and operational limitations honestly.

### Task 5: Integrated verification and delivery

Run focused red→green tests, builds/typechecks, isolated full Marketing Ops/BFF/frontend tests with migrations/replay/RLS/generation/idempotency cases. Review changes, verify resource replacement/history and hostile URLs, stale config and uncertain sends. Rebuild local Docker through the existing private runtime helper (preserving operational config/Google connections); migrate local database safely without reset. Validate actual UI with fixtures and read-only connected Google where authorized; Microsoft external validation requires a real prepared enterprise account. Never declare untested external providers active. Update AGENTS, integration contract and quick test checklist. Secrets audit before commits; commit/push main under prior user authorization after checks, no VPS deployment.

## Public HTTP contract

All browser paths prefix `/api/marketing`; internal prefix `/v1`. Responses `{data: ...}`; mutation headers `If-Match: "version"` and `Idempotency-Key`. Service IDs are the eight entries of `workspaceServices`.

- GET `/workspace/apps` → `{family, configured, version, clientId, tenantId, redirectUri, hasSecret, source}[]`; POST `/workspace/apps/:family` → same record, input `{clientId,clientSecret?,tenantId?,confirmReplacement?}`.
- GET `/workspace/connections` → `{service,status,version,generation,configured,identity,selectedResource,resources,safeError,lastSyncAt}[]` (no tokens/secrets).
- POST `/workspace/:service/authorize` `{confirmReplacement?}` → `{url}`; opaque state knows service; POST internal `/workspace/oauth/:family/callback` `{state,code?|error?}` session-bound → `{service}`.
- GET `/workspace/:service/resources?parentId=&search=&page=` → `WorkspacePage<WorkspaceResource>`; POST `/workspace/:service/resource` `{resourceId,confirmReplacement?}`; POST `/workspace/:service/disconnect` `{}`.
- GET `/workspace/:service/files` → `WorkspacePage<WorkspaceResource>` for selected folder/site; GET `/workspace/:service/messages` → page; GET `/workspace/:service/messages/:messageId` → message.
- POST `/workspace/:service/drafts` `{to,subject,text,campaignId?}` → draft/receipt; POST `/workspace/:service/drafts/:draftId/send` `{confirm:true,campaignId?}` → receipt.
- GET `/workspace/:service/events?from=&to=` → page; POST `/workspace/:service/events` `{title,description,start,end,timeZone,campaignId?,actionId?,confirm:true}` → event/receipt.
- GET `/workspace/google_sheets/sheet` → sheet; GET `/workspace/google_search_console/report?from=&to=` → SearchConsoleReport snapshot; POST same `/report` `{from,to}` explicitly refreshes with bounded calls.
- GET `/campaigns/:id/workspace-links` → `{id,service,kind,resourceId,name,url,active,version,createdAt}[]`; POST same `{service,kind:'file'|'message',resourceId}` validates provider resource and campaign before attaching; POST `/.../:linkId/disable` `{}` conserves history.

Resources, drafts and events validated server-side, no arbitrary external link storage or secret URLs. UI may navigate only validated provider-owned HTTPS URLs. Query values never control a request origin.
