import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { CommandContext } from './context.js';

const actor = { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'test', role: 'manager' as const };
function context(allowed: boolean) {
  const query = vi.fn(async (text: string) => {
    if (text.includes('from marketing_ops.campaigns')) return { rows: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'active' }], rowCount: 1 };
    if (text.includes('can_edit_campaign')) return { rows: [{ allowed }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  return { context: { actor, pool: { connect: async () => ({ query, release() {} }) } as unknown as Pool, correlationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', origin: 'rest' } as CommandContext, query };
}

describe('lead ingestion authority', () => {
  it('denies mutation when a campaign is visible but not editable', async () => {
    const domain = await import('./leads.js').catch(() => ({} as any));
    expect(domain.createLeadSource).toBeDefined();
    const c = context(false);
    await expect(domain.createLeadSource(c.context, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', { name: 'Maps', kind: 'manual', channel: 'google_maps' }, 'request-one')).rejects.toMatchObject({ status: 403 });
    expect(c.query.mock.calls.some(([sql]) => sql.includes('insert into marketing_ops.lead_sources'))).toBe(false);
  });
  it('rolls back a denied mutation and always releases the connection', async () => {
    const domain = await import('./leads.js').catch(() => ({} as any));
    expect(domain.createLeadSource).toBeDefined();
    const c = context(false);
    await expect(domain.createLeadSource(c.context, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', { name: 'Maps', kind: 'manual', channel: 'google_maps' }, 'request-two')).rejects.toBeDefined();
    expect(c.query.mock.calls.map(([sql]) => sql)).toContain('rollback');
  });
  it('identifies same-file receipts independently of key order and email case', async () => {
    const domain = await import('./leads.js').catch(() => ({} as any));
    expect(domain.leadReceiptKey).toBeDefined();
    const first = { name: 'Ana', email: 'ana@example.com', occurredAt: '2025-09-30T12:00:00Z' };
    expect(domain.leadReceiptKey(first)).toBe(domain.leadReceiptKey({ occurredAt: first.occurredAt, email: first.email, name: first.name }));
    expect(domain.leadReceiptKey({ ...first, externalId: 'platform-lead-id' })).toBe('external:platform-lead-id');
  });
});
