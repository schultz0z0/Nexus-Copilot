import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/server.js';

const publicId = 'abc123456789abcdefghijklmnop';
const config = {
  cookieSecret: 'test-cookie-secret', corsOrigin: true,
  marketingOps: { internalUrl: 'http://marketing-ops:8091', timeoutMs: 100, maxBodyBytes: 1024 }
};
const db = { query: async () => { throw new Error('Public capture must not resolve a session'); } };

test('public capture forwards only bounded payload and public headers without session authority', async () => {
  let captured;
  const app = await createApp({ config, db, fetch: async (url, init) => {
    captured = { url, init };
    return Response.json({ accepted: true }, { status: 202, headers: { 'access-control-allow-origin': 'https://lp.example.test' } });
  } });
  try {
    const response = await app.inject({ method: 'POST', url: `/api/capture/${publicId}`, headers: {
      origin: 'https://lp.example.test', 'content-type': 'application/json', cookie: 'ens_session=ignored',
      authorization: 'Bearer forged', 'x-tenant-id': 'forged', 'x-ens-actor-assertion': 'forged'
    }, payload: { submissionId: 'submission-1', name: 'Example', email: 'example@example.test' } });
    assert.equal(response.statusCode, 202);
    assert.equal(captured.url, `http://marketing-ops:8091/public/capture/${publicId}`);
    const headers = new Headers(captured.init.headers);
    for (const name of ['cookie', 'authorization', 'x-tenant-id', 'x-ens-actor-assertion']) assert.equal(headers.get(name), null);
    assert.equal(headers.get('origin'), 'https://lp.example.test');
    assert.equal(response.headers['access-control-allow-origin'], 'https://lp.example.test');
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
    assert.equal(response.headers['cache-control'], 'no-store');
  } finally { await app.close(); }
});

test('preflight checks the source upstream instead of reflecting the global CORS policy', async () => {
  let calls = 0;
  const app = await createApp({ config, db, fetch: async (_, init) => {
    calls++;
    assert.equal(init.method, 'OPTIONS');
    return new Response(null, { status: 403 });
  } });
  try {
    const response = await app.inject({ method: 'OPTIONS', url: `/api/capture/${publicId}`, headers: {
      origin: 'https://unapproved.example.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type'
    } });
    assert.equal(calls, 1);
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  } finally { await app.close(); }
});

test('WhatsApp forwards a fixed upstream redirect and discards client query destinations', async () => {
  let captured;
  const app = await createApp({ config, db, fetch: async (url, init) => {
    captured = { url, init };
    return new Response(null, { status: 302, headers: { location: 'https://wa.me/5511999999999?text=Campaign' } });
  } });
  try {
    const response = await app.inject(`/api/capture/${publicId}/whatsapp?redirect=https://evil.example.test`);
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, 'https://wa.me/5511999999999?text=Campaign');
    assert.equal(captured.url, `http://marketing-ops:8091/public/capture/${publicId}/whatsapp`);
    assert.equal(captured.init.redirect, 'manual');
  } finally { await app.close(); }
});

test('capture rejects unsafe public ids and oversized payloads before proxying', async () => {
  let calls = 0;
  const app = await createApp({ config, db, fetch: async () => { calls++; return new Response(); } });
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/api/capture/bad', payload: {} })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: `/api/capture/${publicId}`, payload: { name: 'a'.repeat(20000) } })).statusCode, 413);
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test('signs only trusted proxy client IPs and preserves rate-limit/redirect safety headers', async () => {
  const signedConfig = { ...config, marketingOps: { ...config.marketingOps, assertion: { activeKey: 'test-key-only-32-bytes-for-capture', activeKid: 'test-v1' } } };
  const captured = [];
  const app = await createApp({ config: signedConfig, db, captureProxyLookup: async () => [{ address: '10.0.0.2' }], fetch: async (_, init) => {
    captured.push(new Headers(init.headers));
    return new Response(null, { status: 429, headers: { 'retry-after': '15', 'referrer-policy': 'no-referrer' } });
  } });
  try {
    for (const remoteAddress of ['10.0.0.2', '10.0.0.99']) {
      const response = await app.inject({ method: 'POST', url: `/api/capture/${publicId}`, remoteAddress,
        headers: { 'x-real-ip': '203.0.113.7', 'x-ens-capture-client': 'forged', 'x-ens-capture-signature': 'forged' }, payload: {} });
      assert.equal(response.headers['retry-after'], '15');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
    }
    assert.equal(captured[0].get('x-ens-capture-client'), '203.0.113.7');
    assert.equal(captured[1].get('x-ens-capture-client'), '10.0.0.99');
    for (const headers of captured) {
      const payload = `${publicId}\n${headers.get('x-ens-capture-time')}\n${headers.get('x-ens-capture-client')}`;
      assert.equal(headers.get('x-ens-capture-signature'), createHmac('sha256', signedConfig.marketingOps.assertion.activeKey).update(payload).digest('hex'));
    }
  } finally { await app.close(); }
});

test('public edge limits repeated requests and rejects an unsafe upstream redirect', async () => {
  let calls = 0;
  const app = await createApp({ config, db, captureProxyLookup: async () => [], fetch: async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://evil.example.test' } });
  } });
  try {
    for (let index = 0; index < 60; index++) assert.equal((await app.inject(`/api/capture/${publicId}/whatsapp`)).statusCode, 502);
    assert.equal((await app.inject(`/api/capture/${publicId}/whatsapp`)).statusCode, 429);
    assert.equal(calls, 60);
  } finally { await app.close(); }
});
