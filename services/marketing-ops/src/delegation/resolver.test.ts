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
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10_000));
        controller.enqueue(new Uint8Array(10_000));
      },
      cancel() { cancelled = true; }
    });
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const resolve = createDelegationResolver(config, { fetch });

    await expect(resolve('mopref_AQIDBAUGBwgJCgsMDQ4PEBES')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      status: 503
    });
    expect(cancelled).toBe(true);
  });

  it.each([
    ['network failure', vi.fn().mockRejectedValue(new Error('socket closed'))],
    ['upstream failure', vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))],
    ['invalid JSON', vi.fn().mockResolvedValue(new Response('{', { status: 200 }))],
    ['missing token', vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))]
  ])('maps %s to a bounded dependency error', async (_label, fetch) => {
    const resolve = createDelegationResolver(config, { fetch });

    await expect(resolve('mopref_AQIDBAUGBwgJCgsMDQ4PEBES')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      status: 503
    });
  });

  it('enforces the configured request timeout', async () => {
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    const resolve = createDelegationResolver({ ...config, timeoutMs: 5 }, { fetch });

    await expect(resolve('mopref_AQIDBAUGBwgJCgsMDQ4PEBES')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      status: 503
    });
  });
});
