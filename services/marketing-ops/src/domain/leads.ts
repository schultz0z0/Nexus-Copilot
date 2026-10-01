import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import { writeAudit } from './audit.js';
import type { CommandContext } from './context.js';
import { hashCanonicalPayload } from './hash.js';
import { executeIdempotentCommand } from './idempotency.js';
import { ImportConfirmSchema, ImportPreviewInputSchema, LeadRowSchema, LeadSourceInputSchema, LeadSourcePatchSchema, ResultReportInputSchema, type ContactCandidate, type ImportDecision, type ImportPreview, type ImportReceipt, type ImportReviewRow, type LeadRow, type LeadSourceInput, type ResultReportInput } from './leadsContracts.js';

export interface LeadSource extends LeadSourceInput { id: string; campaignId: string; publicId: string; version: number; createdAt: string; updatedAt: string }
type Row = Record<string, any>;
const iso = (value: Date | string): string => new Date(value).toISOString();
const date = (value: Date | string): string => value instanceof Date ? value.toISOString().slice(0, 10) : value;
export function mapLeadSource(row: Row): LeadSource {
  return { id: row.id, campaignId: row.campaign_id, name: row.name, channel: row.channel, kind: row.kind, classification: row.classification, actionId: row.action_id, externalAccountId: row.external_account_id, externalCampaignId: row.external_campaign_id, allowedOrigins: row.allowed_origins, whatsappPhone: row.whatsapp_phone, enabled: row.enabled, publicId: row.public_id, version: Number(row.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

// Every acquisition mutation takes tenant -> campaign -> source locks in that
// order, matching anonymous capture before its foreign-key key-share locks.
async function lockLeadIngestion(client: PoolClient, context: CommandContext): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`lead-ingestion:${context.actor.tenantId}`]);
}

async function campaign(client: PoolClient, id: string, edit = false): Promise<void> {
  const visible = await client.query('select id,status from marketing_ops.campaigns where id = $1 and marketing_ops_private.can_access_campaign(id)', [id]);
  if (!visible.rows[0]) throw appError('not_found', 404, 'Campaign not found');
  if (edit) {
    const permission = await client.query('select marketing_ops_private.can_edit_campaign($1) as allowed', [id]);
    if (permission.rows[0]?.allowed !== true) throw appError('forbidden', 403, 'Campaign does not grant mutation authority');
    await client.query('select id from marketing_ops.campaigns where id = $1 for update', [id]);
  }
}
async function action(client: PoolClient, campaignId: string, id: string | null): Promise<void> {
  if (!id) return;
  const found = await client.query('select id from marketing_ops.campaign_items where id = $1 and campaign_id = $2', [id, campaignId]);
  if (!found.rows[0]) throw appError('validation_error', 400, 'Action must belong to the selected campaign', { field: 'actionId' });
}
async function source(client: PoolClient, campaignId: string, id: string, lock = false, enabled = false): Promise<Row> {
  const result = await client.query(`select * from marketing_ops.lead_sources where id = $1 and campaign_id = $2${lock ? ' for update' : ''}`, [id, campaignId]);
  const row = result.rows[0];
  if (!row) throw appError('not_found', 404, 'Lead source not found');
  if (enabled && !row.enabled) throw appError('source_disabled', 409, 'Lead source is disabled');
  return row;
}
function version(row: Row, expected: number): void {
  if (Number(row.version) !== expected) throw appError('version_conflict', 409, 'Observed version is stale', { currentVersion: Number(row.version) });
}

