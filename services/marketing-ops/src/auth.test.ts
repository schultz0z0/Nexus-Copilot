import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { resolveActor } from './auth/actor.js';
import { authorize } from './auth/permissions.js';
import { verifySupabaseBearer } from './auth/supabaseAuth.js';
import { withActorTransaction } from './db/actorTransaction.js';

const pool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres' });
afterAll(() => pool.end());

describe('trusted actor boundary', () => {
  it('rejects missing and invalid bearer tokens', async () => {
    await expect(verifySupabaseBearer('', { supabaseUrl: 'http://auth.local', anonKey: 'anon', fetch: vi.fn() })).rejects.toMatchObject({ code: 'unauthorized' });
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(verifySupabaseBearer('bad', { supabaseUrl: 'http://auth.local', anonKey: 'anon', fetch })).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('returns only the verified Supabase identity', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', email: 'member@local.test', user_metadata: { role: 'admin' } }), { status: 200 }));
    const user = await verifySupabaseBearer('valid', { supabaseUrl: 'http://auth.local', anonKey: 'anon', fetch });
    expect(user).toEqual({ id: '11111111-1111-4111-8111-111111111111', email: 'member@local.test' });
  });

  it('resolves role and tenant from active membership, not client data', async () => {
    const actor = await resolveActor(pool, '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(actor).toMatchObject({ role: 'member', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    await expect(resolveActor(pool, '11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).rejects.toMatchObject({ code: 'tenant_forbidden' });
    const bySlug = await resolveActor(pool, '11111111-1111-4111-8111-111111111111', 'ens');
    expect(bySlug.tenantId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
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
    expect(() => authorize(member, 'material.read')).not.toThrow();
    expect(() => authorize(member, 'material.manage')).not.toThrow();
    expect(() => authorize(member, 'reference.read')).not.toThrow();
  });

  it('sets PostgreSQL actor context and rolls back on failure', async () => {
    const actor = { userId: '11111111-1111-4111-8111-111111111111', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'member' as const };
    const correlationId = 'f1111111-1111-4111-8111-111111111111';
    await expect(withActorTransaction(pool, actor, correlationId, async (client) => {
      const context = await client.query<{ user_id: string; tenant_id: string }>("select auth.uid()::text as user_id, current_setting('marketing_ops.tenant_id') as tenant_id");
      expect(context.rows[0]).toEqual({ user_id: actor.userId, tenant_id: actor.tenantId });
      await client.query("insert into marketing_ops.campaigns (id, tenant_id, name, created_by, updated_by) values ('c9999999-9999-4999-8999-999999999999', $1, 'rollback', $2, $2)", [actor.tenantId, actor.userId]);
      throw new Error('injected');
    })).rejects.toThrow('injected');
    const result = await pool.query("select count(*)::int as count from marketing_ops.campaigns where id = 'c9999999-9999-4999-8999-999999999999'");
    expect(result.rows[0]?.count).toBe(0);
  });
});
