import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { registerWebAnalytics } from './webAnalytics.js';
import { registerAds } from './ads.js';
import type { WebAnalyticsService } from '../../domain/webAnalytics.js';
import type { AdsIntegrationService } from '../../domain/ads.js';
import { AppError } from '../../errors.js';
function setup(write = true) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.actor = { userId: '22222222-2222-4222-8222-222222222222', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'manager' };
        req.correlationId = '12345678-1234-4234-8234-123456789abc';
        next();
    });
    const analytics = { list: vi.fn(async () => []), authorize: vi.fn(async () => ({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth' })), ownsState: vi.fn(async () => true), callback: vi.fn(async () => ({ provider: 'ga4' })), connectClarity: vi.fn(async () => ({ version: 1 })), selectResource: vi.fn(async () => ({ version: 2 })), sync: vi.fn(async () => ({ status: 'completed' })), results: vi.fn(async () => ({ totals: null })) };
    const ads = { callback: vi.fn(async () => ({ provider: 'google' })) };
    registerWebAnalytics(app, analytics as unknown as WebAnalyticsService, { read: true, write });
    registerAds(app, ads as unknown as AdsIntegrationService, { read: true, write }, analytics as unknown as WebAnalyticsService);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof AppError ? error.status : 400).json({ error: { code: error instanceof AppError ? error.code : 'validation_error' } }));
    return { app, analytics, ads };
}
describe('web analytics HTTP boundaries', () => {
    it('accepts a strict organic GA4 read scope and rejects it for Clarity or synchronization', async () => {
        const { app, analytics } = setup();
        const query = 'from=2026-09-01&to=2026-09-02&scope=organic';
        expect((await request(app).get(`/v1/web-analytics/ga4/results?${query}`)).status).toBe(200);
        expect(analytics.results).toHaveBeenCalledWith(expect.anything(),'ga4',{from:'2026-09-01',to:'2026-09-02',scope:'organic'});
        expect((await request(app).get(`/v1/web-analytics/clarity/results?${query}`)).status).toBe(400);
        expect((await request(app).get('/v1/web-analytics/ga4/results?scope=paid')).status).toBe(400);
        expect((await request(app).post('/v1/web-analytics/ga4/sync').set('Idempotency-Key','read-only-scope').send({from:'2026-09-01',to:'2026-09-02',scope:'organic'})).status).toBe(400);
        expect(analytics.sync).not.toHaveBeenCalled();
    });
    it('preserves the trusted GA4 intent header on a denied callback without consuming an Ads state', async () => {
        const { app, analytics, ads } = setup();
        analytics.callback.mockRejectedValueOnce(new AppError('analytics_permission_required', 403, 'Authorization denied'));
        const result = await request(app).post('/v1/ads-integrations/google/callback').set('X-ENS-OAuth-Session', 'a'.repeat(64)).send({ state: 's'.repeat(43), error: 'access_denied' });
        expect(result.status).toBe(403);
        expect(result.headers['x-ens-oauth-intent']).toBe('ga4');
        expect(ads.callback).not.toHaveBeenCalled();
    });
    it('uses fixed routes and requires BFF session for Google authorization', async () => {
        const { app, analytics } = setup();
        expect((await request(app).post('/v1/web-analytics/ga4/authorize').send({})).status).toBe(400);
        expect(analytics.authorize).not.toHaveBeenCalled();
        expect((await request(app).post('/v1/web-analytics/ga4/authorize').set('X-ENS-OAuth-Session', 'a'.repeat(64)).send({})).status).toBe(200);
    });
    it('requires both mutation headers for private Clarity token configuration', async () => {
        const { app, analytics } = setup();
        const path = '/v1/web-analytics/clarity/connect';
        const body = { token: 'a'.repeat(30), projectId: 'abc123', projectName: 'Site' };
        expect((await request(app).post(path).send(body)).status).toBe(428);
        expect((await request(app).post(path).set('If-Match', '"0"').send(body)).status).toBe(400);
        expect(analytics.connectClarity).not.toHaveBeenCalled();
        const result = await request(app).post(path).set('If-Match', '"0"').set('Idempotency-Key', 'setup').send(body);
        expect(result.status).toBe(200);
        expect(result.headers.etag).toBe('"1"');
        expect((await request(app).post(path).set('If-Match', '"0"').set('Idempotency-Key', 'invalid').send({ ...body, redirectUri: 'https://evil.invalid' })).status).toBe(400);
    });
    it('routes a shared Google callback only using trusted state ownership', async () => {
        const { app, analytics, ads } = setup();
        const path = '/v1/ads-integrations/google/callback';
        const body = { state: 's'.repeat(43), code: 'code' };
        const result = await request(app).post(path).set('X-ENS-OAuth-Session', 'a'.repeat(64)).send(body);
        expect(result.body.data).toEqual({ provider: 'ga4' });
        expect(ads.callback).not.toHaveBeenCalled();
        analytics.ownsState.mockResolvedValueOnce(false);
        expect((await request(app).post(path).set('X-ENS-OAuth-Session', 'a'.repeat(64)).send(body)).body.data.provider).toBe('google');
        expect(ads.callback).toHaveBeenCalledTimes(1);
        expect((await request(app).post(path).set('X-ENS-OAuth-Session', 'a'.repeat(64)).send({ ...body, provider: 'ga4' })).status).toBe(400);
    });
    it('honors read/write switches and validates periods without forwarding unknown keys', async () => {
        const disabled = setup(false);
        expect((await request(disabled.app).post('/v1/web-analytics/ga4/authorize').send({})).status).toBe(503);
        const { app, analytics } = setup();
        expect((await request(app).get('/v1/web-analytics/ga4/results?from=2026-09-01&to=2026-09-02&token=hidden')).status).toBe(400);
        expect(analytics.results).not.toHaveBeenCalled();
        expect((await request(app).get('/v1/web-analytics/ga4/results?from=2026-09-01&to=2026-09-02')).status).toBe(200);
    });
});
