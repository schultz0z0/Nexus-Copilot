import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContext } from './context.js';
import { executeIdempotentCommand } from './idempotency.js';

const baseContext: Omit<CommandContext, 'pool'> = {
  actor: {
    userId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenantSlug: 'ens',
    role: 'member'
  },
  correlationId: '33333333-3333-4333-8333-333333333333',
  origin: 'mcp'
};

describe('idempotency execution metadata', () => {
  it('reports a miss for a new command and a hit for a completed replay', async () => {
    const missTracker = vi.fn();
    const newClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ request_hash: 'hash' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
    } as unknown as PoolClient;
    const created = await executeIdempotentCommand(
      newClient,
      { ...baseContext, pool: {} as CommandContext['pool'], idempotencyTracker: missTracker },
      'campaign.create',
      'key-new',
      { name: 'Campanha' },
      async () => ({ id: 'created' })
    );
    expect(created).toEqual({ id: 'created' });
    expect(missTracker).toHaveBeenCalledOnce();
    expect(missTracker).toHaveBeenCalledWith(false);

    const hitTracker = vi.fn();
    const replayClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ request_hash: expect.any(String), status: 'completed', response_ref: { id: 'created' } }]
        })
    } as unknown as PoolClient;
    const payload = { name: 'Campanha' };
    const hashClient = newClient.query as ReturnType<typeof vi.fn>;
    const insertedArgs = hashClient.mock.calls[0]?.[1] as unknown[];
    const requestHash = insertedArgs[4];
    (replayClient.query as ReturnType<typeof vi.fn>).mockReset()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ request_hash: requestHash, status: 'completed', response_ref: { id: 'created' } }]
      });
    const replayed = await executeIdempotentCommand(
      replayClient,
      { ...baseContext, pool: {} as CommandContext['pool'], idempotencyTracker: hitTracker },
      'campaign.create',
      'key-new',
      payload,
      async () => ({ id: 'duplicate' })
    );
    expect(replayed).toEqual({ id: 'created' });
    expect(hitTracker).toHaveBeenCalledWith(true);
  });
});
