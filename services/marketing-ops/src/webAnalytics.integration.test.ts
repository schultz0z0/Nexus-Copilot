import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { WebAnalyticsService } from './domain/webAnalytics.js';
import { AdsIntegrationService } from './domain/ads.js';
import { withActorTransaction } from './db/actorTransaction.js';
import { createCampaignDraft } from './domain/campaigns.js';
import { AdsSetupStore } from './integrations/ads/setupStore.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Actor } from './auth/actor.js';
import type { Ga4ProviderClient, ClarityProviderClient, AnalyticsBatch } from './integrations/analytics/types.js';
const enabled = !!process.env.MARKETING_OPS_TEST_DATABASE_URL && !!process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL;
const pool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/disabled' });
const adminPool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/disabled' });
const admin: Actor = { userId: '33333333-3333-4333-8333-333333333333', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'admin' };
const manager: Actor = { ...admin, userId: '22222222-2222-4222-8222-222222222222', role: 'manager' };
const member: Actor = { ...admin, userId: '11111111-1111-4111-8111-111111111111', role: 'member' };
const context = (actor = admin) => ({ pool, actor, origin: 'rest' as const, correlationId: randomUUID() });
const resource = { id: '123', name: 'Site', timeZone: 'UTC', currency: 'BRL' };
const totals = { sessions: 10, engagedSessions: 6, pageViews: 20, keyEvents: 2, rageClicks: null, deadClicks: null, scrollDepth: null };
const batch: AnalyticsBatch = { totals, daily: [{ date: '2026-09-01', sessions: 10, engagedSessions: 6, pageViews: 20, keyEvents: 2 }], channels: [{ date: '2026-09-01', source: 'google', medium: 'cpc', sessions: 10 }], campaigns: [{ date: '2026-09-01', utmCampaign: 'launch', ...totals }], campaignChannels: [{ date: '2026-09-01', utmCampaign: 'launch', source: 'google', medium: 'cpc', sessions: 10 }], warnings: [], window: null };
const ga4: Ga4ProviderClient = { authorizationUrl: state => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`, exchange: async () => ({ accessToken: 'private-token', refreshToken: 'private-refresh', scopes: ['https://www.googleapis.com/auth/analytics.readonly'] }), refresh: async (t) => t, resources: async () => [resource], report: async () => batch };
const clarity: ClarityProviderClient = { report: async (_token, reserve) => {
        await reserve?.(1);
        await reserve?.(1);
        return { ...batch, daily: [], window: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' } };
    } };
const ads = () => new AdsIntegrationService(pool, { encryptionKey: Buffer.alloc(32, 9), providers: { google: { clientId: 'example', clientSecret: 'private-secret', redirectUri: 'http://127.0.0.1:8088/api/ads/oauth/google/callback', apiVersion: 'v25', scopes: [] } }, syncIntervalMs: 900000 }, { google: {} as any });
const service = (client = ga4) => new WebAnalyticsService(pool, ads(), { ga4: () => client, clarity });
const session = '1'.repeat(64);
async function connect(svc = service()) {
    const url = new URL((await svc.authorize(context(), session)).authorizationUrl);
    await svc.callback(context(), session, { state: url.searchParams.get('state')!, code: 'code' });
    const connection = (await svc.list(context())).find(v => v.provider === 'ga4')!;
    await svc.selectResource(context(), connection.version, { resourceId: '123' });
    return svc;
}
afterAll(() => Promise.all([pool.end(), adminPool.end()]));
describe.runIf(enabled)('native web analytics isolation', () => {
    it('reports freshness from requested-period measurements rather than another recently synchronized period',async()=>{
        const svc=await connect();
        await svc.sync(context(),'ga4',{from:'2026-09-01',to:'2026-09-01'},randomUUID());
        const old='2026-09-02T00:00:00.000Z';
        await adminPool.query("update marketing_ops.web_analytics_snapshots set observed_at=$1 where provider='ga4'",[old]);
        const later=service({...ga4,report:async()=>({...batch,daily:batch.daily.map(d=>({...d,date:'2026-09-15'})),campaigns:batch.campaigns.map(c=>({...c,date:'2026-09-15'}))})});
        await later.sync(context(),'ga4',{from:'2026-09-15',to:'2026-09-15'},randomUUID());
        const september=await svc.results(context(),'ga4',{from:'2026-09-01',to:'2026-09-01'});
        expect(september.lastSyncAt).toBe(old);expect(september.stale).toBe(true);
        const fresh=await svc.results(context(),'ga4',{from:'2026-09-15',to:'2026-09-15'});
        expect(fresh.stale).toBe(false);
    });
    it('does not let a lease-lost attempt overwrite a newer successful synchronization with its late failure',async()=>{
        let fail!:(error:Error)=>void;let started!:()=>void;const began=new Promise<void>(r=>started=r);
        const stale=await connect(service({...ga4,report:async()=>{started();return new Promise((_resolve,reject)=>fail=reject);}}));
        const key=randomUUID();const pending=stale.sync(context(),'ga4',{from:'2026-09-01',to:'2026-09-01'},key);const outcome=pending.catch(e=>e);
        await began;
        await adminPool.query("update marketing_ops.web_analytics_jobs set lease_until=now()-interval '1 second' where status='running'");
        const healthy=service();const receipt=await healthy.sync(context(),'ga4',{from:'2026-09-01',to:'2026-09-01'},key);
        fail(new Error('private-token'));
        expect(await outcome).toMatchObject({code:'analytics_provider_unavailable'});
        const connection=(await healthy.list(context())).find(c=>c.provider==='ga4')!;
        expect(connection).toMatchObject({status:'connected',safeError:null});
        expect(await healthy.sync(context(),'ga4',{from:'2026-09-01',to:'2026-09-01'},key)).toEqual(receipt);
        expect((await healthy.results(context(),'ga4',{from:'2026-09-01',to:'2026-09-01'})).stale).toBe(false);
    });
    it('refuses campaign attribution when a selected property changes between link discovery and report reading', async () => {
        const svc = await connect(service({ ...ga4, resources: async () => [resource, { ...resource, id: '456', name: 'Other site' }] }));
        const campaign = await createCampaignDraft(context(), { name: 'Property race', objective: 'Traffic', referenceType: 'initiative', referenceKey: 'race', referenceTitleSnapshot: 'Property race', idempotencyKey: randomUUID() });
        await svc.createLink(context(), campaign.id, { provider: 'ga4', utmCampaign: 'launch' }, randomUUID());
        const original = svc.results.bind(svc);
        vi.spyOn(svc, 'results').mockImplementationOnce(async (...args) => {
            const c = (await svc.list(context())).find(c => c.provider === 'ga4')!;
            await svc.selectResource(context(), c.version, { resourceId: '456', confirmReplacement: true });
            return original(...args);
        });
        await expect(svc.campaignResults(context(), campaign.id, { from: '2026-09-01', to: '2026-09-01' })).rejects.toMatchObject({ code: 'analytics_connection_changed' });
    });
    it('publishes an initially truncated Clarity export as partial', async () => {
        const svc = new WebAnalyticsService(pool, ads(), { ga4: () => ga4, clarity: { report: async () => ({ ...batch, daily: [], window: { from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' }, warnings: ['analytics_clarity_row_limit'] }) } });
        expect(await svc.connectClarity(context(), 0, { token: 'a'.repeat(30), projectId: 'abc123', projectName: 'Site' }, randomUUID())).toMatchObject({ status: 'partial' });
    });
    it('does not apply a property-timezone reporting day to the rolling UTC Clarity export', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-30T13:00:00Z'));
        try {
            const svc = await connect(service({ ...ga4, resources: async () => [{ ...resource, timeZone: 'Pacific/Auckland' }] }));
            await svc.connectClarity(context(), 0, { token: 'a'.repeat(30), projectId: 'abc123', projectName: 'Site' }, randomUUID());
            const campaign = await createCampaignDraft(context(), { name: 'Timezone test', objective: 'Traffic', referenceType: 'initiative', referenceKey: 'tz', referenceTitleSnapshot: 'Timezone', idempotencyKey: randomUUID() });
            for (const provider of ['ga4', 'clarity'])
                await svc.createLink(context(), campaign.id, { provider, utmCampaign: 'launch' }, randomUUID());
            const result = await svc.campaignResults(context(), campaign.id, { from: '2026-09-30', to: '2026-09-30' });
            expect(result.clarity?.window).not.toBeNull();
            expect(result.ga4?.from).toBe('2026-09-30');
        }
        finally {
            vi.useRealTimers();
        }
    });
    it('invalidates GA4 pending authorization and late jobs when the company Google application changes', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'analytics-google-config-'));
        try {
            const store = new AdsSetupStore(directory);
            const google = { clientId: 'example', clientSecret: 'private-secret', apiVersion: 'v25', scopes: ['https://www.googleapis.com/auth/adwords'] };
            const prepared = new AdsIntegrationService(pool, { providers: {}, publicOrigin: 'http://127.0.0.1:8088', encryptionKey: store.key, syncIntervalMs: 900000 }, {}, { store, createClient: () => ({} as any) });
            await prepared.saveSetup(context(), 'google', 1, google, randomUUID());
            let finish!: (v: AnalyticsBatch) => void;
            let started!: () => void;
            const began = new Promise<void>(r => started = r);
            const svc = await connect(new WebAnalyticsService(pool, prepared, { ga4: () => ({ ...ga4, report: async () => {
                        started();
                        return new Promise(r => finish = r);
                    } }), clarity }));
            const pending = svc.sync(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' }, randomUUID());
            await began;
            await prepared.saveSetup(context(), 'google', 2, { ...google, confirmReplacement: true }, randomUUID());
            finish(batch);
            await expect(pending).rejects.toMatchObject({ code: 'analytics_connection_changed' });
            expect((await svc.list(context())).find(c => c.provider === 'ga4')).toMatchObject({ status: 'prepared', selectedResourceId: null });
            expect((await adminPool.query('select count(*) from marketing_ops.web_analytics_snapshots')).rows[0].count).toBe('0');
            const auth = new URL((await svc.authorize(context(), session)).authorizationUrl);
            const state = auth.searchParams.get('state')!;
            await prepared.saveSetup(context(), 'google', 3, { ...google, confirmReplacement: true }, randomUUID());
            await expect(svc.callback(context(), session, { state, code: 'code' })).rejects.toMatchObject({ code: 'oauth_state_invalid' });
        }
        finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
    it('does not sum overlapping Clarity windows and retains no plaintext token in persisted receipts', async () => {
        const svc = service();
        const c = await svc.connectClarity(context(), 0, { token: 'a'.repeat(30), projectId: 'abc123', projectName: 'Site' }, randomUUID());
        await svc.sync(context(), 'clarity', {}, randomUUID());
        const results = await svc.results(context(), 'clarity', { from: '2026-09-01', to: '2026-09-02' });
        expect(results.totals?.sessions).toBe(10);
        expect(results.daily).toEqual([]);
        expect(results.window).not.toBeNull();
        const raw = (await adminPool.query('select tokens_cipher from marketing_ops.web_analytics_connections where provider=\'clarity\'')).rows[0].tokens_cipher;
        expect(raw).not.toContain('a'.repeat(30));
        await svc.disconnect(context(), 'clarity', c.version);
        expect((await adminPool.query('select count(*) from marketing_ops.web_analytics_snapshots')).rows[0].count).toBe('2');
    });
    it('preserves earlier complete daily values when a thresholded revision has no measurable rows', async () => {
        const svc = await connect();
        await svc.sync(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' }, randomUUID());
        const partial = service({ ...ga4, report: async () => ({ ...batch, daily: [], channels: [], campaigns: [], campaignChannels: [], totals: { ...totals, sessions: 0, engagedSessions: 0, pageViews: 0, keyEvents: 0 }, warnings: ['analytics_thresholded'] }) });
        await partial.sync(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' }, randomUUID());
        const results = await svc.results(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' });
        expect(results.totals?.sessions).toBe(10);
        expect(results.warnings).toContain('analytics_thresholded');
    });
    it('aggregates all explicit UTM segments of a campaign and prevents ambiguous attribution', async () => {
        const campaign = await createCampaignDraft(context(), { name: 'Analytics test', objective: 'Traffic', referenceType: 'initiative', referenceKey: 'analytics-test', referenceTitleSnapshot: 'Analytics test', idempotencyKey: randomUUID() });
        const extra = { ...batch.campaigns[0]!, utmCampaign: 'retarget', sessions: 3, engagedSessions: 1, pageViews: 5, keyEvents: 0 };
        const svc = await connect(service({ ...ga4, report: async () => ({ ...batch, campaigns: [...batch.campaigns, extra], campaignChannels: [...batch.campaignChannels, { date: '2026-09-01', utmCampaign: 'retarget', source: 'meta', medium: 'cpc', sessions: 3 }] }) }));
        await svc.createLink(context(), campaign.id, { provider: 'ga4', utmCampaign: 'launch' }, randomUUID());
        await svc.createLink(context(), campaign.id, { provider: 'ga4', utmCampaign: 'retarget' }, randomUUID());
        await expect(svc.createLink(context(), campaign.id, { provider: 'ga4', utmCampaign: 'launch' }, randomUUID())).rejects.toMatchObject({ code: 'analytics_segment_already_linked' });
        await svc.sync(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' }, randomUUID());
        const results = await svc.campaignResults(context(), campaign.id, { from: '2026-09-01', to: '2026-09-01' });
        expect(results.ga4?.totals?.sessions).toBe(13);
        expect(results.ga4?.channels).toHaveLength(2);
    });
    beforeEach(async () => {
        await adminPool.query('delete from marketing_ops.web_analytics_jobs;delete from marketing_ops.web_analytics_snapshots;delete from marketing_ops.web_analytics_links;delete from marketing_ops.web_analytics_oauth_states;delete from marketing_ops.web_analytics_connections;delete from marketing_ops.web_analytics_quota;delete from marketing_ops.web_analytics_receipts;delete from marketing_ops_private.ads_setup_publications;delete from marketing_ops_private.ads_setup_binding;');
    });
    it('authorizes GA4 independently from Ads account and consumes session-bound state exactly once', async () => {
        const svc = service();
        const url = new URL((await svc.authorize(context(), session)).authorizationUrl);
        const state = url.searchParams.get('state')!;
        expect(await svc.ownsState(context(), session, state)).toBe(true);
        expect(await svc.ownsState(context(), '2'.repeat(64), state)).toBe(false);
        await expect(svc.callback(context(), '2'.repeat(64), { state, code: 'code' })).rejects.toMatchObject({ code: 'oauth_state_invalid' });
        expect(await svc.callback(context(), session, { state, code: 'code' })).toEqual({ provider: 'ga4' });
        await expect(svc.callback(context(), session, { state, code: 'code' })).rejects.toMatchObject({ code: 'oauth_state_invalid' });
        const connection = (await svc.list(context())).find(v => v.provider === 'ga4')!;
        expect(connection.status).toBe('pending_resource');
        expect(JSON.stringify(connection)).not.toContain('private-');
    });
    it('requires canonical manager writes and admin Clarity configuration', async () => {
        await expect(service().authorize(context(member), session)).rejects.toMatchObject({ code: 'forbidden' });
        await expect(service().connectClarity(context(manager), 0, { token: 'a'.repeat(30), projectId: 'abc123', projectName: 'Site' }, randomUUID())).rejects.toMatchObject({ code: 'forbidden' });
        await expect(service().authorize(context({ ...manager, role: 'admin' }), session)).rejects.toMatchObject({ code: 'forbidden' });
    });
    it('persists complete snapshots, exact retries and preserves results after provider failure', async () => {
        const svc = await connect();
        const key = randomUUID();
        const receipt = await svc.sync(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' }, key);
        expect(await svc.sync(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' }, key)).toEqual(receipt);
        expect((await svc.results(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' })).totals).toEqual(totals);
        const failing = service({ ...ga4, report: async () => {
                throw new Error('private-token');
            } });
        await expect(failing.sync(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' }, randomUUID())).rejects.toMatchObject({ code: 'analytics_provider_unavailable' });
        expect((await svc.results(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' })).totals?.sessions).toBe(10);
    });
    it('cancels late synchronization after disconnect and preserves history', async () => {
        let finish!: (value: AnalyticsBatch) => void;
        let started!: () => void;
        const began = new Promise<void>(r => started = r);
        const svc = await connect(service({ ...ga4, report: async () => {
                started();
                return new Promise(r => finish = r);
            } }));
        const work = svc.sync(context(), 'ga4', { from: '2026-09-01', to: '2026-09-01' }, randomUUID());
        await began;
        const connection = (await svc.list(context())).find(v => v.provider === 'ga4')!;
        await svc.disconnect(context(), 'ga4', connection.version);
        finish(batch);
        await expect(work).rejects.toMatchObject({ code: 'analytics_connection_changed' });
        expect((await adminPool.query('select count(*) from marketing_ops.web_analytics_snapshots')).rows[0].count).toBe('0');
    });
    it('durably enforces Clarity quota across syncs and token replacements', async () => {
        const svc = service();
        const input = { token: 'a'.repeat(30), projectId: 'abc123', projectName: 'Site' };
        const key = randomUUID();
        const c = await svc.connectClarity(context(), 0, input, key);
        expect(await svc.connectClarity(context(), 0, input, key)).toEqual(c);
        for (let i = 0; i < 4; i++)
            await svc.sync(context(), 'clarity', {}, randomUUID());
        await expect(svc.sync(context(), 'clarity', {}, randomUUID())).rejects.toMatchObject({ code: 'analytics_rate_limited' });
        const current = (await svc.list(context())).find(v => v.provider === 'clarity')!;
        await expect(svc.connectClarity(context(), current.version, { ...input, token: 'b'.repeat(30), confirmReplacement: true }, randomUUID())).rejects.toMatchObject({ code: 'analytics_rate_limited' });
        expect((await adminPool.query('select used from marketing_ops.web_analytics_quota')).rows[0].used).toBe(10);
    });
    it('RLS hides company-wide analytics from members and other tenants', async () => {
        await connect();
        const rows = await withActorTransaction(pool, member, randomUUID(), db => db.query('select * from marketing_ops.web_analytics_connections'));
        expect(rows.rows).toEqual([]);
        expect((await adminPool.query('select marketing_ops_private.ads_has_encrypted_references() as protected')).rows[0].protected).toBe(true);
    });
});
