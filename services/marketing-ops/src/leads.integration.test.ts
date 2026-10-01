import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from './auth/actor.js';
import { createCampaignDraft, transitionCampaign } from './domain/campaigns.js';
import { confirmLeadImport, createLeadSource, createResultReport, getLeadImportPreview, listCampaignLeads, listCaptureReviews, listLeadSources, listReportRevisions, previewLeadImport, resolveCaptureReview, updateLeadSource, updateResultReport } from './domain/leads.js';
import { getLeadResults } from './domain/leadsResults.js';
import { hashCanonicalPayload } from './domain/hash.js';
import { withActorTransaction } from './db/actorTransaction.js';

// This suite uses only the explicitly supplied disposable test database. It
// never falls back to the developer/evaluation database.
const enabled = !!process.env.MARKETING_OPS_TEST_DATABASE_URL && !!process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL;
const pool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/disabled' });
const adminPool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/disabled' });
const actor: Actor = { userId: '11111111-1111-4111-8111-111111111111', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'member' };
const other: Actor = { ...actor, userId: '33333333-3333-4333-8333-333333333333' };
const context = (selected = actor) => ({ pool, actor: selected, correlationId: randomUUID(), origin: 'rest' as const });
afterAll(() => Promise.all([pool.end(), adminPool.end()]));

async function setup(channel: 'google_maps' | 'meta_ads' | 'google_ads' = 'meta_ads', kind: 'manual' | 'landing_page' | 'whatsapp' = 'manual') {
  let campaign = await createCampaignDraft(context(), { name: `Lead test ${randomUUID()}`, objective: 'Generate leads', referenceType: 'initiative', referenceKey: 'lead-test', referenceTitleSnapshot: 'Lead test initiative', startsOn: '2025-01-01', endsOn: '2025-12-31', idempotencyKey: randomUUID() });
  campaign = await transitionCampaign(context(), campaign.id, campaign.version, 'planned', randomUUID());
  const source = await createLeadSource(context(), campaign.id, { name: 'Source', kind, channel, allowedOrigins: kind === 'landing_page' ? ['https://lead-test.example'] : [], whatsappPhone: kind === 'whatsapp' ? '5511999999999' : null, externalAccountId: `account-${randomUUID()}` }, randomUUID());
  return { campaign, source };
}
async function capture(publicId: string, input: { submissionId: string; name: string; email?: string; phone?: string }, origin = 'https://lead-test.example') {
  const result = await pool.query('select marketing_ops_private.capture_public_lead($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::uuid) as result', [publicId, origin, input.submissionId, input.name, input.email ?? null, input.phone ?? null, null, '{}', hashCanonicalPayload(input), randomUUID()]);
  return result.rows[0]?.result;
}