export async function listLeadSources(context: CommandContext, campaignId: string): Promise<LeadSource[]> {
  authorize(context.actor, 'campaign.read');
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await campaign(client, campaignId);
    const result = await client.query('select * from marketing_ops.lead_sources where campaign_id = $1 order by created_at,id', [campaignId]);
    return result.rows.map(mapLeadSource);
  });
}
export async function createLeadSource(context: CommandContext, campaignId: string, input: unknown, key: string): Promise<LeadSource> {
  authorize(context.actor, 'campaign.update');
  const parsed = LeadSourceInputSchema.parse(input);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await lockLeadIngestion(client, context);
    await campaign(client, campaignId, true);
    return executeIdempotentCommand(client, context, `lead.source.create:${campaignId}`, key, parsed, async () => {
      await action(client, campaignId, parsed.actionId);
      const result = await client.query(`insert into marketing_ops.lead_sources(id,tenant_id,campaign_id,name,channel,kind,classification,action_id,external_account_id,external_campaign_id,allowed_origins,whatsapp_phone,enabled,public_id,created_by,updated_by)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) returning *`,
      [randomUUID(), context.actor.tenantId, campaignId, parsed.name, parsed.channel, parsed.kind, parsed.classification, parsed.actionId, parsed.externalAccountId, parsed.externalCampaignId, parsed.allowedOrigins, parsed.whatsappPhone, parsed.enabled, randomBytes(24).toString('base64url'), context.actor.userId]);
      const output = mapLeadSource(result.rows[0]!);
      await writeAudit(client, context, 'campaign', campaignId, 'lead.source.created', null, { ...output, publicId: undefined });
      return output;
    });
  });
}
export async function updateLeadSource(context: CommandContext, campaignId: string, sourceId: string, expected: number, input: unknown, key: string): Promise<LeadSource> {
  authorize(context.actor, 'campaign.update');
  const patch = LeadSourcePatchSchema.parse(input);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await lockLeadIngestion(client, context);
    await campaign(client, campaignId, true);
    return executeIdempotentCommand(client, context, `lead.source.update:${sourceId}`, key, { expected, patch }, async () => {
      const before = await source(client, campaignId, sourceId, true);
      version(before, expected);
      const { id: _id, campaignId: _campaignId, publicId: _publicId, version: _version, createdAt: _createdAt, updatedAt: _updatedAt, ...editable } = mapLeadSource(before);
      const merged = LeadSourceInputSchema.parse({ ...editable, ...patch });
      const result = await client.query(`update marketing_ops.lead_sources set name=$2,allowed_origins=$3,whatsapp_phone=$4,enabled=$5,version=version+1,updated_by=$6,updated_at=now() where id=$1 returning *`, [sourceId, merged.name, merged.allowedOrigins, merged.whatsappPhone, merged.enabled, context.actor.userId]);
      const output = mapLeadSource(result.rows[0]!);
      await writeAudit(client, context, 'campaign', campaignId, 'lead.source.updated', { ...mapLeadSource(before), publicId: undefined }, { ...output, publicId: undefined });
      return output;
    });
  });
}

export function leadReceiptKey(input: LeadRow): string {
  return input.externalId ? `external:${input.externalId}` : `row:${hashCanonicalPayload(input)}`;
}
function namespace(sourceRow: Row): string {
  return sourceRow.external_account_id ? `${sourceRow.channel}:account:${sourceRow.external_account_id}` : `source:${sourceRow.id}`;
}
async function duplicate(client: PoolClient, sourceRow: Row, input: LeadRow): Promise<string | null> {
  const receipt = await client.query('select contact_id from marketing_ops.lead_receipts where source_id=$1 and receipt_key=$2 and tenant_id=$3', [sourceRow.id, leadReceiptKey(input), sourceRow.tenant_id]);
  if (receipt.rows[0]?.contact_id) return receipt.rows[0].contact_id;
  if (input.externalId) {
    const identity = await client.query('select contact_id from marketing_ops.lead_external_identities where tenant_id=$1 and namespace=$2 and external_id=$3', [sourceRow.tenant_id, namespace(sourceRow), input.externalId]);
    if (identity.rows[0]?.contact_id) return identity.rows[0].contact_id;
  }
  return null;
}
async function candidates(client: PoolClient, input: LeadRow): Promise<ContactCandidate[]> {
  const result = await client.query('select id,name,email,phone,company from marketing_ops.lead_contacts where (email=$1 and $1 is not null) or (phone=$2 and $2 is not null) order by created_at,id limit 20', [input.email ?? null, input.phone ?? null]);
  return result.rows;
}
function previewSummary(rows: ImportReviewRow[]): ImportPreview['summary'] {
  const summary = { new: 0, duplicate: 0, possible_duplicate: 0, invalid: 0 };
  for (const row of rows) summary[row.status]++;
  return summary;
}
const mapPreview = (row: Row): ImportPreview => ({ id: row.id, campaignId: row.campaign_id, sourceId: row.source_id, expiresAt: iso(row.expires_at), rows: row.rows, summary: previewSummary(row.rows) });

