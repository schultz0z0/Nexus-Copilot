import { describe, expect, it } from 'vitest';

async function contracts(): Promise<any> {
  return import('./leadsContracts.js').catch(() => ({}));
}

describe('lead ingestion contracts', () => {
  it('normalizes email and phone without guessing a country prefix', async () => {
    const c = await contracts();
    expect(c.LeadRowSchema).toBeDefined();
    const row = c.LeadRowSchema.parse({ name: ' Ana ', email: 'ANA@EXAMPLE.COM ', phone: '+55 (11) 99999-1234', occurredAt: '2025-09-30T12:00:00Z' });
    expect(row).toMatchObject({ name: 'Ana', email: 'ana@example.com', phone: '5511999991234' });
  });
  it('rejects missing contact data, future dates and unrecognized fields', async () => {
    const c = await contracts();
    expect(c.LeadRowSchema).toBeDefined();
    expect(() => c.LeadRowSchema.parse({ name: 'Ana', occurredAt: '2025-09-30T12:00:00Z' })).toThrow();
    expect(() => c.LeadRowSchema.parse({ name: 'Ana', email: 'ana@example.com', occurredAt: '2999-01-01T00:00:00Z' })).toThrow();
    expect(() => c.LeadRowSchema.parse({ name: 'Ana', phone: '123', occurredAt: '2025-09-30T12:00:00Z', tenantId: 'spoof' })).toThrow();
  });
  it('requires origin whitelists for a landing page and phone for whatsapp', async () => {
    const c = await contracts();
    expect(c.LeadSourceInputSchema).toBeDefined();
    expect(() => c.LeadSourceInputSchema.parse({ name: 'Form', channel: 'meta_ads', kind: 'landing_page' })).toThrow();
    expect(() => c.LeadSourceInputSchema.parse({ name: 'Chat', channel: 'google_ads', kind: 'whatsapp' })).toThrow();
    expect(c.LeadSourceInputSchema.parse({ name: 'Form', channel: 'meta_ads', kind: 'landing_page', allowedOrigins: ['https://example.com'] })).toMatchObject({ enabled: true, classification: 'lead' });
    expect(() => c.LeadSourceInputSchema.parse({ name: 'Form', channel: 'meta_ads', kind: 'landing_page', allowedOrigins: ['https://example.com/path'] })).toThrow();
  });
  it('maps Google Maps to cold by default and permits explicit warm interest', async () => {
    const c = await contracts();
    expect(c.LeadSourceInputSchema).toBeDefined();
    expect(c.LeadSourceInputSchema.parse({ name: 'Maps', channel: 'google_maps', kind: 'manual' }).classification).toBe('cold');
    expect(c.LeadSourceInputSchema.parse({ name: 'Maps interested', channel: 'google_maps', kind: 'manual', classification: 'lead' }).classification).toBe('lead');
  });
  it('rejects invalid report windows and validates the timezone and metric hierarchy', async () => {
    const c = await contracts();
    expect(c.ResultReportInputSchema).toBeDefined();
    const report = { sourceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', periodFrom: '2026-09-01', periodTo: '2026-09-07', timeZone: 'America/Sao_Paulo', metrics: { sent: 100, delivered: 90, opened: 40, spend: 0 } };
    expect(c.ResultReportInputSchema.parse(report).metrics).toEqual(report.metrics);
    expect(() => c.ResultReportInputSchema.parse({ ...report, periodTo: '2026-08-01' })).toThrow();
    expect(() => c.ResultReportInputSchema.parse({ ...report, timeZone: 'Fake/Zone' })).toThrow();
    expect(() => c.ResultReportInputSchema.parse({ ...report, metrics: { sent: 10, delivered: 11 } })).toThrow();
    expect(() => c.ResultReportInputSchema.parse({ ...report, metrics: { leads: 100 } })).toThrow();
  });
  it('public capture refuses actor, tenant, campaign and channel supplied in the body', async () => {
    const c = await contracts();
    expect(c.PublicCaptureSchema).toBeDefined();
    const payload = { submissionId: 'form-entry-1', name: 'Ana', email: 'ana@example.com' };
    expect(c.PublicCaptureSchema.parse(payload).email).toBe('ana@example.com');
    for (const key of ['actor', 'tenantId', 'campaignId', 'channel']) expect(() => c.PublicCaptureSchema.parse({ ...payload, [key]: 'spoof' })).toThrow();
  });
});
