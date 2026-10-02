# Chat Web design contract

This file records the durable visual and interaction rules of Prometeus.
It complements component tests; it does not replace product authorization,
accessibility checks, or the Marketing Ops security contracts.

The complete brand kit lives in `docs/brandbook/`: start with its `README.md`,
then `design-system.md`, `design-system.json` and `manual-da-marca.html`.
Those documents provide portable guidance for all AI agents and distinguish
implemented values from recipes for new content. This file remains the
product-specific interaction contract; runtime token ownership stays below.

## Visual language

- Source: https://agenciaprometeus.com.br/, inspected 2026-09-26, and the original
  manual/assets in `docs/brandbook` (first PDF page excluded). The displayed
  product name is **Prometeus**, as chosen by the user.
- The canvas is midnight blue (#040814). Blue (#0652C5) is reserved for primary
  actions and emphasis. Supporting colors: white (#FFFFFF), navy (#1A2338),
  slate blue (#3B4B6B) and mist (#E2E8F0). Lighter blue is derived for readable
  links/focus on dark backgrounds. Do not use action blue as small dark-mode text.
- Use Space Grotesk for interface text and Geist Mono for code/technical details,
  matching the website. The original logotype uses Outfit; use the supplied
  artwork instead of retyping or redrawing it. Keep its proportions and clearspace.
- Surfaces are dark and substantially opaque, with thin slate borders, restrained
  shadows and subtle blue lighting. White glass, warm backgrounds and teal brand
  gradients belong to the retired ENS identity. Dialogs and menus remain opaque.
- Headings are compact and high contrast; only the welcome heading uses the
  website's silver gradient. Body text remains solid and readable.
- Cards use the established rounded surface language (`rounded-xl` or
  `rounded-2xl`), subtle borders and restrained shadows. New flows must reuse
  these primitives instead of introducing an unrelated visual theme.
- Color never carries state alone. Status color is paired with an icon and a
  Portuguese text label.
- Keep established screen structure, navigation, spacing and workflow unchanged
  during the rebrand. Status palettes remain semantic rather than brand decoration.
- Preserve the original robot mascot and its two speech bubbles ("Vamos crescer?"
  and "Potencialize já!") at the user's explicit request. The bubbles follow the
  Prometeus surface tokens; this character is intentionally retained, not a logo.

## Token and asset ownership

`src/index.css` is the canonical runtime source (model B). `tailwind.config.ts`
adapts its variables; components consume semantic classes. This document records
intent and official source colors, not a second generated theme.

| Role | Runtime token / owner | Consumers |
| --- | --- | --- |
| Canvas, panels, overlays | `--background`, `--card`, `--popover` | App, Card, Dialog, Select, menus |
| Action / on-action | `--primary`, `--primary-foreground` | Button, selected tabs, chat send |
| Text / secondary / muted | `--text-primary`, `--text-secondary`, `--text-muted` | All screens |
| Links / focus | `--brand-accent`, `--ring` | Links, focus outlines |
| Error / warning / success text | `--status-error`, `--status-warning`, `--status-success` | Inline validation and status text on dark panels |
| Borders / inputs | `--border`, `--input` | Tables, panels, forms |
| Typography | `--font-sans`, `--font-mono` | Tailwind font adapter, body |
| Scrollbars | `--scrollbar-*` in global CSS | All scrollable regions; forced-colors supported |
| Brand artwork | `components/BrandLogo.tsx`, `public/brand/` | Login, header, sidebar, welcome, favicon |

The app uses one dark identity, independent of OS appearance. Reduced motion
disables decorative animation and transition effects. Brand identity changes
never rename API headers, tenant IDs, persisted content, or deployment paths.
Operational status meanings remain unchanged. Inline status text uses lighter
tones on dark panels; badges with their own light background retain their paired
dark foreground. Do not reuse a badge's dark text color on an unfilled surface.

## Interaction rules

### Native analytics connections

Normal integration actions are Connect, choose resource, refresh, renew, swap
and disconnect. Installation application credentials belong in an admin-only
advanced disclosure. Google Ads and GA4 reuse that prepared application with
independent consent; no Ads account is required for GA4. Clarity tokens are
entered in a password field, validated server-side and never redisplayed.
Changing an authorized Google identity/resource or project requires confirmation
and explains preserved history and campaign link review.

Site analytics live on their own page and in the campaign Navigation tab. Use
the existing four-KPI/two-chart composition, visible partial/stale summaries,
accessible data tables and optional detailed coverage. Explicit UTM attribution
never infers a campaign from its name. Clarity rolling UTC windows remain distinct
from GA4 complete property-timezone dates and from business leads/sales.

- The browser talks only to the App API/BFF. UI code must never call PostgreSQL,
  Hermes or an internal Marketing Ops endpoint directly.
- Mutations require explicit controls. Model prose and typed confirmation are
  not substitutes for the **Executar plano** button.
- Buttons expose visible focus, disabled and busy states. Destructive or
  critical actions require an additional explicit confirmation.
- Links returned by Marketing Ops are internal deep links and must remain
  bounded to known application routes.

## Structured Marketing Ops plans

- A pending card is an executable proposal, not a chat message. It comes from
  the server-owned plan read model and displays plan ID/hash, immutable actions,
  expiry and one explicit **Executar plano** control.
- A card may contain several related actions. A chat exposes at most one pending
  executable plan; a revised plan replaces the previous pending card.
- Terminal cards are durable receipts sourced from PostgreSQL. They remain
  visible after query refresh or page reload and never render an execution
  button.
- Receipt labels are unambiguous: **Plano concluído**, **Plano concluído
  parcialmente**, **Plano não concluído**, **Plano expirado** or **Plano
  substituído**.
- Creating an approval request is not approval. The receipt must say
  **Solicitação de aprovação criada — pendente** until a separate eligible
  human records a decision in the approvals flow.
- Result links are secondary actions. The execution result and its timestamp
  remain legible even when no deep link exists.

## Accessibility and responsive behavior

- Mutation outcomes are announced through `aria-live` and also remain visible
  as persistent text; transient toast-only confirmation is insufficient.
- Controls need accessible names and keyboard activation. Busy cards expose
  `aria-busy`; icons used only for decoration do not replace labels.
- Chat bubbles and plan cards use bounded widths on desktop and may expand on
  small viewports without horizontal page scrolling. Long IDs, hashes and
  server messages must wrap or truncate safely.

## Marketing dashboards

`/marketing-ops/dashboard` opens the real results read model through
`/api/marketing/results`. Campaign/date filters remain in the URL. The overview
contains identified leads, reported sales/revenue/investment, a weekly trend
and a channel donut; campaign links use persisted campaign UUIDs. Cold contacts
and WhatsApp clicks are separate counts, not leads. Measured zero remains zero;
unmeasured values remain unavailable. Without goals and adequate measurement,
do not declare the operation healthy or invent conversion rates from aggregates.
Crossing reports are excluded with a coverage notice, never prorated silently.

### Explicit demonstration

`/marketing-ops/dashboard?mode=demo` is an explicitly labeled demonstration.
It uses deterministic local fixtures, no metrics API or CRM. Filters apply to
results, targets, cohorts and channel/campaign breakdowns. The operational
snapshot is explicitly global and independent of result filters. Missing source
data is not zero; incomplete coverage prevents a positive health conclusion.
Period sales are distinct from cumulative conversion of the lead-entry cohort.
Media cost per qualified lead uses paid-channel leads only, not total leads.
Charts have accessible tabular alternatives and do not animate on load.

The clean overview shows four indicators (leads, period sales, revenue, paid
investment), one compact health notice, an area/line trend and channel-share
donut. Cohort funnel, qualified/opportunity totals, media bars, source coverage
and operational priorities are disclosed on demand through opaque Radix dialogs.
Do not reintroduce repeated diagnoses, full channel tables or explanatory panels
to the overview. Space and short labels are part of the hierarchy.

Campaign rows are real links to
`/marketing-ops/dashboard/campaigns/:demoCampaignId`. These routes are explicitly
demonstrative and bounded to known fixture IDs, never actual campaign UUIDs.
They show the selected campaign's trend, distribution, funnel, paid investment
and channel detail. Period/channel filters survive navigation and refresh.
The campaign report selector is locked to the current demo campaign.
Unknown fixture IDs render a safe not-found state. Demonstration data must never
be joined to persisted campaigns by name or resemblance.

Charts use the existing Recharts dependency and shared results components.
Colors keep stable channel meanings from brand tokens; organic also uses
hatching. Status colors are not channel colors. Donut percentages use available
leads only and disclose partial coverage. Missing rows never become zero-sized
evidence of no work. Paid bars exclude operating costs and non-paid sources.
Legends expose counts, shares and coverage to assistive technology and offer
keyboard detail actions. Chart alternatives remain available as values/tables.
Dialogs close with Escape and return focus to their opening control.

## Persisted campaign workspace

`/marketing-ops/campaigns/:campaignId` uses the real App API campaign record.
It opens on **Visão geral**: objective, audience, offer/initiative, planned period,
channels and primary owner, plus persisted indicators and two charts from the
campaign's results read model. With no measurement, display an explanatory
empty state and unavailable report metrics; no fixture values or fake charts.

Radix tabs group **Planejamento**, **Equipe**, **Fontes**, **Leads**, **Materiais**
and **Histórico**. Sources define attribution and capture; they are not active
OAuth connections. Source destinations/origins can be edited or disabled, while
channel/identity stays fixed. Leads preserve original attribution and separate
cold prospects; conflicting form identities require review. CSV/XLSX imports
require mapping, server preview, duplicate decisions and explicit confirmation.
Show a durable receipt and preserve a proposal when retries or conflicts occur.
Retain arrow-key navigation, associated panels and a visible active tab.
On small screens, only the tab strip may scroll horizontally.
Planning state lives above the panels: switching tabs does not save or discard a
draft. A dirty indicator and return-to-edit notice expose unsaved changes.
The explicit save/discard bar is visible in Planning. Existing validation,
optimistic version conflicts, role/participant authorization and archive
confirmation remain in effect. Status transitions stay disabled while dirty.
The actions link opens production with the exact campaign UUID filter.
Changing campaign routes remounts workspace state to avoid cross-campaign drafts.

Saving an incomplete draft is allowed. Planning/activation requirements remain
server-owned: objective, reference type/title, period and primary owner. When the
server returns `campaign_requirements_missing`, render `details.fields` as a
Portuguese list, keep the saved/local values, and offer **Completar planejamento**
or **Definir responsável** as appropriate. The planning action selects its tab
and focuses the first relevant field after the panel mounts. Never infer an
offer, invent dates, assign an owner or bypass the domain validation to resolve
the error. Keep the correlation ID available for support.

Weekly e-mail/WhatsApp results can be recorded in **Relatórios de resultados**
or proposed by Hermes as `campaign.results_record`. Before writing, display
the source, optional calendar action, period/timezone and measured values for
human review. Blank is unknown and zero is measured zero. A revision replaces
the active report, preserves history and uses its observed version. Never sum
overlapping reports or merge contact totals with aggregate results. The demo's
weekly dialog still simulates review only. Full CRM work remains outside this
delivery until the manager validates the dashboard. Contracts:
`docs/integrations/campaign-acquisition.md` and `ads-white-label.md`.

## Integrated marketing work

`/settings/integrations?tab=workspace` groups eight independent services into
Files, Mail, Calendar and Organic Search. Admins prepare the Google Workspace
and Microsoft 365 applications with server-owned callbacks and a masked secret;
secrets stay only in the mounted form and transient request. Users authorize,
choose an actual resource, replace it and disconnect with explicit review.
Consent alone never means connected. Changing an application invalidates all
services in that family; Ads and GA4 application configuration remains separate.
Resource pickers browse through the BFF, treat provider IDs as opaque and select
folders/libraries, spreadsheets, mail folders or editable calendars. Empty,
permission, busy and conflict states offer an honest next step.

`/marketing-ops/workspace` and the campaign's **Trabalho** tab expose the same
tools. Campaign context always comes from an authorized persisted campaign.
Files and selected messages can be explicitly attached to that campaign.
Links preserve history; links from an old connection generation are marked
unavailable rather than automatically rebound. Provider-owned HTTPS links are
allowlisted and open safely. Never render provider HTML as application markup.

Mail shows at most 20 recent messages as plain text, without attachments. A
message is edited locally, reviewed, saved as a provider draft and then sent
through a separate explicit confirmation. Uncertain sends have no retry button;
the user checks the provider first. A changed provider draft produces a blocked
state requiring a newly reviewed draft. Calendar commitments also require a
preview and explicit publication, with the calendar, local browser timezone and
optional campaign/calendar-action relation visible. No send or publication is
performed automatically by mounting a page, refreshing or by Hermes prose.

Sheets exposes a bounded first-tab preview, with at most 500 rows and 52 columns.
Drive resource selection offers native `root` as **Meu Drive inteiro** as well
as specific folders. File browsing uses wrapping, keyboard-accessible ancestor
breadcrumbs and clears search/page state when changing folders. The same path
navigation applies to OneDrive/SharePoint libraries; no provider writes occur.
Sheets offers **Todas as planilhas** or a preferred initial spreadsheet. A paged,
searchable library opens local previews without replacing the saved resource or
connection generation. Each read validates the actual spreadsheet on the server.
Returning to the library unmounts the preview; opening another spreadsheet resets
mapping/import state and uses a distinct query key. Calendars and mail keep an
explicit destination selection for external effects.
Contacts enter the existing mapping, deduplication and human confirmation flow;
truncated contact reads cannot be silently imported. Result imports select one
aggregate row, map metrics and prefill the existing report form for source,
period and human review. Brazilian formatted numbers are parsed strictly;
missing values remain unmeasured. Search Console keeps search traffic separate
from people and sales, with totals, a nonanimated dual-axis trend and accessible
daily/page/query tables. Top-row limits and previous snapshot preservation stay
visible. All mutations use observed versions and stable proposal keys.

## Contract maintenance

## Ads integrations and campaign attribution

`/settings/integrations` is a protected, lazy route reachable from the desktop
sidebar, mobile menu and profile. Preserve the admin users entry. The page uses
three quiet provider rows with Portuguese statuses, actual selected account,
currency, timezone, last synchronization and separate metrics/form permission
labels. Unprepared providers expose **Configurar aplicativo** to administrators
when writes are enabled. Only administrators read setup metadata or edit
credentials; managers manage authorization and account selection. Members read
connection states. Existing providers expose **Editar / trocar aplicativo**,
separate from **Trocar conta**. Operator prerequisites remain collapsed.
The application wizard has **Aplicativo → Autorização → Conta** progress and a
mandatory review before saving. Provider-specific credentials, API version,
Meta Login configuration ID and allowed scope checkboxes are visible; Google's
optional manager ID is disclosed under advanced options. Provider documentation
explains where to obtain credentials and register the read-only server callback.
Missing public origin or private storage has an honest recovery state and no
save/authorize action. External configuration requires an explicit takeover and
new secret; the external files remain intact. Managed blank secrets preserve
the stored value. Reviews display only secret presence, never secret content.
Credentials live only in the mounted form and a transient save request; no
query/mutation cache, URL, browser storage, analytics or logs contain them.
Closing unmounts the form and saving clears the entered secret. POST uses the
observed setup version and stable proposal key across identical retries; conflicts
load current metadata, preserve entered fields and require another human review.
The review freezes the observed setup version and mode; background metadata
refreshes never rewrite its If-Match version, replacement confirmation or retry
key. An ambiguous save is retried with the same proposal until the server
resolves it. Validation opens advanced options before focusing an invalid
Google manager ID, so the error remains visible and reachable by keyboard.
Replacement requires explicit confirmation that authorization and pending work
are invalidated while history remains. Saving prepares the app and offers the
explicit **Continuar e autorizar** action; it never declares a connected account.
Dialog focus returns to the original control, including its updated edit label,
or the persistent refresh button when that trigger is removed. Controls use the existing opaque dialog recipe,
44 px hit areas, error associations and first-invalid-field focus.
Admins/managers manage authorization when
write is enabled; members read the state safely. OAuth runs on an allowlisted
HTTPS provider endpoint. Callback outcome queries are consumed and removed;
“Autorização recebida. Escolha sua conta.” always triggers an actual status
refresh and never substitutes for account selection.

The existing campaign **Fontes** panel contains **Anúncios vinculados**.
Account selection, account change, disconnect, link creation, disabling and
manual synchronization require explicit controls and review/confirmation.
Mutations use the BFF session and observed versions; proposal keys survive
retries. Visible persistent live outcomes accompany the dialogs' focus return.
Use actual provider campaign IDs and sources; never associate by matching names.
Offer only enabled lead sources with matching channel, optional account/campaign
attribution and compatible capture transport. Manual sources may describe ads
leading to pages/WhatsApp with contacts imported from a file. Native form links
use manual sources and require server previews followed by human review.

Synchronization defaults to seven closed days in the account timezone, accepts
an explicit period of at most 30 days with no future dates and exposes safe
Portuguese errors. Results use an accessible daily table with original currency
and timezone. Null means unavailable. Conversions are distinct from sales;
different currencies are never summed, and excluded currency or revised provider
measurement notices remain visible in durable receipts. Readable history remains
after disconnect or link disabling. Provider-owned reports have **Atualizado pelo
provedor** and history, without manual revision controls; manual reports retain
their review flow.

Each receipt preview batch (up to 500 contacts) opens the existing import review
dialog directly, replacing the results modal until review closes and returning
focus to the selected batch. Disconnect returns focus to the persistent refresh
control when its original trigger is removed; disabling a link returns focus to
that link's persistent results control. There is no file mapping step or
automatic confirmation. Duplicate
decisions remain required. Expired previews direct the user to a new
synchronization; native `version_conflict` errors also clear stale review. A denied or
unavailable native preview uses the same safe guidance without confirming its
existence or owner, rebuilding it or bypassing access. CSV/Excel import remains available.
Reopening a confirmed batch displays the persisted import receipt, including its
original counts, even after the review deadline. It offers no decisions or new
confirmation and does not direct another synchronization for that completed review.

Use current semantic tokens, Space Grotesk, opaque Radix dialogs, minimum 44px
controls and independent metrics/form permission text. Preserve the brand assets,
robot and speech bubbles. Confine wide results tables to a keyboard-focusable
scroll region; never cause horizontal page scrolling. The domain dialog recipe
enlarges the existing close control to 44 px and reserves header space for it;
native review back controls and the mobile menu also have 44 px hit areas.

Any change to the plan lifecycle, receipt copy, status colors, or explicit
confirmation behavior must update the focused component tests and the M6
cutover runbook in the same change.
