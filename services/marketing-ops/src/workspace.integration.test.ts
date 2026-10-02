import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { WorkspaceIntegrationService } from './domain/workspace.js';
import type { WorkspaceProviderClient, WorkspaceService, WorkspaceTokens } from './integrations/workspace/types.js';
import type { Actor } from './auth/actor.js';
import { withActorTransaction } from './db/actorTransaction.js';
import { createCampaignDraft } from './domain/campaigns.js';
const enabled = !!process.env.MARKETING_OPS_TEST_DATABASE_URL && !!process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL;
const pool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/disabled' });
const adminPool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/disabled' });
const admin: Actor = { userId: '33333333-3333-4333-8333-333333333333', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'admin' };
const manager: Actor = { ...admin, userId: '22222222-2222-4222-8222-222222222222', role: 'manager' };
const member: Actor = { ...admin, userId: '11111111-1111-4111-8111-111111111111', role: 'member' };
const context = (actor = admin) => ({ pool, actor, origin: 'rest' as const, correlationId: randomUUID() });
const resource = { id: 'folder1', name: 'Marketing', kind: 'folder' as const, url: 'https://drive.google.com/drive/folders/folder1' };
const client: WorkspaceProviderClient = { authorizationUrl: state => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`, exchange: async () => ({ accessToken: 'private-access', refreshToken: 'private-refresh', scopes: ['email'] }), refresh: async (t) => t, identity: async () => ({ id: 'person1', email: 'person@example.com', name: 'Person' }), resources: async () => ({ items: [resource], nextPage: null, truncated: false }), resource: async (idTokens) => resource, createDraft: async (inputTokens) => ({ id: 'provider-draft', subject: 'Review', to: ['person@example.com'], text: 'Campaign' }), getDraft: async () => ({ id: 'provider-draft', subject: 'Review', to: ['person@example.com'], text: 'Campaign' }), sendDraft: async () => ({ id: 'provider-sent' }), publishEvent: async () => ({ id: 'provider-event', title: 'Launch', start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z', url: null }), searchReport: async (_t, _site, from, to) => ({ from, to, totals: { clicks: 5, impressions: 50, ctr: .1, position: 2 }, daily: [], queries: [], pages: [], truncated: false }) };
const directories: string[] = [];
function service(provider = client) {
    const dir = mkdtempSync(join(tmpdir(), 'prometeus-workspace-'));
    directories.push(dir);
    return new WorkspaceIntegrationService(pool, { key: Buffer.alloc(32, 7), setupDirectory: dir, publicOrigin: 'http://127.0.0.1:8088' }, serviceId => ({ ...provider, resource: async (...args) => ({ ...await provider.resource(...args), kind: serviceId.includes('gmail') || serviceId.includes('mail') ? 'mailbox' : serviceId.includes('calendar') ? 'calendar' : serviceId.includes('sheets') ? 'spreadsheet' : serviceId.includes('search_console') ? 'site' : 'folder' }) }));
}
const session = 'a'.repeat(64);
async function prepared(svc = service()) {
    await svc.setupApp(context(), 'google', 0, { clientId: 'client-id', clientSecret: 'private-client-secret' }, randomUUID());
    return svc;
}
async function connect(svc: WorkspaceIntegrationService, s: WorkspaceService = 'google_drive') {
    const old = (await svc.list(context())).find(c => c.service === s)!;
    const url = new URL((await svc.authorize(context(), s, old.version, {}, randomUUID(), session)).url);
    await svc.callback(context(), 'google', session, { state: url.searchParams.get('state')!, code: 'code' });
    const row = (await svc.list(context())).find(c => c.service === s)!;
    await svc.selectResource(context(), s, row.version, { resourceId: 'folder1' }, randomUUID());
    return (await svc.list(context())).find(c => c.service === s)!;
}
afterAll(async () => {
    await Promise.all([pool.end(), adminPool.end()]);
    for (const d of directories)
        rmSync(d, { recursive: true, force: true });
});
describe.runIf(enabled)('workspace durable integration contracts', () => {
    it('opens authorized spreadsheets from the library without replacing the saved selection and validates their kind', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'prometeus-workspace-'));
        directories.push(dir);
        const readSheet = vi.fn(async (_tokens: WorkspaceTokens, id: string) => ({ name: id, headers: [], rows: [], truncated: false }));
        const provider: WorkspaceProviderClient = { ...client, resource: async (_tokens, id: string) => ({ ...resource, id, kind: id === 'root' ? 'folder' : id === 'pdf' ? 'file' : 'spreadsheet' }), sheet: readSheet };
        const svc = await prepared(new WorkspaceIntegrationService(pool, { key: Buffer.alloc(32, 7), setupDirectory: dir, publicOrigin: 'http://127.0.0.1:8088' }, () => provider));
        const connected = await connect(svc, 'google_sheets');
        await svc.sheet(context(), { resourceId: 'sheet2' });
        expect(readSheet).toHaveBeenLastCalledWith(expect.any(Object), 'sheet2');
        expect((await svc.list(context())).find(row => row.service === 'google_sheets')?.selectedResource?.id).toBe('folder1');
        readSheet.mockClear();
        await expect(svc.sheet(context(), { resourceId: 'pdf' })).rejects.toMatchObject({ code: 'workspace_resource_unavailable' });
        expect(readSheet).not.toHaveBeenCalled();
        await svc.selectResource(context(), 'google_sheets', connected.version, { resourceId: 'root', confirmReplacement: true }, randomUUID());
        await expect(svc.sheet(context())).rejects.toMatchObject({ code: 'workspace_resource_required' });
        await svc.sheet(context(), { resourceId: 'sheet2' });
        await expect(svc.sheet(context(member), { resourceId: 'sheet2' })).rejects.toMatchObject({ code: 'forbidden' });
    });
    beforeEach(async () => {
        await adminPool.query('delete from marketing_ops.workspace_search_snapshots; delete from marketing_ops.workspace_links; delete from marketing_ops.workspace_drafts; delete from marketing_ops.workspace_receipts; delete from marketing_ops.workspace_oauth_states; delete from marketing_ops.workspace_connections; delete from marketing_ops_private.workspace_apps');
    });
    it('prepares native apps without returning secrets and rejects manager setup or forged canonical role', async () => {
        const svc = await prepared();
        expect(JSON.stringify(await svc.apps(context()))).not.toMatch(/private-client-secret|private-refresh|private-access/);
        await expect(svc.setupApp(context(manager), 'microsoft', 0, { clientId: 'client-id', clientSecret: 'secret', tenantId: 'company' }, randomUUID())).rejects.toMatchObject({ code: 'forbidden' });
        await expect(svc.list(context({ ...member, role: 'admin' }))).rejects.toMatchObject({ code: 'forbidden' });
    });
    it('requires version and confirmation to replace apps; replay does not invalidate again', async () => {
        const svc = await prepared();
        const row = await connect(svc);
        await expect(svc.setupApp(context(), 'google', 0, { clientId: 'other-client', clientSecret: 'other-secret', confirmReplacement: true }, randomUUID())).rejects.toMatchObject({ code: 'version_conflict' });
        await expect(svc.setupApp(context(), 'google', 1, { clientId: 'other-client', clientSecret: 'other-secret' }, randomUUID())).rejects.toMatchObject({ code: 'workspace_confirmation_required' });
        const key = randomUUID(), input = { clientId: 'other-client', clientSecret: 'other-secret', confirmReplacement: true };
        await svc.setupApp(context(), 'google', 1, input, key);
        const after = (await svc.list(context())).find(c => c.service === 'google_drive')!;
        expect(after.generation).toBe(row.generation + 1);
        await svc.setupApp(context(), 'google', 1, input, key);
        expect((await svc.list(context())).find(c => c.service === 'google_drive')!.generation).toBe(after.generation);
    });
    it('binds opaque one-use OAuth state to exact actor, session and family', async () => {
        const svc = await prepared();
        const url = new URL((await svc.authorize(context(), 'google_drive', 0, {}, randomUUID(), session)).url);
        const state = url.searchParams.get('state')!;
        await expect(svc.callback(context(), 'google', 'b'.repeat(64), { state, code: 'code' })).rejects.toMatchObject({ code: 'oauth_state_invalid' });
        await expect(svc.callback(context(manager), 'google', session, { state, code: 'code' })).rejects.toMatchObject({ code: 'oauth_state_invalid' });
        await svc.callback(context(), 'google', session, { state, code: 'code' });
        await expect(svc.callback(context(), 'google', session, { state, code: 'code' })).rejects.toMatchObject({ code: 'oauth_state_invalid' });
        expect((await svc.list(context()))[0]).toMatchObject({ status: 'pending_resource', selectedResource: null });
        expect(JSON.stringify(await svc.list(context()))).not.toMatch(/private-access|private-refresh/);
    });
    it('fences a late OAuth callback after app replacement', async () => {
        let finish!: (v: any) => void, started!: () => void;
        const began = new Promise<void>(r => started = r);
        const svc = await prepared(service({ ...client, identity: async () => {
                started();
                return new Promise(r => finish = r);
            } }));
        const url = new URL((await svc.authorize(context(), 'google_drive', 0, {}, randomUUID(), session)).url);
        const task = svc.callback(context(), 'google', session, { state: url.searchParams.get('state')!, code: 'code' }).catch(e => e);
        await began;
        await svc.setupApp(context(), 'google', 1, { clientId: 'new-client', clientSecret: 'new-secret', confirmReplacement: true }, randomUUID());
        finish({ id: 'person', email: 'person@example.com', name: 'Person' });
        expect(await task).toMatchObject({ code: 'workspace_connection_changed' });
        expect((await svc.list(context()))[0]).toMatchObject({ status: 'reconnect_required', identity: null });
    });
    it('serializes rotating refresh and rejects a late refresh after disconnect', async () => {
        let finish!: (v: any) => void, started!: () => void;
        const began = new Promise<void>(r => started = r);
        let block = false;
        const refresh = vi.fn(async (t) => {
            if (block) {
                started();
                return new Promise<any>(r => finish = r);
            }
            return { ...t, refreshToken: 'rotated-refresh' };
        });
        const svc = await prepared(service({ ...client, refresh }));
        const row = await connect(svc);
        block = true;
        const task = svc.resources(context(), 'google_drive', {}).catch(e => e);
        await began;
        await svc.disconnect(context(), 'google_drive', row.version, randomUUID());
        finish({ accessToken: 'late-access', refreshToken: 'stale-refresh', scopes: ['email'] });
        expect(await task).toMatchObject({ code: 'workspace_connection_changed' });
        expect((await svc.list(context()))[0]).toMatchObject({ status: 'disconnected' });
    });
    it('serializes simultaneous refresh so the second reader uses the latest refresh token', async () => {
        let finish!: (v: any) => void, started!: () => void;
        const began = new Promise<void>(r => started = r);
        let block = false;
        const refresh = vi.fn(async (t) => {
            if (block) {
                block = false;
                started();
                return new Promise<any>(r => finish = r);
            }
            return t;
        });
        const svc = await prepared(service({ ...client, refresh }));
        await connect(svc);
        block = true;
        const first = svc.resources(context(), 'google_drive', {});
        await began;
        const second = svc.resources(context(), 'google_drive', {});
        finish({ accessToken: 'new-access', refreshToken: 'new-refresh', scopes: ['email'] });
        await Promise.all([first, second]);
        expect(refresh.mock.calls.at(-1)![0]).toMatchObject({ refreshToken: 'new-refresh' });
    });
    it('does not exhaust the connection pool when many unchanged-token reads start together', async () => {
        const svc = await prepared();
        await connect(svc);
        const results = await Promise.all(Array.from({ length: 20 }, () => svc.resources(context(), 'google_drive', {})));
        expect(results.every(r => r.items[0]?.id === 'folder1')).toBe(true);
    });
    it('replays selected resource and links after version advances and disconnect', async () => {
        const svc = await prepared();
        const auth = new URL((await svc.authorize(context(), 'google_drive', 0, {}, randomUUID(), session)).url);
        await svc.callback(context(), 'google', session, { state: auth.searchParams.get('state')!, code: 'code' });
        const pending = (await svc.list(context()))[0]!;
        const key = randomUUID();
        const input = { resourceId: 'folder1' };
        const selected = await svc.selectResource(context(), 'google_drive', pending.version, input, key);
        expect(await svc.selectResource(context(), 'google_drive', pending.version, input, key)).toEqual(selected);
        const campaign = await createCampaignDraft(context(), { name: 'Replay', objective: 'Traffic', referenceType: 'initiative', referenceKey: 'replay', referenceTitleSnapshot: 'Replay', idempotencyKey: randomUUID() });
        const linkInput = { service: 'google_drive', kind: 'file', resourceId: 'folder1' }, linkKey = randomUUID();
        const link = await svc.createLink(context(), campaign.id, linkInput, linkKey);
        await svc.disconnect(context(), 'google_drive', selected.version, randomUUID());
        expect(await svc.createLink(context(), campaign.id, linkInput, linkKey)).toEqual(link);
    });
    it('requires a new secret for changed client ID and validates selected resource kind', async () => {
        const svc = await prepared();
        await expect(svc.setupApp(context(), 'google', 1, { clientId: 'new-client', confirmReplacement: true }, randomUUID())).rejects.toMatchObject({ code: 'workspace_secret_required' });
        // Reuse the prepared installation store so validation uses the current app.
        const invalid = new WorkspaceIntegrationService(pool, (svc as any).options, () => ({ ...client, resource: async () => ({ ...resource, kind: 'file' }) }));
        const auth = new URL((await invalid.authorize(context(), 'google_drive', 0, {}, randomUUID(), session)).url);
        await invalid.callback(context(), 'google', session, { state: auth.searchParams.get('state')!, code: 'code' });
        const row = (await invalid.list(context()))[0]!;
        await expect(invalid.selectResource(context(), 'google_drive', row.version, { resourceId: 'folder1' }, randomUUID())).rejects.toMatchObject({ code: 'workspace_resource_unavailable' });
    });
    it('makes an uncertain mail send durable and refuses retry with a different key', async () => {
        const send = vi.fn(async () => {
            throw new Error('private transport error with token');
        });
        const svc = await prepared(service({ ...client, sendDraft: send }));
        const row = await connect(svc, 'google_gmail');
        const draft: any = await svc.createDraft(context(), 'google_gmail', row.version, { to: ['person@example.com'], subject: 'Review', text: 'Campaign' }, randomUUID());
        const key = randomUUID(), input = { confirm: true };
        const result = await svc.sendDraft(context(), 'google_gmail', row.version, draft.id, input, key);
        expect(result).toMatchObject({ status: 'uncertain' });
        expect(await svc.sendDraft(context(), 'google_gmail', row.version, draft.id, input, key)).toEqual(result);
        await expect(svc.sendDraft(context(), 'google_gmail', row.version, draft.id, input, randomUUID())).rejects.toMatchObject({ code: 'workspace_send_already_reserved' });
        expect(send).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(result)).not.toContain('private transport');
    });
    it('does not send arbitrary provider draft IDs or another actor drafts', async () => {
        const send = vi.fn(client.sendDraft!);
        const svc = await prepared(service({ ...client, sendDraft: send }));
        const row = await connect(svc, 'google_gmail');
        await expect(svc.sendDraft(context(), 'google_gmail', row.version, randomUUID(), { confirm: true }, randomUUID())).rejects.toMatchObject({ code: 'workspace_draft_unavailable' });
        const draft: any = await svc.createDraft(context(), 'google_gmail', row.version, { to: ['person@example.com'], subject: 'Review', text: 'Campaign' }, randomUUID());
        await expect(svc.sendDraft(context(manager), 'google_gmail', row.version, draft.id, { confirm: true }, randomUUID())).rejects.toMatchObject({ code: 'workspace_draft_unavailable' });
        expect(send).not.toHaveBeenCalled();
    });
    it('blocks a changed provider draft before any send request and conserves durable receipt', async () => {
        const send = vi.fn(client.sendDraft!);
        const svc = await prepared(service({ ...client, sendDraft: send, getDraft: async () => ({ id: 'provider-draft', subject: 'Changed', to: ['other@example.com'], text: 'Campaign' }) }));
        const row = await connect(svc, 'google_gmail');
        const draft: any = await svc.createDraft(context(), 'google_gmail', row.version, { to: ['person@example.com'], subject: 'Review', text: 'Campaign' }, randomUUID());
        const key = randomUUID();
        const out = await svc.sendDraft(context(), 'google_gmail', row.version, draft.id, { confirm: true }, key);
        expect(out).toMatchObject({ status: 'blocked', safeError: 'workspace_draft_changed' });
        expect(send).not.toHaveBeenCalled();
        expect(await svc.sendDraft(context(), 'google_gmail', row.version, draft.id, { confirm: true }, key)).toEqual(out);
        await expect(svc.sendDraft(context(), 'google_gmail', row.version, draft.id, { confirm: true }, randomUUID())).rejects.toMatchObject({ code: 'workspace_send_already_reserved' });
    });
    it('reserves calendar publish once and binds campaign actions to the same tenant', async () => {
        const publish = vi.fn(client.publishEvent!);
        const svc = await prepared(service({ ...client, publishEvent: publish }));
        const row = await connect(svc, 'google_calendar');
        const input = { title: 'Launch', description: 'Campaign', start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z', timeZone: 'UTC', confirm: true };
        const key = randomUUID();
        const out = await svc.publishEvent(context(), 'google_calendar', row.version, input, key);
        expect(await svc.publishEvent(context(), 'google_calendar', row.version, input, key)).toEqual(out);
        expect(publish).toHaveBeenCalledTimes(1);
        await expect(svc.publishEvent(context(), 'google_calendar', row.version, { ...input, campaignId: randomUUID() }, randomUUID())).rejects.toMatchObject({ code: 'not_found' });
    });
    it('preserves Search Console snapshot after read failure and never converts it into campaign revenue', async () => {
        let broken = false;
        const svc = await prepared(service({ ...client, searchReport: async (...args) => {
                if (broken)
                    throw new Error('network');
                return client.searchReport!(...args);
            } }));
        const row = await connect(svc, 'google_search_console');
        const p = { from: '2026-09-01', to: '2026-09-02' };
        await svc.report(context(), p, true, randomUUID(), row.version);
        broken = true;
        await expect(svc.report(context(), p, true, randomUUID(), row.version)).rejects.toMatchObject({ code: 'workspace_provider_unavailable' });
        expect(await svc.report(context(), p)).toMatchObject({ totals: { clicks: 5, impressions: 50 } });
    });
    it('keeps disabled links as history and rejects inaccessible campaign IDs', async () => {
        const svc = await prepared();
        await connect(svc);
        const campaign = await createCampaignDraft(context(), { name: 'Workspace', objective: 'Traffic', referenceType: 'initiative', referenceKey: 'workspace', referenceTitleSnapshot: 'Workspace', idempotencyKey: randomUUID() });
        const link = await svc.createLink(context(), campaign.id, { service: 'google_drive', kind: 'file', resourceId: 'folder1' }, randomUUID());
        await svc.disableLink(context(), campaign.id, link.id, Number(link.version), randomUUID());
        expect(await svc.listLinks(context(), campaign.id)).toMatchObject([{ active: false }]);
        await expect(svc.createLink(context(), randomUUID(), { service: 'google_drive', kind: 'file', resourceId: 'folder1' }, randomUUID())).rejects.toMatchObject({ code: 'not_found' });
    });
    it('preserves conversation history but denies a linked read after account/resource generation changes', async () => {
        const read = vi.fn(async () => ({ id: 'message1', subject: 'Briefing', from: 'person@example.com', receivedAt: '2026-10-01T00:00:00Z', snippet: 'Summary', text: 'Content' }));
        const svc = await prepared(service({ ...client, message: read }));
        await connect(svc, 'google_gmail');
        const campaign = await createCampaignDraft(context(), { name: 'Mail history', objective: 'Traffic', referenceType: 'initiative', referenceKey: 'mail-history', referenceTitleSnapshot: 'Mail history', idempotencyKey: randomUUID() });
        const link = await svc.createLink(context(), campaign.id, { service: 'google_gmail', kind: 'message', resourceId: 'message1' }, randomUUID());
        expect(await svc.linkedMessage(context(), campaign.id, link.id)).toMatchObject({ id: 'message1' });
        const before = (await svc.list(context())).find(c => c.service === 'google_gmail')!;
        await svc.selectResource(context(), 'google_gmail', before.version, { resourceId: 'folder1' }, randomUUID());
        expect(await svc.listLinks(context(), campaign.id)).toMatchObject([{ active: true, available: false }]);
        const calls = read.mock.calls.length;
        await expect(svc.linkedMessage(context(), campaign.id, link.id)).rejects.toMatchObject({ code: 'workspace_connection_changed' });
        expect(read.mock.calls.length).toBe(calls);
    });
    it('forces RLS and cannot read workspace rows without an actor', async () => {
        const svc = await prepared();
        await connect(svc);
        expect((await pool.query('select * from marketing_ops.workspace_connections')).rows).toEqual([]);
        await withActorTransaction(pool, member, randomUUID(), async (db) => expect((await db.query('select * from marketing_ops.workspace_connections')).rows).toEqual([]));
        const policies = await adminPool.query("select relforcerowsecurity from pg_class where relname like 'workspace_%' and relkind='r'");
        expect(policies.rows.length).toBeGreaterThanOrEqual(7);
        expect(policies.rows.every(r => r.relforcerowsecurity)).toBe(true);
    });
});
