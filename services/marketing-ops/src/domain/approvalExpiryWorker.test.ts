import { describe, expect, it, vi } from 'vitest';
import { expireApprovalRequestsBatch } from './approvalExpiryWorker.js';

describe('approval expiry worker', () => {
  it('delegates the bounded batch atomically to the canonical database function', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ expired: 3 }] }));
    const result = await expireApprovalRequestsBatch({ query } as never, {
      now: new Date('2026-08-05T12:00:00.000Z'), limit: 500,
      tenantId: '20000000-0000-4000-8000-000000000001',
      requestId: '10000000-0000-4000-8000-000000000001'
    });
    expect(result).toEqual({ expired: 3 });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('marketing_ops_private.expire_approval_requests_batch');
    expect(values).toEqual(['2026-08-05T12:00:00.000Z', 100,
      '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001']);
  });

  it('propagates an atomic database failure without partial client-side work', async () => {
    const failure = new Error('injected database failure');
    const query = vi.fn(async () => { throw failure; });
    await expect(expireApprovalRequestsBatch({ query } as never)).rejects.toBe(failure);
    expect(query).toHaveBeenCalledOnce();
  });
});
