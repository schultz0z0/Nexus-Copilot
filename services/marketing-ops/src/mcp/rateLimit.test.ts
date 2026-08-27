import { describe, expect, it } from 'vitest';
import { createMcpRateLimiter } from './rateLimit.js';

describe('MCP actor/tool rate limit', () => {
  it('limits one actor and tool without consuming another bucket', () => {
    let now = 1_000;
    const limiter = createMcpRateLimiter({ windowMs: 60_000, limits: { read: 2, prepare: 1, execute: 1 } }, () => now);

    limiter.consume('actor-a', 'campaign_list', 'read');
    limiter.consume('actor-a', 'campaign_list', 'read');
    expect(() => limiter.consume('actor-a', 'campaign_list', 'read')).toThrowError(
      expect.objectContaining({ code: 'rate_limited', status: 429, details: { retry_after_seconds: 60 } })
    );
    expect(() => limiter.consume('actor-b', 'campaign_list', 'read')).not.toThrow();
    expect(() => limiter.consume('actor-a', 'campaign_get', 'read')).not.toThrow();

    now += 60_000;
    expect(() => limiter.consume('actor-a', 'campaign_list', 'read')).not.toThrow();
  });
});
