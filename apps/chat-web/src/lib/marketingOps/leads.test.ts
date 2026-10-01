import { describe, expect, it, vi } from 'vitest';
import { createLeadClient } from './leads';

describe('campaign acquisition BFF client', () => {
  it('confirms only explicit reviewed decisions with a stable key and session authority', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { created: 1 } }));
    const client = createLeadClient({ fetch });
    await client.confirmImport('campaign', 'preview', [{ rowIndex: 0, action: 'create' }], 'retry-key');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/marketing/campaigns/campaign/lead-imports/preview/confirm');
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('retry-key');
    expect(JSON.parse(init.body)).toEqual({ decisions: [{ rowIndex: 0, action: 'create' }] });
    expect(new Headers(init.headers).get('x-tenant-id')).toBe(null);
  });
  it('replaces a report using its observed version and preserves null metrics in reads', async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({ data: { sales: null, capturedLeads: 0 } }));
    const client = createLeadClient({ fetch });
    await client.updateReport('campaign', 'report', 2, { sourceId: 'source', periodFrom: '2026-09-21', periodTo: '2026-09-27', timeZone: 'America/Sao_Paulo', metrics: { sales: 0 } }, 'revision-key');
    expect(new Headers(fetch.mock.calls[0][1].headers).get('If-Match')).toBe('"2"');
    const result = await client.results({ from: '2026-09-01', to: '2026-09-30' });
    expect(result.data.sales).toBe(null);
    expect(fetch.mock.calls[1][0]).toBe('/api/marketing/results?from=2026-09-01&to=2026-09-30');
  });
});