export async function previewLeadImport(context: CommandContext, campaignId: string, input: unknown, key: string): Promise<ImportPreview> {
  authorize(context.actor, 'campaign.update');
  const parsed = ImportPreviewInputSchema.parse(input);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await lockLeadIngestion(client, context);
    await campaign(client, campaignId, true);
    return executeIdempotentCommand(client, context, `lead.import.preview:${campaignId}`, key, parsed, async () => {
      const sourceRow = await source(client, campaignId, parsed.sourceId, true, true);
      const seen = new Set<string>();
      const rows: ImportReviewRow[] = [];
      for (const [rowIndex, candidate] of parsed.rows.entries()) {
        const result = LeadRowSchema.safeParse(candidate);
        if (!result.success) {
          rows.push({ rowIndex, status: 'invalid', input: null, issues: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`), candidates: [], contactId: null });
          continue;
        }
        const receiptKey = leadReceiptKey(result.data);
        const contactId = await duplicate(client, sourceRow, result.data);
        const possible = contactId || seen.has(receiptKey) ? [] : await candidates(client, result.data);
        rows.push({ rowIndex, status: contactId || seen.has(receiptKey) ? 'duplicate' : possible.length ? 'possible_duplicate' : 'new', input: result.data, issues: [], candidates: possible, contactId });
        seen.add(receiptKey);
      }
      const persisted = await client.query(`insert into marketing_ops.lead_import_previews(id,tenant_id,campaign_id,source_id,actor_id,source_version,rows) values($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`, [randomUUID(), context.actor.tenantId, campaignId, sourceRow.id, context.actor.userId, sourceRow.version, JSON.stringify(rows)]);
      const output = mapPreview(persisted.rows[0]!);
      await writeAudit(client, context, 'campaign', campaignId, 'lead.import.previewed', null, { previewId: output.id, sourceId: output.sourceId, summary: output.summary });
      return output;
    });
  });
}
export async function getLeadImportPreview(context: CommandContext, campaignId: string, previewId: string): Promise<ImportPreview & { receipt: ImportReceipt | null }> {
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await campaign(client, campaignId);
    const result = await client.query('select * from marketing_ops.lead_import_previews where id=$1 and campaign_id=$2 and actor_id=$3', [previewId, campaignId, context.actor.userId]);
    if (!result.rows[0]) throw appError('not_found', 404, 'Import preview not found');
    return { ...mapPreview(result.rows[0]), receipt: result.rows[0].receipt };
  });
}

async function persistReceipt(client: PoolClient, context: CommandContext, sourceRow: Row, input: LeadRow, previewId: string, contactId: string): Promise<void> {
  const classification = input.classification ?? sourceRow.classification;
  if (input.externalId) {
    await client.query(`insert into marketing_ops.lead_external_identities(tenant_id,namespace,external_id,contact_id,campaign_id) values($1,$2,$3,$4,$5) on conflict do nothing`, [context.actor.tenantId, namespace(sourceRow), input.externalId, contactId, sourceRow.campaign_id]);
  }
  await client.query(`insert into marketing_ops.campaign_leads(tenant_id,campaign_id,contact_id,first_source_id,captured_source_id,classification,first_occurred_at,captured_at)
    values($1,$2,$3,$4,case when $5='lead' then $4::uuid end,$5,$6,case when $5='lead' then $6::timestamptz end)
    on conflict(campaign_id,contact_id) do update set
      classification=case when campaign_leads.classification='lead' or excluded.classification='lead' then 'lead' else 'cold' end,
      captured_at=coalesce(campaign_leads.captured_at,excluded.captured_at),captured_source_id=coalesce(campaign_leads.captured_source_id,excluded.captured_source_id),updated_at=now()`,
  [context.actor.tenantId, sourceRow.campaign_id, contactId, sourceRow.id, classification, input.occurredAt]);
  await client.query(`insert into marketing_ops.lead_receipts(tenant_id,campaign_id,source_id,contact_id,receipt_key,payload_hash,classification,occurred_at,kind,actor_id,preview_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,'import',$9,$10) on conflict(tenant_id,source_id,receipt_key) do nothing`,
  [context.actor.tenantId, sourceRow.campaign_id, sourceRow.id, contactId, leadReceiptKey(input), hashCanonicalPayload(input), classification, input.occurredAt, context.actor.userId, previewId]);
}
export async function confirmLeadImport(context: CommandContext, campaignId: string, previewId: string, input: unknown, key: string): Promise<ImportReceipt> {
  authorize(context.actor, 'campaign.update');
  const parsed = ImportConfirmSchema.parse(input);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await lockLeadIngestion(client, context);
    await campaign(client, campaignId, true);
    // A tenant-scoped transaction lock avoids racing external identity insertion
    // across sources/campaigns. It never grants visibility to other campaigns.
    return executeIdempotentCommand(client, context, `lead.import.confirm:${previewId}`, key, parsed, async () => {
      const found = await client.query('select * from marketing_ops.lead_import_previews where id=$1 and campaign_id=$2 and actor_id=$3 for update', [previewId, campaignId, context.actor.userId]);
      const preview = found.rows[0];
      if (!preview) throw appError('not_found', 404, 'Import preview not found');
      const decisionHash = hashCanonicalPayload(parsed);
      if (preview.confirmed_at) {
        if (preview.confirmation_hash !== decisionHash) throw appError('idempotency_conflict', 409, 'Import was already confirmed with different decisions');
        return preview.receipt as ImportReceipt;
      }
      if (Date.parse(preview.expires_at) <= Date.now()) throw appError('preview_expired', 409, 'Import review has expired; preview the file again');
      const sourceRow = await source(client, campaignId, preview.source_id, true, true);
      if (Number(sourceRow.version) !== Number(preview.source_version)) throw appError('version_conflict', 409, 'Source changed after the import review; preview again');
      const rows = preview.rows as ImportReviewRow[];
      const decisions = new Map<number, ImportDecision>(parsed.decisions.map(decision => [decision.rowIndex, decision]));
      if (parsed.decisions.some(decision => !rows[decision.rowIndex])) throw appError('validation_error', 400, 'Decision row is outside the preview');
      const receipt: ImportReceipt = { previewId, created: 0, linked: 0, skipped: 0, duplicate: 0, invalid: 0 };
      for (const row of rows) {
        if (row.status === 'invalid' || !row.input) { receipt.invalid++; continue; }
        const decision = decisions.get(row.rowIndex);
        if (decision?.action === 'skip') { receipt.skipped++; continue; }
        // Revalidate dates/data; persisted previews are bounded and immutable.
        const lead = LeadRowSchema.parse(row.input);
        const existing = await duplicate(client, sourceRow, lead);
        if (existing) {
          await persistReceipt(client, context, sourceRow, lead, previewId, existing);
          receipt.duplicate++;
          continue;
        }
        if (row.status === 'duplicate') { receipt.duplicate++; continue; }
        if (!decision) throw appError('review_required', 422, 'Every new or possible duplicate row requires a decision', { rowIndex: row.rowIndex });
        let contactId: string;
        if (decision.action === 'link') {
          const freshCandidates = await candidates(client, lead);
          if (!freshCandidates.some(contact => contact.id === decision.contactId)) throw appError('review_conflict', 409, 'Selected contact is not an exact email or phone candidate', { rowIndex: row.rowIndex });
          contactId = decision.contactId!;
          receipt.linked++;
        } else {
          // Newly appeared exact candidates require a fresh preview rather than
          // accepting a stale "new" decision and creating an accidental duplicate.
          if (row.status === 'new' && (await candidates(client, lead)).length) throw appError('review_conflict', 409, 'Matching contacts appeared after preview; review again', { rowIndex: row.rowIndex });
          contactId = randomUUID();
          await client.query(`insert into marketing_ops.lead_contacts(id,tenant_id,origin_campaign_id,origin_source_id,name,email,phone,company,first_occurred_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [contactId, context.actor.tenantId, campaignId, sourceRow.id, lead.name, lead.email ?? null, lead.phone ?? null, lead.company ?? null, lead.occurredAt]);
          receipt.created++;
        }
        await persistReceipt(client, context, sourceRow, lead, previewId, contactId);
      }
      await client.query('update marketing_ops.lead_import_previews set confirmed_at=now(),confirmation_hash=$2,receipt=$3::jsonb where id=$1', [previewId, decisionHash, JSON.stringify(receipt)]);
      await writeAudit(client, context, 'campaign', campaignId, 'lead.import.confirmed', null, receipt);
      return receipt;
    });
  });
}

export async function listCampaignLeads(context: CommandContext, campaignId: string, filters: { limit: number; cursor?: string | undefined; classification?: 'cold' | 'lead' | undefined }): Promise<{ data: Row[]; nextCursor: string | null }> {
  authorize(context.actor, 'campaign.read');
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await campaign(client, campaignId);
    const found = await client.query(`select contact.*,link.classification,link.first_occurred_at as campaign_occurred_at,link.captured_at,link.first_source_id,origin.channel as origin_channel,source.name as source_name
      from marketing_ops.campaign_leads link join marketing_ops.lead_contacts contact on contact.id=link.contact_id and contact.tenant_id=link.tenant_id
      join marketing_ops.lead_sources source on source.id=link.first_source_id
      left join marketing_ops.lead_sources origin on origin.id=contact.origin_source_id
      where link.campaign_id=$1 and ($2::uuid is null or contact.id > $2::uuid) and ($3::text is null or link.classification=$3)
      order by contact.id limit $4`, [campaignId, filters.cursor ?? null, filters.classification ?? null, filters.limit + 1]);
    const selected = found.rows.slice(0, filters.limit);
    return { data: selected.map(row => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, company: row.company, campaignId, classification: row.classification, sourceId: row.first_source_id, sourceName: row.source_name, firstOccurredAt: iso(row.campaign_occurred_at), capturedAt: row.captured_at ? iso(row.captured_at) : null, createdAt: iso(row.created_at), origin: row.origin_channel === null ? null : { campaignId: row.origin_campaign_id, sourceId: row.origin_source_id, channel: row.origin_channel } })), nextCursor: found.rows.length > filters.limit ? selected.at(-1)!.id : null };
  });
}

