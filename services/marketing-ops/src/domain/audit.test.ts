import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { writeAudit } from './audit.js';
import type { CommandContext } from './context.js';

describe('Hermes audit correlation', () => {
  it('persists the complete chat, run, tool and plan context without content text', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const context: CommandContext = {
      pool: {} as CommandContext['pool'],
      actor: {
        userId: '11111111-1111-4111-8111-111111111111',
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tenantSlug: 'ens',
        role: 'member'
      },
      correlationId: '22222222-2222-4222-8222-222222222222',
      origin: 'mcp',
      operatorOrigin: 'hermes',
      chatSessionId: '33333333-3333-4333-8333-333333333333',
      runId: '44444444-4444-4444-8444-444444444444',
      toolName: 'marketing_ops_execute_plan_v1',
      toolCallId: '55555555-5555-4555-8555-555555555555',
      planId: '66666666-6666-4666-8666-666666666666',
      planActionIndex: 2
    };

    await writeAudit(
      { query } as unknown as PoolClient,
      context,
      'content_asset',
      '77777777-7777-4777-8777-777777777777',
      'content_version.created',
      null,
      { body: 'texto confidencial', assetId: '77777777-7777-4777-8777-777777777777' }
    );

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('operator_origin');
    expect(sql).toContain('plan_action_index');
    expect(values).toEqual(expect.arrayContaining([
      'hermes',
      context.chatSessionId,
      context.runId,
      context.toolName,
      context.toolCallId,
      context.planId,
      context.planActionIndex
    ]));
    expect(JSON.stringify(values)).not.toContain('texto confidencial');
  });
});
