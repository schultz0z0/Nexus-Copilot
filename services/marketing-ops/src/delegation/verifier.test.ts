import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { verifyDelegation } from './verifier.js';

const activeKey = 'active-local-delegation-key-at-least-32-bytes';
const keyring = {
  activeKid: 'v2',
  activeKey,
  issuer: 'nexus-chat-bridge',
  audience: 'nexus-marketing-ops',
  maxTtlSeconds: 120
};
const opaqueReference = 'mopref_AQIDBAUGBwgJCgsMDQ4PEBES';

const pool = {
  query: vi.fn().mockResolvedValue({
    rows: [{
      user_id: '11111111-1111-4111-8111-111111111111',
      tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tenant_slug: 'ens',
      role: 'member'
    }]
  })
} as unknown as Pool;

async function token(scopes = ['campaign:read', 'campaign:write']) {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actor_role: 'member',
    scopes,
    chat_session_id: randomUUID(),
    run_id: randomUUID(),
    correlation_id: randomUUID(),
    contract_version: 1
  }).setProtectedHeader({ alg: 'HS256', kid: 'v2' })
    .setIssuer('nexus-chat-bridge')
    .setAudience('nexus-marketing-ops')
    .setSubject('11111111-1111-4111-8111-111111111111')
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt - 1)
    .setExpirationTime(issuedAt + 60)
    .sign(new TextEncoder().encode(activeKey));
}

describe('opaque delegation verification', () => {
  it('resolves a valid opaque reference exactly once before normal JWT verification', async () => {
    const signed = await token();
    const resolveDelegation = vi.fn().mockResolvedValue(signed);

    await expect(verifyDelegation(opaqueReference, ['campaign:read'], {
      pool,
      keyring,
      resolveDelegation
    })).resolves.toMatchObject({ role: 'member', tenantSlug: 'ens' });

    expect(resolveDelegation).toHaveBeenCalledOnce();
    expect(resolveDelegation).toHaveBeenCalledWith(opaqueReference);
  });

  it('keeps direct signed JWT compatibility without invoking the resolver', async () => {
    const signed = await token();
    const resolveDelegation = vi.fn();

    await expect(verifyDelegation(signed, ['campaign:read'], {
      pool,
      keyring,
      resolveDelegation
    })).resolves.toMatchObject({ role: 'member' });

    expect(resolveDelegation).not.toHaveBeenCalled();
  });

  it('fails closed for malformed opaque references without treating them as JWTs', async () => {
    const resolveDelegation = vi.fn();

    await expect(verifyDelegation('mopref_not-valid', ['campaign:read'], {
      pool,
      keyring,
      resolveDelegation
    })).rejects.toMatchObject({ code: 'delegation_invalid', status: 401 });

    expect(resolveDelegation).not.toHaveBeenCalled();
  });

  it('does not allow a resolved token to bypass scope validation', async () => {
    const resolveDelegation = vi.fn().mockResolvedValue(await token(['campaign:read']));

    await expect(verifyDelegation(opaqueReference, ['campaign:write'], {
      pool,
      keyring,
      resolveDelegation
    })).rejects.toMatchObject({ code: 'delegation_scope_denied', status: 403 });
  });
});
