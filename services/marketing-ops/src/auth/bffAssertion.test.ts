import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { verifyBffAssertion, type BffAssertionConfig } from './bffAssertion.js';

const activeKey = 'm6-local-bff-assertion-key-with-at-least-32-bytes';
const previousKey = 'm6-previous-bff-assertion-key-at-least-32-bytes';
const config: BffAssertionConfig = {
  activeKid: 'bff-v2', activeKey, previousKid: 'bff-v1', previousKey,
  issuer: 'ens-app-api', audience: 'ens-marketing-ops', maxTtlSeconds: 30
};
const now = new Date('2026-09-13T12:00:00.000Z');

async function token(overrides: Record<string, unknown> = {}, options: {
  kid?: string; key?: string; alg?: 'HS256' | 'HS384'
} = {}) {
  const seconds = Math.floor(now.getTime() / 1000);
  return new SignJWT({
    sub: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor_role: 'member',
    correlation_id: '22222222-2222-4222-8222-222222222222',
    method: 'GET', path: '/v1/campaigns', iss: 'ens-app-api', aud: 'ens-marketing-ops',
    jti: '33333333-3333-4333-8333-333333333333', iat: seconds, nbf: seconds - 1,
    exp: seconds + 30, ...overrides
  })
    .setProtectedHeader({ alg: options.alg ?? 'HS256', typ: 'JWT', kid: options.kid ?? 'bff-v2' })
    .sign(new TextEncoder().encode(options.key ?? activeKey));
}

describe('BFF actor assertion', () => {
  it('accepts active and previous keys and returns only validated actor claims', async () => {
    const active = await verifyBffAssertion(await token(), 'GET', '/v1/campaigns', config, now);
    expect(active).toMatchObject({ userId: '11111111-1111-4111-8111-111111111111',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'member' });
    await expect(verifyBffAssertion(await token({}, { kid: 'bff-v1', key: previousKey }),
      'GET', '/v1/campaigns', config, now)).resolves.toMatchObject({ role: 'member' });
  });

  it.each([
    ['wrong issuer', { iss: 'attacker' }, {}],
    ['wrong audience', { aud: 'elsewhere' }, {}],
    ['unknown kid', {}, { kid: 'unknown' }],
    ['wrong algorithm', {}, { alg: 'HS384' as const }],
    ['expired', { exp: Math.floor(now.getTime() / 1000) - 1 }, {}],
    ['future', { nbf: Math.floor(now.getTime() / 1000) + 10 }, {}],
    ['excessive lifetime', { exp: Math.floor(now.getTime() / 1000) + 31 }, {}],
    ['wrong method', { method: 'POST' }, {}],
    ['wrong path', { path: '/v1/approvals' }, {}]
  ])('denies %s', async (_name, claims, signing) => {
    await expect(verifyBffAssertion(await token(claims, signing),
      'GET', '/v1/campaigns', config, now)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('never includes assertion keys in an error', async () => {
    const forged = await token({}, { key: 'forged-key-that-is-at-least-thirty-two-bytes' });
    const error = await verifyBffAssertion(forged, 'GET', '/v1/campaigns', config, now)
      .then(() => { throw new Error('expected verification to fail'); }, (value: unknown) => value as Error);
    expect(JSON.stringify(error)).not.toContain(activeKey);
    expect(error.message).toBe('Invalid BFF actor assertion');
  });
});
