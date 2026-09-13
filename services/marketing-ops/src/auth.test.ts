import { describe, expect, it, vi } from 'vitest';
import { resolveActor } from './auth/actor.js';
import { authorize } from './auth/permissions.js';
import { withActorTransaction } from './db/actorTransaction.js';

describe('trusted actor boundary', () => {
  it('resolves role and tenant from canonical IAM, not client data', async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{
      user_id: '11111111-1111-4111-8111-111111111111',
      tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenant_slug: 'ens', role: 'member'
    }] }));
    const actor = await resolveActor({ query } as never,
      '11111111-1111-4111-8111-111111111111', 'ens');
    expect(actor).toMatchObject({ role: 'member', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('marketing_ops_private.resolve_actor');
    expect(values).toEqual(['11111111-1111-4111-8111-111111111111', 'ens']);
  });

  it('rejects when canonical IAM has no matching active membership', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await expect(resolveActor(pool as never,
      '11111111-1111-4111-8111-111111111111', 'ens'))
      .rejects.toMatchObject({ code: 'tenant_forbidden' });
  });

  it('enforces the permission matrix', () => {
    const member = { userId: 'u', tenantId: 't', tenantSlug: 'ens', role: 'member' as const };
    const manager = { ...member, role: 'manager' as const };
    expect(() => authorize(member, 'campaign.create')).not.toThrow();
    expect(() => authorize(member, 'campaign.transition')).not.toThrow();
    expect(() => authorize(member, 'campaign.reopen')).toThrow(/permission/i);
    expect(() => authorize(member, 'campaign.archive')).toThrow(/permission/i);
    expect(() => authorize(manager, 'campaign.reopen')).not.toThrow();
    expect(() => authorize(member, 'participant.manage')).not.toThrow();
    expect(() => authorize(member, 'participant.owner.manage')).toThrow(/permission/i);
    expect(() => authorize(manager, 'participant.owner.manage')).not.toThrow();
  });

  it('sets only canonical transaction-local app context', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push(values ? { sql, values } : { sql });
        return { rows: [] };
      }), release: vi.fn()
    };
    const actor = {
      userId: '11111111-1111-4111-8111-111111111111',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'member' as const
    };
    await withActorTransaction({ connect: vi.fn(async () => client) } as never,
      actor, 'f1111111-1111-4111-8111-111111111111', async () => 'ok');
    const source = queries.map(({ sql }) => sql).join('\n');
    for (const setting of ['app.user_id', 'app.tenant_id', 'app.actor_role',
      'app.actor_type', 'app.origin', 'app.correlation_id']) expect(source).toContain(setting);
    expect(source).not.toMatch(/request\.jwt|marketing_ops\.tenant_id|set local role/i);
    expect(queries.at(-1)?.sql).toBe('commit');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back actor transactions on failure', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    const actor = {
      userId: '11111111-1111-4111-8111-111111111111',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'member' as const
    };
    await expect(withActorTransaction({ connect: async () => client } as never,
      actor, 'f1111111-1111-4111-8111-111111111111', async () => { throw new Error('injected'); }))
      .rejects.toThrow('injected');
    expect(client.query).toHaveBeenCalledWith('rollback');
  });
});
