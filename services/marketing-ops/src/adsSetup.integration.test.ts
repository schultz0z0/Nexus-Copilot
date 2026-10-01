import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from './auth/actor.js';
import { createCampaignDraft } from './domain/campaigns.js';
import { createLeadSource } from './domain/leads.js';
import { AdsIntegrationService } from './domain/ads.js';
import { AdsSetupStore } from './integrations/ads/setupStore.js';
import * as storeModule from './integrations/ads/setupStore.js';
import type { AdsConfig, AdsProviderClient } from './integrations/ads/types.js';

const enabled = !!process.env.MARKETING_OPS_TEST_DATABASE_URL && !!process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL;
const pool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/disabled' });
const adminPool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/disabled' });
const admin: Actor = { userId: '33333333-3333-4333-8333-333333333333', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'admin' };
const manager: Actor = { ...admin, userId: '22222222-2222-4222-8222-222222222222', role: 'manager' };
const member: Actor = { ...admin, userId: '11111111-1111-4111-8111-111111111111', role: 'member' };
const other: Actor = { ...member, userId: '44444444-4444-4444-8444-444444444444', tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenantSlug: 'other' };
const context = (actor = admin) => ({ pool, actor, correlationId: randomUUID(), origin: 'rest' as const });
const directories: string[] = [];
function store() { const path = mkdtempSync(join(tmpdir(), 'ads-setup-domain-')); directories.push(path); return new AdsSetupStore(path); }
const google = { clientId: 'company-client', clientSecret: 'private-client-secret', apiVersion: 'v25', scopes: ['https://www.googleapis.com/auth/adwords'] };
const session = '1'.repeat(64);
const client: AdsProviderClient = {
  authorizationUrl: state => `https://example.invalid/oauth?state=${state}`, exchange: async () => ({ accessToken: 'private-provider-token', scopes: google.scopes }),
  refresh: async tokens => tokens, accounts: async () => [{ id: '123', name: 'Account', currency: 'BRL', timeZone: 'UTC' }], campaigns: async () => [], dailyMetrics: async () => [], leads: async () => []
};
function service(storage = store(), external: AdsConfig['providers'] = {}, replacementClient = client) {
  return new AdsIntegrationService(pool, { providers: external, publicOrigin: 'http://127.0.0.1:8088', encryptionKey: storage.key, syncIntervalMs: 900000 }, {}, { store: storage, createClient: () => replacementClient });
}
afterAll(async () => { await Promise.all([pool.end(), adminPool.end()]); for (const path of directories) rmSync(path, { recursive: true, force: true }); });
describe.runIf(enabled)('Ads administrative application setup', () => {
  beforeEach(async () => { await adminPool.query('delete from marketing_ops_private.ads_setup_receipts; delete from marketing_ops_private.ads_setup_publications; delete from marketing_ops_private.ads_setup_binding'); });
  it('exposes safe initial metadata only to a canonical admin', async () => {
    const svc = service();
    expect(await svc.setup(context(), 'google')).toMatchObject({ provider: 'google', mode: 'empty', version: 1, writable: true, ready: false, publicOrigin: 'http://127.0.0.1:8088', redirectUri: 'http://127.0.0.1:8088/api/ads/oauth/google/callback', hasClientSecret: false });
    for (const actor of [member, manager, { ...manager, role: 'admin' as const }]) {
      await expect(svc.setup(context(actor), 'google')).rejects.toMatchObject({ code: 'forbidden' });
      await expect(svc.saveSetup(context(actor), 'google', 1, google, randomUUID())).rejects.toMatchObject({ code: 'forbidden' });
    }
  });
  it('saves all providers privately, preserves an empty secret and applies configuration without restart', async () => {
    const storage = store(); const svc = service(storage);
    const result = await svc.saveSetup(context(), 'google', 1, google, randomUUID());
    expect(result).toMatchObject({ mode: 'managed', version: 2, ready: true, clientId: google.clientId, hasClientSecret: true });
    expect(JSON.stringify(result)).not.toContain('private-');
    const update = await svc.saveSetup(context(), 'google', 2, { ...google, clientSecret: '', confirmReplacement: true }, randomUUID());
    expect(update).toMatchObject({ version: 3, hasClientSecret: true });
    const fresh = service(new AdsSetupStore(storage.directory));
    expect(await fresh.setup(context(), 'google')).toEqual(update);
    expect((await fresh.authorize(context(manager), 'google', session)).authorizationUrl).toContain('example.invalid');
    expect(await svc.saveSetup(context(), 'meta', 1, { clientId: '12345', clientSecret: 'meta-private', apiVersion: 'v23.0', scopes: ['ads_read'], metaLoginConfigId: '45678' }, randomUUID())).toMatchObject({ ready: true, metaLoginConfigId: '45678' });
    expect(await svc.saveSetup(context(), 'linkedin', 1, { clientId: 'linkedin-client', clientSecret: 'linkedin-private', apiVersion: '202609', scopes: ['r_ads', 'r_ads_reporting'] }, randomUUID())).toMatchObject({ ready: true });
    await expect(svc.setup(context(other), 'google')).rejects.toMatchObject({ code: 'forbidden' });
    expect((await svc.list(context(other))).every(row => row.status === 'unprepared')).toBe(true);
  });
  it('requires a secret and explicit external takeover and refuses provider-incompatible input', async () => {
    const storage = store(); const external = { google: { ...google, redirectUri: 'http://127.0.0.1:8088/api/ads/oauth/google/callback' } }; const svc = service(storage, external);
    expect(await svc.setup(context(), 'google')).toMatchObject({ mode: 'external', writable: false, version: 1 });
    await expect(svc.saveSetup(context(), 'google', 1, google, randomUUID())).rejects.toMatchObject({ code: 'ads_setup_confirmation_required' });
    await expect(svc.saveSetup(context(), 'google', 1, { ...google, clientSecret: '', confirmReplacement: true, takeOverExternal: true }, randomUUID())).rejects.toMatchObject({ code: 'ads_setup_secret_required' });
    await expect(svc.saveSetup(context(), 'google', 1, { ...google, metaLoginConfigId: '123', confirmReplacement: true, takeOverExternal: true }, randomUUID())).rejects.toThrow();
    expect(await svc.saveSetup(context(), 'google', 1, { ...google, confirmReplacement: true, takeOverExternal: true }, randomUUID())).toMatchObject({ mode: 'managed' });
    expect(external.google.clientSecret).toBe(google.clientSecret);
  });
  it('derives authorization and exchange callbacks from the current server origin after restart', async () => {
    const storage = store(); await service(storage).saveSetup(context(), 'google', 1, google, randomUUID());
    const origin = 'https://newcompany.example'; const calls: string[] = [];
    const restarted = new AdsIntegrationService(pool, { providers: {}, publicOrigin: origin, encryptionKey: storage.key, syncIntervalMs: 900000 }, {}, {
      store: new AdsSetupStore(storage.directory), createClient: (_provider, settings) => ({ ...client,
        authorizationUrl: state => { calls.push(`authorization:${settings.redirectUri}`); return `https://example.invalid/oauth?state=${state}&redirect_uri=${encodeURIComponent(settings.redirectUri)}`; },
        exchange: async (code, verifier) => { calls.push(`exchange:${settings.redirectUri}`); return client.exchange(code, verifier); }
      })
    });
    const metadata = await restarted.setup(context(), 'google');
    expect(metadata).toMatchObject({ mode: 'managed', ready: true, publicOrigin: origin, redirectUri: `${origin}/api/ads/oauth/google/callback` });
    const authorization = await restarted.authorize(context(manager), 'google', session);
    const url = new URL(authorization.authorizationUrl);
    expect(url.searchParams.get('redirect_uri')).toBe(metadata.redirectUri);
    await restarted.callback(context(manager), 'google', session, { state: url.searchParams.get('state')!, code: 'code' });
    expect(calls).toEqual([`authorization:${metadata.redirectUri}`, `exchange:${metadata.redirectUri}`]);
  });
  it('preserves safe managed metadata but refuses OAuth when the current server has no trusted public origin', async () => {
    const storage = store(); await service(storage).saveSetup(context(), 'google', 1, google, randomUUID());
    let providerCalls = 0;
    const restarted = new AdsIntegrationService(pool, { providers: {}, encryptionKey: storage.key, syncIntervalMs: 900000 }, {}, {
      store: new AdsSetupStore(storage.directory), createClient: () => ({ ...client,
        authorizationUrl: state => { providerCalls++; return client.authorizationUrl(state, 'unused'); },
        exchange: async (code, verifier) => { providerCalls++; return client.exchange(code, verifier); }
      })
    });
    expect(await restarted.setup(context(), 'google')).toMatchObject({ mode: 'managed', ready: false, writable: false, publicOrigin: null, redirectUri: null, clientId: google.clientId, hasClientSecret: true });
    expect((await restarted.list(context(manager))).find(row => row.provider === 'google')?.status).toBe('unprepared');
    await expect(restarted.authorize(context(manager), 'google', session)).rejects.toMatchObject({ code: 'integration_unprepared' });
    expect(providerCalls).toBe(0);
  });
  it('rejects stale versions and incompatible replays while identical retries do not invalidate twice', async () => {
    const svc = service(); const key = randomUUID(); const saved = await svc.saveSetup(context(), 'google', 1, google, key);
    const before = (await adminPool.query('select generation from marketing_ops.ads_connections where tenant_id=$1 and provider=$2', [admin.tenantId, 'google'])).rows[0].generation;
    expect(await svc.saveSetup(context(), 'google', 1, google, key)).toEqual(saved);
    expect((await adminPool.query('select generation from marketing_ops.ads_connections where tenant_id=$1 and provider=$2', [admin.tenantId, 'google'])).rows[0].generation).toBe(before);
    await expect(svc.saveSetup(context(), 'google', 1, { ...google, clientId: 'different' }, key)).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await expect(svc.saveSetup(context(), 'google', 1, google, randomUUID())).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(svc.saveSetup(context(), 'google', 2, google, randomUUID())).rejects.toMatchObject({ code: 'ads_setup_confirmation_required' });
  });
  it('preserves the published settings and connection when private storage fails', async () => {
    const storage = store(); const svc = service(storage); const saved = await svc.saveSetup(context(), 'google', 1, google, randomUUID());
    const authorization = await svc.authorize(context(), 'google', session); const state = new URL(authorization.authorizationUrl).searchParams.get('state')!;
    rmSync(storage.directory, { recursive: true, force: true });
    await expect(svc.saveSetup(context(), 'google', 2, { ...google, clientId: 'replacement', confirmReplacement: true }, randomUUID())).rejects.toMatchObject({ code: 'ads_setup_storage_unavailable' });
    expect((await adminPool.query('select version from marketing_ops_private.ads_setup_publications where provider=$1', ['google'])).rows[0].version).toBe(String(saved.version));
    expect((await adminPool.query('select consumed_at from marketing_ops.ads_oauth_states where state_hash=encode(sha256($1::bytea),\'hex\')', [Buffer.from(state)])).rows[0].consumed_at).toBeNull();
  });
  it('invalidates outstanding callbacks and fences an exchange already in progress on replacement', async () => {
    let release!: () => void; let started!: () => void;
    const startedPromise = new Promise<void>(resolve => { started = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
    const svc = service(store(), {}, { ...client, exchange: async () => { started(); await wait; return { accessToken: 'old-token', scopes: google.scopes }; } });
    await svc.saveSetup(context(), 'google', 1, google, randomUUID());
    const auth = await svc.authorize(context(), 'google', session); const state = new URL(auth.authorizationUrl).searchParams.get('state')!;
    const callback = svc.callback(context(), 'google', session, { state, code: 'code' }); const assertion = expect(callback).rejects.toMatchObject({ code: 'connection_changed' });
    await startedPromise;
    await svc.saveSetup(context(), 'google', 2, { ...google, clientId: 'new-application', confirmReplacement: true }, randomUUID()); release(); await assertion;
    await expect(svc.callback(context(), 'google', session, { state, code: 'code' })).rejects.toMatchObject({ code: 'oauth_state_invalid' });
    const row = (await adminPool.query('select tokens_cipher, status from marketing_ops.ads_connections where tenant_id=$1 and provider=$2', [admin.tenantId, 'google'])).rows[0];
    expect(row).toMatchObject({ tokens_cipher: null, status: 'prepared' });
    const audit = (await adminPool.query("select after_state from marketing_ops.audit_events where action='ads.setup.saved' order by created_at desc limit 1")).rows;
    expect(JSON.stringify(audit)).not.toContain('private-client-secret');
  });
  it('checks all database references before provisioning a boot key and recovers the same key on restart', async () => {
    const storage = store(); const svc = service(storage);
    await svc.saveSetup(context(), 'google', 1, google, randomUUID());
    const fresh = store(); rmSync(join(fresh.directory, 'encryption-key'));
    const openStore = (storeModule as any).openAdsSetupStore;
    await expect(openStore(pool, fresh.directory)).rejects.toMatchObject({ code: 'ads_setup_storage_unavailable' });
    expect(readdirSync(fresh.directory)).not.toContain('encryption-key');
    expect((await openStore(pool, storage.directory)).key.equals(storage.key)).toBe(true);
    await adminPool.query('delete from marketing_ops_private.ads_setup_publications');
    await svc.authorize(context(), 'google', session).catch(() => undefined);
    // Token rows remain encrypted even when publication metadata is absent.
    await adminPool.query("update marketing_ops.ads_connections set tokens_cipher='encrypted-reference' where tenant_id=$1 and provider='google'", [admin.tenantId]);
    await expect(openStore(pool, fresh.directory)).rejects.toMatchObject({ code: 'ads_setup_storage_unavailable' });
  });
  it('leaves the authoritative publication intact on a database failure and prunes the orphan on retry', async () => {
    const storage = store(); const svc = service(storage); const saved = await svc.saveSetup(context(), 'google', 1, google, randomUUID());
    await adminPool.query(`create function marketing_ops_private.reject_ads_setup_fixture() returns trigger language plpgsql as $$ begin raise exception 'fixture publication failure'; end $$;
      create trigger reject_ads_setup_fixture before update on marketing_ops_private.ads_setup_publications for each row execute function marketing_ops_private.reject_ads_setup_fixture()`);
    try {
      await expect(svc.saveSetup(context(), 'google', 2, { ...google, clientId: 'replacement', confirmReplacement: true }, randomUUID())).rejects.toThrow('fixture publication failure');
      expect(await svc.setup(context(), 'google')).toEqual(saved);
      expect(readdirSync(storage.directory).filter(name => name.endsWith('.json'))).toHaveLength(2);
    } finally {
      await adminPool.query('drop trigger reject_ads_setup_fixture on marketing_ops_private.ads_setup_publications; drop function marketing_ops_private.reject_ads_setup_fixture()');
    }
    expect(await svc.saveSetup(context(), 'google', 2, { ...google, confirmReplacement: true }, randomUUID())).toMatchObject({ version: 3 });
    expect(readdirSync(storage.directory).filter(name => name.endsWith('.json'))).toHaveLength(2);
  });
  it('rejects an old campaign-list response after replacing the application', async () => {
    let release!: () => void; let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; }); const hold = new Promise<void>(resolve => { release = resolve; });
    const svc = service(store(), {}, { ...client, campaigns: async () => { started(); await hold; return [{ id: '456', name: 'Old application campaign', status: 'active' }]; } });
    await svc.saveSetup(context(), 'google', 1, google, randomUUID());
    const auth = await svc.authorize(context(), 'google', session);
    const pending = await svc.callback(context(), 'google', session, { state: new URL(auth.authorizationUrl).searchParams.get('state')!, code: 'code' });
    await svc.selectAccount(context(), 'google', pending.version, { accountId: '123' });
    const response = svc.externalCampaigns(context(manager), 'google'); const assertion = expect(response).rejects.toMatchObject({ code: 'connection_changed' });
    await reading;
    await svc.saveSetup(context(), 'google', 2, { ...google, clientId: 'new-client', confirmReplacement: true }, randomUUID());
    release(); await assertion;
  });
  it('cancels a synchronization reading the old application while preserving historical measurements', async () => {
    let release!: () => void; let started!: () => void; let delay = false;
    const reading = new Promise<void>(resolve => { started = resolve; }); const hold = new Promise<void>(resolve => { release = resolve; });
    const storage = store(); const used: string[] = [];
    const svc = new AdsIntegrationService(pool, { providers: {}, publicOrigin: 'http://127.0.0.1:8088', encryptionKey: storage.key, syncIntervalMs: 900000 }, {}, { store: storage, createClient: (_provider, settings) => ({ ...client,
      campaigns: async () => [{ id: '456', name: 'Campaign', status: 'active' }],
      dailyMetrics: async () => { used.push(settings.clientId); if (delay) { started(); await hold; } return [{ date: '2025-09-01', currency: 'BRL', timeZone: 'UTC', spend: delay ? 999 : 100, clicks: 12, impressions: 100, conversions: null }]; }
    }) });
    await adminPool.query('update marketing_ops.ads_links set enabled=false where tenant_id=$1', [admin.tenantId]);
    await svc.saveSetup(context(), 'google', 1, google, randomUUID());
    const auth = await svc.authorize(context(), 'google', session);
    const pending = await svc.callback(context(), 'google', session, { state: new URL(auth.authorizationUrl).searchParams.get('state')!, code: 'code' });
    await svc.selectAccount(context(), 'google', pending.version, { accountId: '123' });
    const draft = await createCampaignDraft(context(manager), { name: `Setup sync ${randomUUID()}`, objective: 'Generate leads', referenceType: 'initiative', referenceKey: 'setup-test', referenceTitleSnapshot: 'Setup test', idempotencyKey: randomUUID() });
    const source = await createLeadSource(context(manager), draft.id, { name: 'Ads setup fixture', channel: 'google_ads', kind: 'manual' }, randomUUID());
    const link = await svc.createLink(context(manager), draft.id, { provider: 'google', sourceId: source.id, externalCampaignId: '456', destination: 'landing_page' }, randomUUID());
    const period = { from: '2025-09-01', to: '2025-09-01' };
    await svc.sync(context(manager), draft.id, link.id, period, randomUUID()); delay = true;
    const synchronization = svc.sync(context(manager), draft.id, link.id, period, randomUUID()); const assertion = expect(synchronization).rejects.toMatchObject({ code: 'connection_changed' });
    await reading;
    await svc.saveSetup(context(), 'google', 2, { ...google, clientId: 'replacement-client', confirmReplacement: true }, randomUUID()); release(); await assertion;
    expect(used).toEqual([google.clientId, google.clientId]);
    expect((await svc.results(context(manager), draft.id, link.id)).daily[0]?.spend).toBe(100);
    const jobs = (await adminPool.query('select status from marketing_ops.ads_sync_jobs where link_id=$1 order by created_at', [link.id])).rows;
    expect(jobs.map(row => row.status)).toEqual(['completed', 'cancelled']);
    expect((await svc.listLinks(context(manager), draft.id))[0]?.safeError).toBeNull();
  });
  it('binds external configuration to the first canonical administrator and blocks a foreign canonical admin', async () => {
    const storage = store(); const svc = service(storage, { google: { ...google, redirectUri: 'http://127.0.0.1:8088/api/ads/oauth/google/callback' } });
    const first = await svc.setup(context(), 'google');
    await adminPool.query("update iam.memberships set role='admin' where principal_id=$1 and tenant_id=$2", [other.userId, other.tenantId]);
    const foreignAdmin: Actor = { ...other, role: 'admin' };
    try {
      await expect(svc.setup(context(foreignAdmin), 'google')).rejects.toMatchObject({ code: 'forbidden' });
      await expect(svc.saveSetup(context(foreignAdmin), 'google', 1, { ...google, confirmReplacement: true, takeOverExternal: true }, randomUUID())).rejects.toMatchObject({ code: 'forbidden' });
      expect((await svc.list(context(foreignAdmin))).every(row => row.status === 'unprepared')).toBe(true);
      expect(await svc.setup(context(), 'google')).toEqual(first);
    } finally { await adminPool.query("update iam.memberships set role='member' where principal_id=$1 and tenant_id=$2", [other.userId, other.tenantId]); }
  });
});