describe.runIf(enabled)('persisted campaign lead ingestion', () => {
  it('replays file imports and keeps Maps contacts cold until explicit interest', async () => {
    const { campaign, source } = await setup('google_maps');
    const lead = { externalId: 'maps-company-one', name: 'Cold company', email: `${randomUUID()}@example.com`, occurredAt: '2025-09-30T23:30:00-03:00' };
    const preview = await previewLeadImport(context(), campaign.id, { sourceId: source.id, rows: [lead, lead, { name: 'Missing contact' }] }, randomUUID());
    expect(preview.summary).toEqual({ new: 1, duplicate: 1, possible_duplicate: 0, invalid: 1 });
    const decisions = { decisions: [{ rowIndex: 0, action: 'create' }] };
    const receipt = await confirmLeadImport(context(), campaign.id, preview.id, decisions, randomUUID());
    expect(receipt).toMatchObject({ created: 1, duplicate: 1, invalid: 1 });
    expect(await confirmLeadImport(context(), campaign.id, preview.id, decisions, randomUUID())).toEqual(receipt);
    const fresh = await previewLeadImport(context(), campaign.id, { sourceId: source.id, rows: [lead] }, randomUUID());
    expect(fresh.summary.duplicate).toBe(1);
    expect(await confirmLeadImport(context(), campaign.id, fresh.id, { decisions: [] }, randomUUID())).toMatchObject({ created: 0, duplicate: 1 });
    expect(await getLeadResults(context(), { campaignId: campaign.id })).toMatchObject({ contactsCold: 1, capturedLeads: 0, revenue: null, sales: null });
    const interest = await previewLeadImport(context(), campaign.id, { sourceId: source.id, rows: [{ ...lead, classification: 'lead', occurredAt: '2025-10-01T12:00:00-03:00' }] }, randomUUID());
    await confirmLeadImport(context(), campaign.id, interest.id, { decisions: [] }, randomUUID());
    expect(await getLeadResults(context(), { campaignId: campaign.id })).toMatchObject({ contactsCold: 0, capturedLeads: 1 });
  });

  it('requires explicit candidate linking across campaigns and preserves the original source', async () => {
    const first = await setup();
    const second = await setup('google_ads');
    const lead = { name: 'Ana', email: `${randomUUID()}@example.com`, occurredAt: '2025-09-30T23:30:00-03:00' };
    const initial = await previewLeadImport(context(), first.campaign.id, { sourceId: first.source.id, rows: [lead] }, randomUUID());
    await confirmLeadImport(context(), first.campaign.id, initial.id, { decisions: [{ rowIndex: 0, action: 'create' }] }, randomUUID());
    const preview = await previewLeadImport(context(), second.campaign.id, { sourceId: second.source.id, rows: [lead] }, randomUUID());
    expect(preview.rows[0]?.status).toBe('possible_duplicate');
    const contact = preview.rows[0]!.candidates[0]!;
    await expect(confirmLeadImport(context(), second.campaign.id, preview.id, { decisions: [] }, randomUUID())).rejects.toMatchObject({ code: 'review_required' });
    const receipt = await confirmLeadImport(context(), second.campaign.id, preview.id, { decisions: [{ rowIndex: 0, action: 'link', contactId: contact.id }] }, randomUUID());
    expect(receipt.linked).toBe(1);
    const rows = await listCampaignLeads(context(), second.campaign.id, { limit: 25 });
    expect(rows.data[0]).toMatchObject({ id: contact.id, origin: { campaignId: first.campaign.id, sourceId: first.source.id, channel: 'meta_ads' } });
    const result = await getLeadResults(context(), { campaignId: second.campaign.id, from: '2025-09-30', to: '2025-09-30' });
    expect(result.capturedLeads).toBe(1);
  });

  it('rolls back partial imports and binds persisted review to the initiating actor', async () => {
    const { campaign, source } = await setup();
    const preview = await previewLeadImport(context(), campaign.id, { sourceId: source.id, rows: [1, 2].map(index => ({ name: `Ana ${index}`, email: `${randomUUID()}@example.com`, occurredAt: '2025-09-30T12:00:00Z' })) }, randomUUID());
    await expect(confirmLeadImport(context(), campaign.id, preview.id, { decisions: [{ rowIndex: 0, action: 'create' }] }, randomUUID())).rejects.toMatchObject({ code: 'review_required' });
    expect((await listCampaignLeads(context(), campaign.id, { limit: 25 })).data).toHaveLength(0);
    await expect(getLeadImportPreview(context(other), campaign.id, preview.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(listLeadSources(context(other), campaign.id)).rejects.toMatchObject({ code: 'not_found' });
    const observed = await withActorTransaction(pool, other, randomUUID(), client => client.query('select id from marketing_ops.lead_import_previews where id=$1', [preview.id]));
    expect(observed.rowCount).toBe(0);
  });

  it('rejects expired or changed-source previews without creating contacts', async () => {
    const { campaign, source } = await setup();
    const preview = await previewLeadImport(context(), campaign.id, { sourceId: source.id, rows: [{ name: 'Ana', email: `${randomUUID()}@example.com`, occurredAt: '2025-09-30T12:00:00Z' }] }, randomUUID());
    await updateLeadSource(context(), campaign.id, source.id, source.version, { name: 'Renamed source' }, randomUUID());
    await expect(confirmLeadImport(context(), campaign.id, preview.id, { decisions: [{ rowIndex: 0, action: 'create' }] }, randomUUID())).rejects.toMatchObject({ code: 'version_conflict' });
    await adminPool.query('update marketing_ops.lead_import_previews set expires_at=now()-interval \'1 hour\' where id=$1', [preview.id]);
    await expect(confirmLeadImport(context(), campaign.id, preview.id, { decisions: [{ rowIndex: 0, action: 'create' }] }, randomUUID())).rejects.toMatchObject({ code: 'preview_expired' });
  });

  it('records zero metrics explicitly, preserves revisions and blocks rollup overlap', async () => {
    const { campaign, source } = await setup();
    const input = { sourceId: source.id, periodFrom: '2025-09-01', periodTo: '2025-09-07', timeZone: 'America/Sao_Paulo', metrics: { sent: 100, delivered: 90, sales: 0, spend: 0 } };
    const first = await createResultReport(context(), campaign.id, input, randomUUID());
    expect(await getLeadResults(context(), { campaignId: campaign.id })).toMatchObject({ capturedLeads: 0, sales: 0, spend: 0, revenue: null });
    await expect(createResultReport(context(), campaign.id, input, randomUUID())).rejects.toMatchObject({ code: 'report_overlap' });
    const revised = await updateResultReport(context(), campaign.id, first.id, 1, { ...input, metrics: { ...input.metrics, revenue: 100.50, sales: 1 } }, randomUUID());
    expect(revised.version).toBe(2);
    await expect(updateResultReport(context(), campaign.id, first.id, 1, input, randomUUID())).rejects.toMatchObject({ code: 'version_conflict' });
    expect(await listReportRevisions(context(), campaign.id, first.id)).toHaveLength(2);
    expect(await getLeadResults(context(), { campaignId: campaign.id, from: '2025-09-02', to: '2025-09-05' })).toMatchObject({ sales: null, revenue: null, coverage: { partialReportsExcluded: 1 } });
  });

  it('captures forms idempotently, recognizes consistent exact identities and counts clicks separately', async () => {
    const first = await setup('meta_ads', 'landing_page');
    const second = await setup('google_ads', 'landing_page');
    const input = { submissionId: `submission-${randomUUID()}`, name: 'Ana', email: `${randomUUID()}@example.com` };
    expect(await capture(first.source.publicId, input, 'https://evil.example')).toBe('origin_forbidden');
    expect(await capture(first.source.publicId, input)).toBe('accepted');
    expect(await capture(first.source.publicId, input)).toBe('accepted');
    expect(await capture(first.source.publicId, { ...input, name: 'Different' })).toBe('conflict');
    expect(await capture(second.source.publicId, { ...input, submissionId: `submission-${randomUUID()}` })).toBe('accepted');
    const firstLeads = await listCampaignLeads(context(), first.campaign.id, { limit: 25 });
    const secondLeads = await listCampaignLeads(context(), second.campaign.id, { limit: 25 });
    expect(firstLeads.data).toHaveLength(1);
    expect(secondLeads.data[0]?.id).toBe(firstLeads.data[0]?.id);
    expect(secondLeads.data[0]?.origin.sourceId).toBe(first.source.id);
    const whatsapp = await createLeadSource(context(), first.campaign.id, { name: 'WhatsApp', channel: 'meta_ads', kind: 'whatsapp', whatsappPhone: '5511999999999' }, randomUUID());
    const clicked = await pool.query('select marketing_ops_private.record_public_whatsapp_click($1,$2::uuid) as phone', [whatsapp.publicId, randomUUID()]);
    expect(clicked.rows[0]?.phone).toBe('5511999999999');
    expect(await getLeadResults(context(), { campaignId: first.campaign.id })).toMatchObject({ capturedLeads: 1, whatsappClicks: 1 });
    await updateLeadSource(context(), first.campaign.id, first.source.id, 1, { enabled: false }, randomUUID());
    expect(await capture(first.source.publicId, { ...input, submissionId: `submission-${randomUUID()}` })).toBe('not_found');
  });

  it('holds conflicting exact identities for review without counting a third lead', async () => {
    const { campaign, source } = await setup('meta_ads', 'landing_page');
    const email = `${randomUUID()}@example.com`;
    const otherEmail = `${randomUUID()}@example.com`;
    const phone = `5511${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const preview = await previewLeadImport(context(), campaign.id, { sourceId: source.id, rows: [{ name: 'Email person', email, occurredAt: '2025-09-30T12:00:00Z' }, { name: 'Phone person', email: otherEmail, phone, occurredAt: '2025-09-30T12:00:00Z' }] }, randomUUID());
    await confirmLeadImport(context(), campaign.id, preview.id, { decisions: [{ rowIndex: 0, action: 'create' }, { rowIndex: 1, action: 'create' }] }, randomUUID());
    expect(await capture(source.publicId, { submissionId: `submission-${randomUUID()}`, name: 'Ambiguous', email, phone })).toBe('accepted');
    expect((await listCampaignLeads(context(), campaign.id, { limit: 25 })).data).toHaveLength(2);
    const reviews = await listCaptureReviews(context(), campaign.id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.candidates).toHaveLength(2);
    const result = await resolveCaptureReview(context(), campaign.id, reviews[0]!.id, { action: 'link', contactId: reviews[0]!.candidates[0].id }, randomUUID());
    expect(result.status).toBe('accepted');
    expect(await listCaptureReviews(context(), campaign.id)).toHaveLength(0);
    expect((await listCampaignLeads(context(), campaign.id, { limit: 25 })).data).toHaveLength(2);
  });

  it('holds a contradictory filled phone or email even when only one candidate matches', async () => {
    const { campaign, source } = await setup('meta_ads', 'landing_page');
    const email = `${randomUUID()}@example.com`;
    const phone = `5511${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    expect(await capture(source.publicId, { submissionId: `submission-${randomUUID()}`, name: 'Original', email, phone })).toBe('accepted');
    expect(await capture(source.publicId, { submissionId: `submission-${randomUUID()}`, name: 'Contradictory phone', email, phone: '5521999991234' })).toBe('accepted');
    expect(await capture(source.publicId, { submissionId: `submission-${randomUUID()}`, name: 'Contradictory email', email: `${randomUUID()}@example.com`, phone })).toBe('accepted');
    expect(await listCaptureReviews(context(), campaign.id)).toHaveLength(2);
    expect((await listCampaignLeads(context(), campaign.id, { limit: 25 })).data).toHaveLength(1);
  });

  it('enriches only empty contact fields and recognizes a later phone-only capture', async () => {
    const first = await setup('meta_ads', 'landing_page');
    const second = await setup('google_ads', 'landing_page');
    const third = await setup('google_ads', 'landing_page');
    const email = `${randomUUID()}@example.com`;
    const phone = `5511${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    expect(await capture(first.source.publicId, { submissionId: `submission-${randomUUID()}`, name: 'Original name', email })).toBe('accepted');
    expect(await capture(second.source.publicId, { submissionId: `submission-${randomUUID()}`, name: 'New name', email, phone })).toBe('accepted');
    expect(await capture(third.source.publicId, { submissionId: `submission-${randomUUID()}`, name: 'Phone only', phone })).toBe('accepted');
    const a = (await listCampaignLeads(context(), first.campaign.id, { limit: 25 })).data[0]!;
    const b = (await listCampaignLeads(context(), second.campaign.id, { limit: 25 })).data[0]!;
    const c = (await listCampaignLeads(context(), third.campaign.id, { limit: 25 })).data[0]!;
    expect(a).toMatchObject({ name: 'Original name', phone });
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(c.origin.sourceId).toBe(first.source.id);
  });

  it('lists a contact in campaign B without disclosing its private origin in A', async () => {
    const first = await setup('meta_ads', 'landing_page');
    const second = await setup('google_ads', 'landing_page');
    const reader: Actor = { ...actor, userId: randomUUID() };
    await adminPool.query('insert into iam.principals(id) values($1)', [reader.userId]);
    await adminPool.query('insert into iam.memberships(tenant_id,principal_id,role) values($1,$2,\'member\')', [reader.tenantId, reader.userId]);
    await adminPool.query('insert into marketing_ops.campaign_members(tenant_id,campaign_id,user_id,member_role,created_by) values($1,$2,$3,\'viewer\',$4)', [reader.tenantId, second.campaign.id, reader.userId, actor.userId]);
    const email = `${randomUUID()}@example.com`;
    expect(await capture(first.source.publicId, { submissionId: `submission-${randomUUID()}`, name: 'Ana', email })).toBe('accepted');
    expect(await capture(second.source.publicId, { submissionId: `submission-${randomUUID()}`, name: 'Ana', email })).toBe('accepted');
    const rows = await listCampaignLeads(context(reader), second.campaign.id, { limit: 25 });
    expect(rows.data).toHaveLength(1);
    expect(rows.data[0]?.origin).toBeNull();
    const stored = await adminPool.query('select origin_campaign_id,origin_source_id from marketing_ops.lead_contacts where id=$1', [rows.data[0]!.id]);
    expect(stored.rows[0]).toMatchObject({ origin_campaign_id: first.campaign.id, origin_source_id: first.source.id });
  });

  it('serializes import and public capture without a campaign/advisory lock inversion', async () => {
    const { campaign, source } = await setup('meta_ads', 'landing_page');
    const preview = await previewLeadImport(context(), campaign.id, { sourceId: source.id, rows: [{ name: 'Import', email: `${randomUUID()}@example.com`, occurredAt: '2025-09-30T12:00:00Z' }] }, randomUUID());
    const blocker = await adminPool.connect();
    let importerPid: number | null = null;
    const trackedPool = { connect: async () => {
      const client = await pool.connect();
      importerPid = (await client.query('select pg_backend_pid() as pid')).rows[0].pid;
      return client;
    } } as unknown as pg.Pool;
    await blocker.query('begin');
    await blocker.query('set local statement_timeout=\'5s\'');
    await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`lead-ingestion:${actor.tenantId}`]);
    const confirmation = confirmLeadImport({ ...context(), pool: trackedPool }, campaign.id, preview.id, { decisions: [{ rowIndex: 0, action: 'create' }] }, randomUUID())
      .then(receipt => ({ receipt, error: null }), error => ({ receipt: null, error }));
    try {
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        if (importerPid) {
          const state = await adminPool.query('select wait_event from pg_stat_activity where pid=$1', [importerPid]);
          waiting = state.rows[0]?.wait_event?.toLowerCase() === 'advisory';
        }
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting, 'Importer reached the advisory-lock barrier').toBe(true);
      const input = { submissionId: `concurrent-${randomUUID()}`, name: 'Concurrent form', email: `${randomUUID()}@example.com` };
      const captured = await blocker.query('select marketing_ops_private.capture_public_lead($1,$2,$3,$4,$5,null,null,$6::jsonb,$7,$8::uuid) as result', [source.publicId, 'https://lead-test.example', input.submissionId, input.name, input.email, '{}', hashCanonicalPayload(input), randomUUID()]);
      expect(captured.rows[0]?.result).toBe('accepted');
      await blocker.query('commit');
      const imported = await confirmation;
      expect(imported.error).toBeNull();
      expect(imported.receipt?.created).toBe(1);
      expect((await listCampaignLeads(context(), campaign.id, { limit: 25 })).data).toHaveLength(2);
    } finally {
      await blocker.query('rollback');
      blocker.release();
      await confirmation;
    }
  }, 15000);
});
