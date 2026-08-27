import { describe, expect, it, vi } from 'vitest';
import { createDelegationRefresher } from './refresher.js';

const config = {
  url: 'http://app-bridge:8080/internal/marketing-ops/delegations/refresh',
  internalKey: 'internal-refresh-key-at-least-32-bytes',
  timeoutMs: 1_000
};

describe('delegation refresher', () => {
  it('exchanges an expired delegation through the authenticated bridge endpoint', async () => {
    const freshToken = 'fresh-token-at-least-20-characters';
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ delegation_token: freshToken }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const refresh = createDelegationRefresher(config, { fetch });

    await expect(refresh('expired-token')).resolves.toBe(freshToken);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(config.url, expect.objectContaining({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': config.internalKey
      },
      body: JSON.stringify({ delegation_token: 'expired-token' })
    }));
  });

  it('reports bridge failures as an unavailable dependency', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    const refresh = createDelegationRefresher(config, { fetch });

    await expect(refresh('expired-token')).rejects.toMatchObject({
      code: 'dependency_unavailable',
      status: 503
    });
  });
});
