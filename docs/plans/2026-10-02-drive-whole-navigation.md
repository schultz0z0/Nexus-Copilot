# Whole Drive navigation implementation plan

**Goal:** Allow users to select their whole My Drive and browse its folders/files through the app.

**Architecture:** Reuse the existing company-owned OAuth connection, metadata-only Drive scope, BFF and resource selection receipt. Expose Google's native `root` alias as a selectable folder, validate it through files.get when selected and browse its children with the existing paged API. Keep specific-folder selection and historical generation/version fences intact. No automatic connection replacement or provider writes.

**Tech stack:** TypeScript, React, TanStack Query, existing Prometeus primitives, Google Drive v3.

The user explicitly requested whole Drive navigation. Compared with retaining folder-only selection or requesting broader file-content permissions, native root selection meets that request with the current authorization. This covers My Drive and its nested folders; separate shared-drive discovery is outside this change.

1. Add provider regression tests in `services/marketing-ops/src/integrations/workspace/providers.test.ts`: root available on an empty first discovery page, no repeated synthetic root in child/paged results, real root read preserves canonical alias and validates folder metadata. Run the focused suite and confirm the new tests fail.
2. Add UI navigation tests in `apps/chat-web/src/components/marketing-ops/WorkspaceTools.test.tsx`: whole Drive to folder to subfolder, ancestor breadcrumbs, clear folder search and page when moving, preserve pagination. Run focused frontend tests and confirm expected failure.
3. Implement root discovery/validation in `providers.ts`; retain safe links, native pagination and no permission expansion. Implement ancestor breadcrumbs in `WorkspaceTools.tsx` with keyboard buttons, wrapping mobile layout and existing semantic tokens. Explain root/folder options in the picker.
4. Run focused provider/UI tests, both typechecks and frontend build. Update integration guide, quick test and product DESIGN contract. Rebuild local Docker while preserving private configuration.
5. Inspect real authorized Drive discovery in the app without changing the user's selection. Verify root option is selectable, existing files visible and unchanged GA4/Clarity. Commit and push approved changes to main after validation; no VPS deployment.

Reference: https://developers.google.com/workspace/drive/api/guides/folder documents `root` as the native root-folder alias.

## Approved scope extension: Sheets library

The user requested the same account/library navigation for Sheets and analogous
services. Offer **Todas as planilhas** (native Drive root validated at selection)
or a preferred spreadsheet. A local library lists accessible spreadsheets with
search/pagination. Opening a spreadsheet sends an optional opaque `resourceId`
to the existing BFF GET; the domain validates its kind/access and keeps the
existing actor/generation fences. It does not mutate the selected resource or
historical links. Preview components are keyed by spreadsheet so mappings never
cross documents. OneDrive/SharePoint benefit from the shared ancestor navigation;
mail/calendar retain explicit destinations because they support external writes.

Test first: provider root discovery, strict GET query forwarding, client opaque
ID encoding, library-to-two-previews navigation and real PostgreSQL domain read
with unchanged selection, wrong-kind rejection, root selection and member denial.
Update the existing integration guide with a practical analyst workflow and
distinguish provider metrics from contacts/commercial results.

## Verification outcome

- Backend: isolated PostgreSQL suite passed with 523 tests passing and 2 skipped;
  migration replay verified. The new domain regression covers explicit spreadsheet
  reads without changing selection, wrong-kind rejection, root selection and IAM.
- Frontend: 14 focused tests passed; both application typechecks and production
  builds passed. Local Docker was rebuilt while preserving private configuration.
- Authorized browser: root discovery returned the company's real Drive folders;
  Sheets library listed its spreadsheet and opened the real bounded preview.
  Existing saved resource choices were preserved. No provider writes or imports.
- Mobile library at 390 px: document width remained 390 px with no page overflow.
  Browser viewport was restored. All five local service health checks returned 200.
