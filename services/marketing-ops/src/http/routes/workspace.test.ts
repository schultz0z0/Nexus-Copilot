import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { registerWorkspace } from './workspace.js';
import type { WorkspaceIntegrationService } from '../../domain/workspace.js';
import { AppError } from '../../errors.js';
function setup(write = true) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.actor = { userId: '33333333-3333-4333-8333-333333333333', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'admin' };
        req.correlationId = '11111111-1111-4111-8111-111111111111';
        next();
    });
    const service = { setupApp: vi.fn(async () => ({ version: 1 })), authorize: vi.fn(async () => ({ url: 'https://accounts.google.com/o/oauth2/v2/auth' })), callback: vi.fn(async () => ({ service: 'google_gmail' })), sendDraft: vi.fn(async () => ({ status: 'completed' })), resources: vi.fn(async () => ({ items: [], nextPage: null, truncated: false })), publishEvent: vi.fn(async () => ({ status: 'completed' })) };
    registerWorkspace(app, service as unknown as WorkspaceIntegrationService, { read: true, write });
    app.use((e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(e instanceof AppError ? e.status : 400).json({ error: { code: e instanceof AppError ? e.code : 'validation_error' } }));
    return { app, service };
}
describe('workspace HTTP trust boundaries', () => {
    it('requires mutation headers and refuses arbitrary callback config', async () => {
        const { app, service } = setup();
        const path = '/v1/workspace/apps/google';
        expect((await request(app).post(path).send({ clientId: 'client', clientSecret: 'secret' })).status).toBe(428);
        expect((await request(app).post(path).set('If-Match', '"0"').set('Idempotency-Key', 'setup').send({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://evil.invalid' })).status).toBe(400);
        expect(service.setupApp).not.toHaveBeenCalled();
        expect((await request(app).post(path).set('If-Match', '"0"').set('Idempotency-Key', 'setup').send({ clientId: 'client', clientSecret: 'secret' })).status).toBe(200);
    });
    it('binds authorize and callback to BFF session and fixed family', async () => {
        const { app, service } = setup();
        const path = '/v1/workspace/google_gmail/authorize';
        expect((await request(app).post(path).set('If-Match', '"0"').set('Idempotency-Key', 'auth').send({})).status).toBe(400);
        expect(service.authorize).not.toHaveBeenCalled();
        expect((await request(app).post(path).set('If-Match', '"0"').set('Idempotency-Key', 'auth').set('X-ENS-OAuth-Session', 'a'.repeat(64)).send({})).status).toBe(200);
        expect((await request(app).post('/v1/workspace/oauth/google/callback').set('X-ENS-OAuth-Session', 'a'.repeat(64)).send({ state: 's'.repeat(43), code: 'code', service: 'microsoft_mail' })).status).toBe(400);
        expect(service.callback).not.toHaveBeenCalled();
    });
    it('requires explicit mail approval, internal draft IDs and feature switches', async () => {
        const { app, service } = setup();
        const path = '/v1/workspace/google_gmail/drafts/11111111-1111-4111-8111-111111111111/send';
        expect((await request(app).post(path).set('If-Match', '"3"').set('Idempotency-Key', 'send').send({ confirm: false })).status).toBe(400);
        expect(service.sendDraft).not.toHaveBeenCalled();
        expect((await request(setup(false).app).post(path).send({ confirm: true })).status).toBe(503);
    });
    it('rejects unknown browse fields and provider controlled URLs', async () => {
        const { app, service } = setup();
        expect((await request(app).get('/v1/workspace/google_drive/resources?url=https://evil.invalid')).status).toBe(400);
        expect(service.resources).not.toHaveBeenCalled();
        expect((await request(app).get('/v1/workspace/arbitrary/resources')).status).toBe(400);
    });
});
