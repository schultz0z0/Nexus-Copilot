import { describe, expect, it, vi } from 'vitest';
import { expireApprovalRequestsBatch } from './approvalExpiryWorker.js';

describe('approval expiry worker', () => {
  it('uses a bounded service transaction and records system ownership', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push(values ? { sql, values } : { sql });
      if (sql.includes('from marketing_ops.approval_requests as request')) {
        return { rows: [{
          id: '10000000-0000-4000-8000-000000000001',
          tenant_id: '20000000-0000-4000-8000-000000000001',
          campaign_id: '30000000-0000-4000-8000-000000000001',
          kind: 'operational',
          requested_by: '40000000-0000-4000-8000-000000000001',
          action_package_id: '50000000-0000-4000-8000-000000000001',
          version: 1
        }] };
      }
      if (sql.includes('insert into marketing_ops.approval_decisions')) return { rows: [{ id: 'decision' }] };
      if (sql.includes('update marketing_ops.approval_requests')) return { rows: [{ id: 'request' }] };
      if (sql.includes('update marketing_ops.action_packages')) return { rows: [{ id: 'package' }] };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) };

    const result = await expireApprovalRequestsBatch(pool as never, {
      now: new Date('2026-08-05T12:00:00.000Z'),
      limit: 500
    });

    expect(result).toEqual({ expired: 1 });
    expect(queries.some(({ sql }) => sql.includes('set local role service_role'))).toBe(true);
    expect(queries.find(({ sql }) => sql.includes('for update skip locked'))?.values?.at(-1)).toBe(100);
    expect(queries.some(({ sql }) => sql.includes("null, null, 'system'"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes("'service', 'internal'"))).toBe(true);
    expect(queries.at(-1)?.sql).toBe('commit');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back the whole batch when the package projection cannot transition', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('from marketing_ops.approval_requests as request')) return { rows: [{
        id: '10000000-0000-4000-8000-000000000001', tenant_id: '20000000-0000-4000-8000-000000000001',
        campaign_id: '30000000-0000-4000-8000-000000000001', kind: 'operational',
        requested_by: '40000000-0000-4000-8000-000000000001',
        action_package_id: '50000000-0000-4000-8000-000000000001', version: 1
      }] };
      if (sql.includes('insert into marketing_ops.approval_decisions')) return { rows: [{ id: 'decision' }] };
      if (sql.includes('update marketing_ops.approval_requests')) return { rows: [{ id: 'request' }] };
      if (sql.includes('update marketing_ops.action_packages')) return { rows: [] };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };

    await expect(expireApprovalRequestsBatch({ connect: async () => client } as never))
      .rejects.toThrow('non-expirable action package');
    expect(query).toHaveBeenCalledWith('rollback');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
