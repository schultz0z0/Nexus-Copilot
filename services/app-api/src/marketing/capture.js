import { createHmac, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const publicHeaders = ['origin', 'content-type', 'access-control-request-method', 'access-control-request-headers'];
const responseHeaders = ['content-type', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-max-age', 'vary', 'retry-after', 'referrer-policy'];

// Public capabilities are resolved by Marketing Ops. Session/tenant authority is
// deliberately absent; per-source CORS replaces the authenticated app policy.
export async function captureRoutes(fastify, { config, fetch: fetchOverride, captureProxyLookup }) {
  const marketing = config.marketingOps;
  const fetchImpl = fetchOverride ?? globalThis.fetch;
  const normalizeIp = value => value?.replace(/^::ffff:/, '') ?? '';
  let proxyAddresses = [];
  let proxyLookupAt = 0;
  const limits = new Map();
  const trustedClient = async request => {
    const socketIp = normalizeIp(request.raw.socket.remoteAddress ?? request.ip);
    // Only the actual Chat Web reverse proxy may supply X-Real-IP. Client
    // X-Forwarded-For and direct requests never gain this trust.
    if (Date.now() >= proxyLookupAt) {
      proxyLookupAt = Date.now() + 30_000;
      try { proxyAddresses = (await (captureProxyLookup ?? lookup)('chat-web', { all: true })).map(entry => normalizeIp(entry.address)); }
      catch { proxyAddresses = []; }
    }
    const forwarded = request.headers['x-real-ip'];
    return proxyAddresses.includes(socketIp) && typeof forwarded === 'string' && isIP(forwarded)
      ? normalizeIp(forwarded) : socketIp;
  };
  const proxy = (whatsapp = false) => async (request, reply) => {
    const { publicId } = request.params;
    reply.header('cache-control', 'no-store');
    if (!/^[a-zA-Z0-9_-]{20,128}$/.test(publicId)) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    const correlationId = randomUUID();
    const clientAddress = await trustedClient(request);
    const limitKey = `${publicId}:${clientAddress}`;
    const now = Date.now();
    const bucket = limits.get(limitKey);
    if (bucket && bucket.until > now && bucket.count >= 60) {
      return reply.header('retry-after', String(Math.ceil((bucket.until - now) / 1000))).code(429).send({ error: { code: 'rate_limited', message: 'Try again shortly' } });
    }
    limits.set(limitKey, bucket && bucket.until > now ? { ...bucket, count: bucket.count + 1 } : { count: 1, until: now + 60_000 });
    if (limits.size > 10000) {
      for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
      if (limits.size > 10000) limits.delete(limits.keys().next().value);
    }
    const headers = new Headers({ 'x-correlation-id': correlationId });
    for (const name of publicHeaders) {
      const value = request.headers[name];
      if (typeof value === 'string') headers.set(name, value);
    }
    if (marketing.assertion?.activeKey) {
      const timestamp = String(Math.floor(now / 1000));
      headers.set('x-ens-capture-client', clientAddress);
      headers.set('x-ens-capture-time', timestamp);
      headers.set('x-ens-capture-kid', marketing.assertion.activeKid);
      headers.set('x-ens-capture-signature', createHmac('sha256', marketing.assertion.activeKey).update(`${publicId}\n${timestamp}\n${clientAddress}`).digest('hex'));
    }
    const body = request.method === 'POST' ? JSON.stringify(request.body ?? {}) : undefined;
    try {
      const upstream = await fetchImpl(`${marketing.internalUrl}/public/capture/${encodeURIComponent(publicId)}${whatsapp ? '/whatsapp' : ''}`, {
        method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(marketing.timeoutMs)
      });
      reply.code(upstream.status).header('x-correlation-id', correlationId);
      for (const name of responseHeaders) {
        const value = upstream.headers.get(name);
        if (value) reply.header(name, value);
      }
      if (whatsapp && upstream.status >= 300 && upstream.status < 400) {
        // Defend the public edge even if an upstream destination regresses.
        const location = upstream.headers.get('location');
        let destination;
        try { destination = new URL(location); } catch { /* rejected below */ }
        if (!destination || destination.origin !== 'https://wa.me' || !/^\/[1-9][0-9]{7,14}$/.test(destination.pathname) || destination.username || destination.password) {
          return reply.code(502).send({ error: { code: 'invalid_destination', message: 'Destination unavailable' } });
        }
        reply.header('location', destination.href);
      }
      return upstream.body ? reply.send(Readable.fromWeb(upstream.body)) : reply.send();
    } catch (error) {
      const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return reply.code(timeout ? 504 : 503).send({ error: { code: 'capture_unavailable', message: 'Capture temporarily unavailable', correlationId } });
    }
  };
  fastify.route({ method: ['POST', 'OPTIONS'], url: '/api/capture/:publicId', config: { cors: false }, bodyLimit: 16_384, handler: proxy() });
  fastify.route({ method: 'GET', url: '/api/capture/:publicId/whatsapp', config: { cors: false }, handler: proxy(true) });
}
