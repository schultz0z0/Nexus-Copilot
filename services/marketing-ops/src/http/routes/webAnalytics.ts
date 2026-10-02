import type { Router, Request } from 'express';
import { z } from 'zod';
import type { WebAnalyticsService } from '../../domain/webAnalytics.js';
import { AnalyticsProviderSchema, AnalyticsPeriodSchema, AnalyticsResultsSchema, AnalyticsResourceSchema, ClarityConnectSchema, AnalyticsLinkSchema } from '../../domain/webAnalyticsContracts.js';
import { actorFrom, asyncRoute, parseIfMatch, requireFeature, requireIdempotencyKey } from '../middleware.js';
import { appError } from '../../errors.js';
const params = z.object({ id: z.string().uuid(), linkId: z.string().uuid().optional() });
const empty = z.object({}).strict();
export function registerWebAnalytics(router: Router, service: WebAnalyticsService, features: {
    read: boolean;
    write: boolean;
}): void {
    const analyticsVersion = (req: Request) => {
        if (req.header('If-Match') === '"0"')
            return 0;
        return parseIfMatch(req);
    };
    const context = (req: Request) => ({ pool: service.pool, actor: actorFrom(req), correlationId: req.correlationId, origin: 'rest' as const });
    const provider = (req: Request) => AnalyticsProviderSchema.parse(req.params.provider);
    const session = (req: Request) => {
        const value = req.header('x-ens-oauth-session');
        if (!value || !/^[a-f0-9]{64}$/.test(value))
            throw appError('oauth_session_required', 400, 'An internal session binding is required');
        return value;
    };
    router.get('/v1/web-analytics/connections', asyncRoute(async (req, res) => {
        requireFeature(features.read, 'read');
        res.json({ data: await service.list(context(req)) });
    }));
    router.post('/v1/web-analytics/ga4/authorize', asyncRoute(async (req, res) => {
        requireFeature(features.write, 'write');
        empty.parse(req.body);
        res.json({ data: await service.authorize(context(req), session(req)) });
    }));
    router.get('/v1/web-analytics/ga4/resources', asyncRoute(async (req, res) => {
        requireFeature(features.read, 'read');
        res.json({ data: await service.resources(context(req)) });
    }));
    router.post('/v1/web-analytics/ga4/resource', asyncRoute(async (req, res) => {
        requireFeature(features.write, 'write');
        const data = await service.selectResource(context(req), parseIfMatch(req), AnalyticsResourceSchema.parse(req.body));
        res.setHeader('ETag', `"${data.version}"`).json({ data });
    }));
    router.post('/v1/web-analytics/clarity/connect', asyncRoute(async (req, res) => {
        requireFeature(features.write, 'write');
        const data = await service.connectClarity(context(req), analyticsVersion(req), ClarityConnectSchema.parse(req.body), requireIdempotencyKey(req));
        res.setHeader('ETag', `"${data.version}"`).json({ data });
    }));
    router.post('/v1/web-analytics/:provider/disconnect', asyncRoute(async (req, res) => {
        requireFeature(features.write, 'write');
        empty.parse(req.body);
        const data = await service.disconnect(context(req), provider(req), parseIfMatch(req));
        res.setHeader('ETag', `"${data.version}"`).json({ data });
    }));
    router.post('/v1/web-analytics/:provider/sync', asyncRoute(async (req, res) => {
        requireFeature(features.write, 'write');
        res.json({ data: await service.sync(context(req), provider(req), AnalyticsPeriodSchema.parse(req.body), requireIdempotencyKey(req)) });
    }));
    router.get('/v1/web-analytics/:provider/results', asyncRoute(async (req, res) => {
        requireFeature(features.read, 'read');
        const input = AnalyticsResultsSchema.parse(req.query);
        const selectedProvider = provider(req);
        if (input.scope && selectedProvider !== 'ga4') throw appError('validation_error', 400, 'Organic scope requires GA4');
        res.json({ data: await service.results(context(req), selectedProvider, input) });
    }));
    router.get('/v1/campaigns/:id/web-analytics-links', asyncRoute(async (req, res) => {
        requireFeature(features.read, 'read');
        res.json({ data: await service.listLinks(context(req), params.parse(req.params).id) });
    }));
    router.post('/v1/campaigns/:id/web-analytics-links', asyncRoute(async (req, res) => {
        requireFeature(features.write, 'write');
        const data = await service.createLink(context(req), params.parse(req.params).id, AnalyticsLinkSchema.parse(req.body), requireIdempotencyKey(req));
        res.status(201).setHeader('ETag', `"${data.version}"`).json({ data });
    }));
    router.post('/v1/campaigns/:id/web-analytics-links/:linkId/disable', asyncRoute(async (req, res) => {
        requireFeature(features.write, 'write');
        empty.parse(req.body);
        const { id, linkId } = params.parse(req.params);
        const data = await service.disableLink(context(req), id, linkId!, parseIfMatch(req));
        res.setHeader('ETag', `"${data.version}"`).json({ data });
    }));
    router.get('/v1/campaigns/:id/web-analytics-results', asyncRoute(async (req, res) => {
        requireFeature(features.read, 'read');
        res.json({ data: await service.campaignResults(context(req), params.parse(req.params).id, AnalyticsPeriodSchema.parse(req.query)) });
    }));
}
