import { describe, expect, it, vi } from 'vitest';
import { createDelegationResolver } from './resolver.js';

const config = {
  url: 'http://chat-bridge:8080/internal/marketing-ops/delegations/resolve',
  internalKey: 'internal-resolution-key-at-least-32-bytes',
  timeoutMs: 1_000
};

describe('delegation resolver', () => {
  it('exchanges an opaque reference through the authenticated bridge endpoint', async () => {
    const signedToken = 'signed-token-at-least-20-characters';
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ delegation_token: signedToken }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const resolve = createDelegationResolver(config, { fetch });

    await expect(resolve('mopref_AQIDBAUGBwgJCgsMDQ4PEBES')).resolves.toBe(signedToken);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(config.url, expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': config.internalKey
      },
      body: JSON.stringify({ delegation_reference: 'mopref_AQIDBAUGBwgJCgsMDQ4PEBES' })
    }));
  });

  it.each([401, 403, 404, 409])('fails closed when the bridge rejects the reference with %s', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status }));
    const resolve = createDelegationResolver(config, { fetch });

    await expect(resolve('mopref_AQIDBAUGBwgJCgsMDQ4PEBES')).rejects.toMatchObject({
      code: 'delegation_invalid',
      status: 401
    });
  });

  it('rejects oversized bridge responses', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('x'.repeat(16_385), { status: 200 }));
    const resolve = createDelegationResolver(config, { fetch });

    await expect(resolve('mopref_AQIDBAUGBwgJCgsMDQ4PEBES')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      status: 503
    });
  });
});
