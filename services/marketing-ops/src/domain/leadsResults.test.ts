import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

it('returns measured zero people and unknown financial metrics for an empty workspace', async () => {
  const domain = await import('./leadsResults.js').catch(() => ({} as any));
  expect(domain.getLeadResults).toBeDefined();
  const query = vi.fn(async () => ({ rows: [] }));
  const pool = { connect: async () => ({ query, release() {} }) } as unknown as Pool;
  const result = await domain.getLeadResults({ pool, actor: { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'test', role: 'manager' }, correlationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', origin: 'rest' }, {});
  expect(result).toMatchObject({ contactsCold: 0, capturedLeads: 0, qualified: null, sales: null, revenue: null, spend: null, whatsappClicks: 0, weekly: [], channels: [], campaigns: [], lastUpdated: null });
});