export interface ResultReport extends ResultReportInput { id: string; campaignId: string; version: number; createdAt: string; updatedAt: string; adsLinkId?: string | null; adsActive?: boolean }
export function mapResultReport(row: Row): ResultReport {
  return { id: row.id, campaignId: row.campaign_id, sourceId: row.source_id, actionId: row.action_id, periodFrom: date(row.period_from), periodTo: date(row.period_to), timeZone: row.time_zone, metrics: row.metrics, notes: row.notes, version: Number(row.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), adsLinkId: row.ads_link_id ?? null, adsActive: row.ads_active ?? true };
}
export async function listResultReports(context: CommandContext, campaignId: string): Promise<ResultReport[]> {
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await campaign(client, campaignId);
    const found = await client.query('select * from marketing_ops.result_reports where campaign_id=$1 and ads_active order by period_from desc,id limit 500', [campaignId]);
    return found.rows.map(mapResultReport);
  });
}
async function reportOverlap(client: PoolClient, input: ResultReportInput, except: string | null): Promise<void> {
  const overlap = await client.query(`select id from marketing_ops.result_reports where ads_active and source_id=$1 and (action_id is not distinct from $2::uuid or action_id is null or $2::uuid is null) and id is distinct from $3::uuid and daterange(period_from,period_to,'[]') && daterange($4::date,$5::date,'[]')`, [input.sourceId, input.actionId, except, input.periodFrom, input.periodTo]);
  if (overlap.rows.length) throw appError('report_overlap', 409, 'Report overlaps another period for the same source and action; revise the existing report', { reportId: overlap.rows[0].id });
}
async function revision(client: PoolClient, context: CommandContext, output: ResultReport): Promise<void> {
  await client.query(`insert into marketing_ops.result_report_revisions(tenant_id,campaign_id,report_id,version,snapshot,actor_id) values($1,$2,$3,$4,$5::jsonb,$6)`, [context.actor.tenantId, output.campaignId, output.id, output.version, JSON.stringify(output), context.actor.userId]);
}
export async function createResultReport(context: CommandContext, campaignId: string, input: unknown, key: string): Promise<ResultReport> {
  authorize(context.actor, 'campaign.update');
  const parsed = ResultReportInputSchema.parse(input);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await lockLeadIngestion(client, context);
    await campaign(client, campaignId, true);
    return executeIdempotentCommand(client, context, `lead.report.create:${campaignId}`, key, parsed, async () => {
      await source(client, campaignId, parsed.sourceId, true);
      await action(client, campaignId, parsed.actionId);
      await reportOverlap(client, parsed, null);
      const found = await client.query(`insert into marketing_ops.result_reports(id,tenant_id,campaign_id,source_id,action_id,period_from,period_to,time_zone,metrics,notes,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$11) returning *`, [randomUUID(), context.actor.tenantId, campaignId, parsed.sourceId, parsed.actionId, parsed.periodFrom, parsed.periodTo, parsed.timeZone, JSON.stringify(parsed.metrics), parsed.notes, context.actor.userId]);
      const output = mapResultReport(found.rows[0]!);
      await revision(client, context, output);
      await writeAudit(client, context, 'campaign', campaignId, 'lead.report.created', null, output);
      return output;
    });
  });
}
export async function updateResultReport(context: CommandContext, campaignId: string, reportId: string, expected: number, input: unknown, key: string): Promise<ResultReport> {
  authorize(context.actor, 'campaign.update');
  const parsed = ResultReportInputSchema.parse(input);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await lockLeadIngestion(client, context);
    await campaign(client, campaignId, true);
    return executeIdempotentCommand(client, context, `lead.report.update:${reportId}`, key, { expected, parsed }, async () => {
      await source(client, campaignId, parsed.sourceId, true);
      const current = await client.query('select * from marketing_ops.result_reports where id=$1 and campaign_id=$2 for update', [reportId, campaignId]);
      if (!current.rows[0]) throw appError('not_found', 404, 'Report not found');
      if (current.rows[0].ads_link_id) throw appError('ads_report_readonly', 409, 'Este relatório é atualizado pelo provedor. Use a sincronização para revisar os resultados.');
      version(current.rows[0], expected);
      await action(client, campaignId, parsed.actionId);
      await reportOverlap(client, parsed, reportId);
      const updated = await client.query(`update marketing_ops.result_reports set source_id=$2,action_id=$3,period_from=$4,period_to=$5,time_zone=$6,metrics=$7::jsonb,notes=$8,version=version+1,updated_by=$9,updated_at=now() where id=$1 returning *`, [reportId, parsed.sourceId, parsed.actionId, parsed.periodFrom, parsed.periodTo, parsed.timeZone, JSON.stringify(parsed.metrics), parsed.notes, context.actor.userId]);
      const output = mapResultReport(updated.rows[0]!);
      await revision(client, context, output);
      await writeAudit(client, context, 'campaign', campaignId, 'lead.report.revised', mapResultReport(current.rows[0]), output);
      return output;
    });
  });
}
export async function listReportRevisions(context: CommandContext, campaignId: string, reportId: string): Promise<Row[]> {
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await campaign(client, campaignId);
    const found = await client.query('select version,snapshot,created_at from marketing_ops.result_report_revisions where report_id=$1 and campaign_id=$2 order by version desc', [reportId, campaignId]);
    return found.rows.map(row => ({ version: Number(row.version), snapshot: row.snapshot, createdAt: iso(row.created_at) }));
  });
}

