import express from 'express';
import type { Pool } from 'pg';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { AppError } from '../../errors.js';
import { createHmac } from 'node:crypto';
import { createApp } from '../createApp.js';
import { createLogger } from '../../observability/logger.js';
import { createMetrics } from '../../observability/metrics.js';

async function app() {
  const routes = await import('./leads.js').catch(() => ({} as any));
  expect(routes.registerPublicLeads).toBeDefined();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.correlationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; next(); });
  const pool = { query: async (sql: string) => {
    if (sql.includes('public_lead_source')) return { rows: [{ id: 'source', kind: 'landing_page', allowed_origins: ['https://example.com'] }] };
    if (sql.includes('capture_public_lead')) return { rows: [{ result: 'accepted' }] };
    if (sql.includes('record_public_whatsapp_click')) return { rows: [{ phone: '5511999999999' }] };
    return { rows: [] };
  } } as unknown as Pool;
  routes.registerPublicLeads(app, pool, { read: true, write: true });
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err instanceof AppError ? err.status : 400).json({ error: { code: err.code ?? 'validation_error' } }));
  return app;
}
const capability = 'a'.repeat(32);
it('preflights an exact configured origin without credentials', async () => {
  const response = await request(await app()).options(`/public/capture/${capability}`).set('Origin', 'https://example.com');
  expect(response.status).toBe(204);
  expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
  expect(response.headers['access-control-allow-credentials']).toBeUndefined();
});
it('rejects an unlisted origin without echoing it in CORS headers', async () => {
  const response = await request(await app()).options(`/public/capture/${capability}`).set('Origin', 'https://evil.example.com');
  expect(response.status).toBe(403);
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
});
it('accepts capture with generic response and no PII or identity fields', async () => {
  const response = await request(await app()).post(`/public/capture/${capability}`).set('Origin', 'https://example.com').send({ submissionId: 'submission-001', name: 'Ana', email: 'ana@example.com' });
  expect(response.status).toBe(202);
  expect(response.body).toEqual({ accepted: true });
});
it('rejects origin-less form submission and actor spoofing', async () => {
  expect((await request(await app()).post(`/public/capture/${capability}`).send({ submissionId: 'submission-001', name: 'Ana', email: 'ana@example.com' })).status).toBe(403);
  expect((await request(await app()).post(`/public/capture/${capability}`).set('Origin', 'https://example.com').send({ submissionId: 'submission-001', name: 'Ana', email: 'ana@example.com', tenantId: 'spoof' })).status).toBe(400);
});
it('allows WhatsApp navigation without Origin and redirects only to wa.me', async () => {
  const response = await request(await app()).get(`/public/capture/${capability}/whatsapp`);
  expect(response.status).toBe(302);
  expect(response.headers.location).toMatch(/^https:\/\/wa\.me\/5511999999999\?text=/);
  expect(response.headers['cache-control']).toContain('no-store');
});
it('accepts only fresh signed IPs from the BFF and otherwise uses socket identity', async () => {
  const routes = await import('./leads.js');
  expect((routes as any).captureClientIdentity).toBeDefined();
  const keyring = { activeKid: 'capture-test', activeKey: 'capture-test-key-with-at-least-32-bytes' };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const ip = '203.0.113.2';
  const headers: Record<string, string> = {
    'x-ens-capture-client': ip, 'x-ens-capture-time': timestamp, 'x-ens-capture-kid': keyring.activeKid,
    'x-ens-capture-signature': createHmac('sha256', keyring.activeKey).update(`${capability}\n${timestamp}\n${ip}`).digest('hex')
  };
  const req = { params: { publicId: capability }, socket: { remoteAddress: '127.0.0.1' }, header: (key: string) => headers[key] };
  expect((routes as any).captureClientIdentity(req, keyring)).toBe(ip);
  headers['x-ens-capture-client'] = '203.0.113.3';
  expect((routes as any).captureClientIdentity(req, keyring)).toBe('127.0.0.1');
  headers['x-ens-capture-client'] = ip;
  headers['x-ens-capture-time'] = String(Number(timestamp) - 60);
  expect((routes as any).captureClientIdentity(req, keyring)).toBe('127.0.0.1');
});
it('isolates more than 300 signed visitors while still throttling one visitor', async () => {
  const { registerPublicLeads } = await import('./leads.js');
  const keyring = { activeKid: 'rate-test', activeKey: 'rate-test-key-with-at-least-32-bytes' };
  const router = express.Router();
  const pool = { query: async (sql: string) => sql.includes('public_lead_source') ? { rows: [{ kind: 'landing_page', allowed_origins: ['https://example.com'] }] } : { rows: [{ result: 'accepted' }] } } as unknown as Pool;
  registerPublicLeads(router, pool, { read: true, write: true }, keyring);
  const fullApp = createApp({ readiness: async () => true, logger: createLogger(() => undefined), metrics: createMetrics(), router });
  const visitor = (ip: string) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return { Origin: 'https://example.com', 'x-ens-capture-kid': keyring.activeKid, 'x-ens-capture-client': ip, 'x-ens-capture-time': timestamp, 'x-ens-capture-signature': createHmac('sha256', keyring.activeKey).update(`${capability}\n${timestamp}\n${ip}`).digest('hex') };
  };
  for (let index = 0; index < 305; index++) {
    const response = await request(fullApp).post(`/public/capture/${capability}`).set(visitor(`2001:db8::${index.toString(16)}`)).send({ submissionId: `submission-${index}`, name: 'Ana', email: 'ana@example.com' });
    expect(response.status, `visitor ${index}`).toBe(202);
  }
  for (let index = 0; index < 31; index++) {
    const response = await request(fullApp).options(`/public/capture/${capability}`).set(visitor('203.0.113.99'));
    expect(response.status).toBe(index < 30 ? 204 : 429);
    if (index === 30) expect(response.headers['retry-after']).toBeDefined();
  }
}, 30000);

it('recovers capacity after expired capture visitor entries reach the map limit', async () => {
  const routes = await import('./leads.js');
  expect((routes as any).createCaptureLimiter).toBeDefined();
  const limit = (routes as any).createCaptureLimiter({ maxClients: 3, max: 2, windowMs: 1000 });
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    for (const key of ['one', 'two', 'three']) expect(() => limit(key)).not.toThrow();
    expect(() => limit('four')).toThrow();
    vi.mocked(Date.now).mockReturnValue(2001);
    expect(() => limit('four')).not.toThrow();
    expect(() => limit('five')).not.toThrow();
    expect(() => limit('six')).not.toThrow();
    expect(() => limit('seven')).toThrow();
  } finally {
    vi.restoreAllMocks();
  }
});
