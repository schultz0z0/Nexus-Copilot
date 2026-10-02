import type { Router, Request } from 'express';
import { z } from 'zod';
import type { WorkspaceIntegrationService } from '../../domain/workspace.js';
import { WorkspaceServiceSchema, WorkspaceFamilySchema, WorkspaceSetupSchema, WorkspaceAuthorizeSchema, WorkspaceSelectSchema, WorkspaceBrowseSchema, WorkspaceMailSchema, WorkspaceSendSchema, WorkspaceEventSchema, WorkspaceLinkSchema, WorkspacePeriodSchema } from '../../domain/workspaceContracts.js';
import { actorFrom, asyncRoute, parseIfMatch, requireFeature, requireIdempotencyKey } from '../middleware.js';
import { appError } from '../../errors.js';
const empty = z.object({}).strict();
const id = z.string().min(1).max(2048).refine(v => !/[\u0000-\u001f]/.test(v));
export function registerWorkspace(router: Router, service: WorkspaceIntegrationService, features: {
    read: boolean;
    write: boolean;
}) {
    const context = (req: Request) => ({ pool: service.pool, actor: actorFrom(req), correlationId: req.correlationId, origin: 'rest' as const });
    const version = (req: Request) => req.header('If-Match') === '"0"' ? 0 : parseIfMatch(req);
    const session = (req: Request) => {
        const v = req.header('x-ens-oauth-session');
        if (!v || !/^[a-f0-9]{64}$/.test(v))
            throw appError('oauth_session_required', 400, 'Internal session binding required');
        return v;
    };
    const s = (req: Request) => WorkspaceServiceSchema.parse(req.params.service);
    const read = (path: string, work: (req: Request) => Promise<unknown>) => router.get(path, asyncRoute(async (req, res) => {
        requireFeature(features.read, 'read');
        res.json({ data: await work(req) });
    }));
    const write = (path: string, work: (req: Request) => Promise<any>) => router.post(path, asyncRoute(async (req, res) => {
        requireFeature(features.write, 'write');
        const data = await work(req);
        if (data?.version !== undefined)
            res.setHeader('ETag', `"${data.version}"`);
        res.json({ data });
    }));
    read('/v1/workspace/apps', req => service.apps(context(req)));
    write('/v1/workspace/apps/:family', req => service.setupApp(context(req), WorkspaceFamilySchema.parse(req.params.family), version(req), WorkspaceSetupSchema.parse(req.body), requireIdempotencyKey(req)));
    read('/v1/workspace/connections', req => service.list(context(req)));
    write('/v1/workspace/oauth/:family/callback', req => service.callback(context(req), WorkspaceFamilySchema.parse(req.params.family), session(req), z.object({ state: z.string().min(20).max(200), code: z.string().min(1).max(4000).optional(), error: z.string().max(200).optional() }).strict().parse(req.body)));
    write('/v1/workspace/:service/authorize', req => service.authorize(context(req), s(req), version(req), WorkspaceAuthorizeSchema.parse(req.body), requireIdempotencyKey(req), session(req)));
    read('/v1/workspace/:service/resources', req => service.resources(context(req), s(req), WorkspaceBrowseSchema.parse(req.query)));
    write('/v1/workspace/:service/resource', req => service.selectResource(context(req), s(req), version(req), WorkspaceSelectSchema.parse(req.body), requireIdempotencyKey(req)));
    write('/v1/workspace/:service/disconnect', req => {
        empty.parse(req.body);
        return service.disconnect(context(req), s(req), version(req), requireIdempotencyKey(req));
    });
    read('/v1/workspace/:service/files', req => service.files(context(req), s(req), WorkspaceBrowseSchema.parse(req.query)));
    read('/v1/workspace/:service/messages', req => service.messages(context(req), s(req)));
    read('/v1/workspace/:service/messages/:messageId', req => service.message(context(req), s(req), id.parse(req.params.messageId)));
    write('/v1/workspace/:service/drafts', req => service.createDraft(context(req), s(req), version(req), WorkspaceMailSchema.parse(req.body), requireIdempotencyKey(req)));
    write('/v1/workspace/:service/drafts/:draftId/send', req => service.sendDraft(context(req), s(req), version(req), z.string().uuid().parse(req.params.draftId), WorkspaceSendSchema.parse(req.body), requireIdempotencyKey(req)));
    read('/v1/workspace/:service/events', req => service.events(context(req), s(req), WorkspacePeriodSchema.parse(req.query)));
    write('/v1/workspace/:service/events', req => service.publishEvent(context(req), s(req), version(req), WorkspaceEventSchema.parse(req.body), requireIdempotencyKey(req)));
    read('/v1/workspace/google_sheets/sheet', req => service.sheet(context(req)));
    read('/v1/workspace/google_search_console/report', req => service.report(context(req), WorkspacePeriodSchema.parse(req.query)));
    write('/v1/workspace/google_search_console/report', req => service.report(context(req), WorkspacePeriodSchema.parse(req.body), true, requireIdempotencyKey(req), version(req)));
    read('/v1/campaigns/:id/workspace-links', req => service.listLinks(context(req), z.string().uuid().parse(req.params.id)));
    write('/v1/campaigns/:id/workspace-links', req => service.createLink(context(req), z.string().uuid().parse(req.params.id), WorkspaceLinkSchema.parse(req.body), requireIdempotencyKey(req),version(req)));
    write('/v1/campaigns/:id/workspace-links/:linkId/disable', req => {
        empty.parse(req.body);
        return service.disableLink(context(req), z.string().uuid().parse(req.params.id), z.string().uuid().parse(req.params.linkId), version(req), requireIdempotencyKey(req));
    });
}