export async function listCaptureReviews(context: CommandContext, campaignId: string): Promise<Row[]> {
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await campaign(client, campaignId);
    const found = await client.query('select * from marketing_ops.lead_capture_submissions where campaign_id=$1 and status=\'pending\' order by created_at,id limit 100', [campaignId]);
    const rows: Row[] = [];
    for (const row of found.rows) rows.push({ id: row.id, sourceId: row.source_id, createdAt: iso(row.created_at), input: row.pending_payload, candidates: await candidates(client, row.pending_payload) });
    return rows;
  });
}
export async function resolveCaptureReview(context: CommandContext, campaignId: string, captureId: string, decision: Omit<ImportDecision, 'rowIndex'>, key: string): Promise<{ id: string; status: 'accepted' | 'skipped' }> {
  authorize(context.actor, 'campaign.update');
  return withActorTransaction(context.pool, context.actor, context.correlationId, async client => {
    await lockLeadIngestion(client, context);
    await campaign(client, campaignId, true);
    return executeIdempotentCommand(client, context, `lead.capture.resolve:${captureId}`, key, decision, async () => {
      const found = await client.query('select * from marketing_ops.lead_capture_submissions where id=$1 and campaign_id=$2 for update', [captureId, campaignId]);
      const entry = found.rows[0];
      if (!entry) throw appError('not_found', 404, 'Capture review not found');
      if (entry.status !== 'pending') throw appError('review_conflict', 409, 'Capture has already been reviewed');
      const sourceRow = await source(client, campaignId, entry.source_id, true);
      const payload = entry.pending_payload;
      let contactId: string | null = null;
      if (decision.action === 'link') {
        if (!(await candidates(client, payload)).some(candidate => candidate.id === decision.contactId)) throw appError('review_conflict', 409, 'Selected contact is not an exact email or phone candidate');
        contactId = decision.contactId!;
      } else if (decision.action === 'create') {
        contactId = randomUUID();
        await client.query(`insert into marketing_ops.lead_contacts(id,tenant_id,origin_campaign_id,origin_source_id,name,email,phone,company,first_occurred_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [contactId, context.actor.tenantId, campaignId, sourceRow.id, payload.name, payload.email, payload.phone, payload.company, entry.created_at]);
      }
      if (contactId) {
        await client.query(`insert into marketing_ops.campaign_leads(tenant_id,campaign_id,contact_id,first_source_id,captured_source_id,classification,first_occurred_at,captured_at)
          values($1,$2,$3,$4,case when $5='lead' then $4::uuid end,$5,$6,case when $5='lead' then $6::timestamptz end)
          on conflict(campaign_id,contact_id) do update set classification=case when campaign_leads.classification='lead' or excluded.classification='lead' then 'lead' else 'cold' end,captured_at=coalesce(campaign_leads.captured_at,excluded.captured_at),captured_source_id=coalesce(campaign_leads.captured_source_id,excluded.captured_source_id),updated_at=now()`, [context.actor.tenantId, campaignId, contactId, sourceRow.id, sourceRow.classification, entry.created_at]);
        await client.query(`insert into marketing_ops.lead_receipts(tenant_id,campaign_id,source_id,contact_id,receipt_key,payload_hash,classification,occurred_at,kind,utm,actor_id)
          values($1,$2,$3,$4,$5,$6,$7,$8,'form',$9::jsonb,$10)`, [context.actor.tenantId, campaignId, sourceRow.id, contactId, `submission:${entry.submission_id}`, entry.payload_hash, sourceRow.classification, entry.created_at, JSON.stringify(payload.utm ?? {}), context.actor.userId]);
      }
      const status = contactId ? 'accepted' as const : 'skipped' as const;
      await client.query('update marketing_ops.lead_capture_submissions set status=$2,contact_id=$3,pending_payload=null,resolved_at=now(),resolved_by=$4 where id=$1', [captureId, status, contactId, context.actor.userId]);
      await writeAudit(client, context, 'campaign', campaignId, 'lead.form_review_resolved', null, { captureId, status, action: decision.action, contactId });
      return { id: captureId, status };
    });
  });
}
