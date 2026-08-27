import { appError } from '../errors.js';

export type McpRateLimitKind = 'read' | 'prepare' | 'execute';

interface McpRateLimitOptions {
  windowMs: number;
  limits: Record<McpRateLimitKind, number>;
}

interface Bucket { count: number; resetAt: number }

export function createMcpRateLimiter(
  options: McpRateLimitOptions = {
    windowMs: 60_000,
    limits: { read: 60, prepare: 20, execute: 10 }
  },
  now: () => number = Date.now
) {
  const buckets = new Map<string, Bucket>();
  return {
    consume(actorId: string, toolName: string, kind: McpRateLimitKind): void {
      const timestamp = now();
      if (buckets.size > 10_000) {
        for (const [key, bucket] of buckets) if (bucket.resetAt <= timestamp) buckets.delete(key);
      }
      const key = `${actorId}:${toolName}`;
      const previous = buckets.get(key);
      const bucket = !previous || previous.resetAt <= timestamp
        ? { count: 1, resetAt: timestamp + options.windowMs }
        : { count: previous.count + 1, resetAt: previous.resetAt };
      buckets.set(key, bucket);
      if (bucket.count > options.limits[kind]) {
        throw appError('rate_limited', 429, 'Too many tool calls', {
          retry_after_seconds: Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1_000))
        });
      }
    }
  };
}
