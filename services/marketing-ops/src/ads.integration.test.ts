import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from './auth/actor.js';
import { createCampaignDraft,transitionCampaign } from './domain/campaigns.js';
import { confirmLeadImport, createLeadSource, createResultReport, listResultReports, listReportRevisions, listCampaignLeads, updateResultReport,updateLeadSource } from './domain/leads.js';
import { getLeadResults } from './domain/leadsResults.js';
import { AdsIntegrationService } from './domain/ads.js';
import type { AdsConfig, AdsProvider, AdsProviderClient } from './integrations/ads/types.js';
import { withActorTransaction } from './db/actorTransaction.js';

const enabled = !!process.env.MARKETING_OPS_TEST_DATABASE_URL && !!process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL;
const pool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/disabled' });
const adminPool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_ADMIN_DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/disabled' });
const manager: Actor = { userId: '22222222-2222-4222-8222-222222222222', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantSlug: 'ens', role: 'manager' };
const member: Actor = { ...manager, userId: '11111111-1111-4111-8111-111111111111', role: 'member' };
const other: Actor = { ...member, userId: '44444444-4444-4444-8444-444444444444', tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenantSlug: 'other' };
const context = (actor = manager) => ({ pool, actor, correlationId: randomUUID(), origin: 'rest' as const });
const config: AdsConfig = { encryptionKey: Buffer.alloc(32, 5), providers: { google: { clientId: 'test', clientSecret: 'secret', redirectUri: 'https://example.invalid/api/ads/oauth/google/callback', apiVersion: 'v25', scopes: ['https://www.googleapis.com/auth/adwords'] } }, syncIntervalMs: 900000 };
const session = '1'.repeat(64);
const account = { id: '123', name: 'Test account', currency: 'BRL', timeZone: 'America/Sao_Paulo' };
const provider: AdsProviderClient = {
  authorizationUrl: state => `https://example.invalid/oauth?state=${state}`,
  exchange: async () => ({ accessToken: 'never-expose-this', refreshToken: 'never-expose-refresh', scopes: ['https://www.googleapis.com/auth/adwords'] }),
  refresh: async tokens => tokens, accounts: async () => [account], campaigns: async () => [{ id: '456', name: 'Test campaign', status: 'active' }],
  dailyMetrics: async () => [{ date: '2025-09-01', currency: 'BRL', timeZone: 'America/Sao_Paulo', spend: 100, clicks: 12, impressions: 1000, conversions: 4 }],
  leads: async () => []
};
const service = (client = provider, settings = config) => new AdsIntegrationService(pool, settings, { google: client });
async function connected(svc = service(),providerId:AdsProvider='google') {
  // One installation has one selected account. Isolate fixtures while keeping
  // historical links/results available for the reconnect tests themselves.
  await adminPool.query('update marketing_ops.ads_links set enabled=false where tenant_id=$1',[manager.tenantId]);
  const auth = await svc.authorize(context(), providerId, session);
  const state = new URL(auth.authorizationUrl).searchParams.get('state')!;
  const pending = await svc.callback(context(), providerId, session, { state, code: 'code' });
  await svc.selectAccount(context(), providerId, pending.version, { accountId: account.id });
  return svc;
}
async function linked(svc = service(), destination: 'native_form'|'landing_page'|'whatsapp' = 'landing_page',providerId:AdsProvider='google') {
  await connected(svc,providerId);
  const campaign = await createCampaignDraft(context(), { name: `Ads test ${randomUUID()}`, objective: 'Generate leads', referenceType: 'initiative', referenceKey: 'ads-test', referenceTitleSnapshot: 'Ads test', startsOn:'2025-01-01',endsOn:'2027-12-31',idempotencyKey: randomUUID() });
  const source = await createLeadSource(context(), campaign.id, { name: 'Ads source', channel: `${providerId}_ads`, kind: 'manual' }, randomUUID());
  const link = await svc.createLink(context(), campaign.id, { provider: providerId, sourceId: source.id, externalCampaignId: '456', destination }, randomUUID());
  return { svc, campaign, source, link };
}
afterAll(() => Promise.all([pool.end(), adminPool.end()]));

describe.runIf(enabled)('Ads installation domain', () => {
  it('exposes unprepared states and rejects members without writing credentials', async () => {
    const svc = service(provider, { providers: {}, syncIntervalMs: 900000 });
    expect((await svc.list(context(member))).map(row => row.status)).toEqual(['unprepared', 'unprepared', 'unprepared']);
    await expect(svc.authorize(context(member), 'google', session)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(svc.authorize(context(), 'google', session)).rejects.toMatchObject({ code: 'integration_unprepared' });
  });
  it('binds single use OAuth state to actor, session, tenant, provider and expiry', async () => {
    const svc = service(); const authorization = await svc.authorize(context(), 'google', session);
    const state = new URL(authorization.authorizationUrl).searchParams.get('state')!;
    await expect(svc.callback(context(), 'google', '2'.repeat(64), { state, code: 'code' })).rejects.toMatchObject({ code: 'oauth_state_invalid' });
    const pending = await svc.callback(context(), 'google', session, { state, code: 'code' });
    expect(pending.status).toBe('pending_account');
    expect(JSON.stringify(pending)).not.toContain('never-expose');
    await expect(svc.callback(context(), 'google', session, { state, code: 'code' })).rejects.toMatchObject({ code: 'oauth_state_invalid' });
    const expired = await svc.authorize(context(), 'google', session);
    await adminPool.query("update marketing_ops.ads_oauth_states set expires_at=now()-interval '1 second' where tenant_id=$1", [manager.tenantId]);
    await expect(svc.callback(context(), 'google', session, { state: new URL(expired.authorizationUrl).searchParams.get('state')!, code: 'code' })).rejects.toMatchObject({ code: 'oauth_state_invalid' });
  });
  it('persists only ciphertext, validates account accessibility and uses optimistic versions', async () => {
    const svc = await connected(); const row = (await svc.list(context())).find(row => row.provider === 'google')!;
    expect(row).toMatchObject({ status: 'connected', selectedAccountId: '123' });
    const persisted = await adminPool.query('select tokens_cipher from marketing_ops.ads_connections where tenant_id=$1 and provider=$2', [manager.tenantId, 'google']);
    expect(JSON.stringify(persisted.rows)).not.toContain('never-expose');
    await expect(svc.selectAccount(context(), 'google', row.version, { accountId: 'foreign' })).rejects.toMatchObject({ code: 'account_not_accessible' });
    await expect(svc.disconnect(context(), 'google', row.version - 1)).rejects.toMatchObject({ code: 'version_conflict' });
    expect((await svc.list(context(other))).every(row => row.selectedAccountId === null)).toBe(true);
  });
  it('requires canonical external campaign and refuses ambiguous links or foreign source attribution', async () => {
    const { svc, campaign, source } = await linked();
    await expect(svc.createLink(context(), campaign.id, { provider: 'google', sourceId: source.id, externalCampaignId: 'foreign', destination: 'whatsapp' }, randomUUID())).rejects.toMatchObject({ code: 'external_campaign_not_accessible' });
    const second = await createCampaignDraft(context(), { name: 'Second', objective: 'Generate leads', referenceType: 'initiative', referenceKey: 'ads-test', referenceTitleSnapshot: 'Ads test', idempotencyKey: randomUUID() });
    const secondSource = await createLeadSource(context(), second.id, { name: 'Other Google source', channel: 'google_ads', kind: 'manual' }, randomUUID());
    await expect(svc.createLink(context(), second.id, { provider: 'google', sourceId: secondSource.id, externalCampaignId: '456', destination: 'landing_page' }, randomUUID())).rejects.toMatchObject({ code: 'ads_link_conflict' });
    await expect(svc.listLinks(context(other), campaign.id)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('replaces daily sync snapshots rather than summing replays and keeps conversions distinct from sales', async () => {
    const { svc, campaign, link } = await linked();
    const key = randomUUID(); const first = await svc.sync(context(), campaign.id, link.id, { from: '2025-09-01', to: '2025-09-01' }, key);
    expect(first).toMatchObject({ status: 'completed', days: 1 });
    expect(await svc.sync(context(), campaign.id, link.id, { from: '2025-09-01', to: '2025-09-01' }, key)).toEqual(first);
    await svc.sync(context(), campaign.id, link.id, { from: '2025-09-01', to: '2025-09-01' }, randomUUID());
    const results = await svc.results(context(), campaign.id, link.id);
    expect(results.daily).toHaveLength(1);
    expect(results.daily[0]).toMatchObject({ spend: 100, conversions: 4 });
    const reports = await listResultReports(context(), campaign.id);
    expect(reports).toHaveLength(1); expect(reports[0]!.metrics).toEqual({ spend: 100, clicked: 12 });
    await expect(updateResultReport(context(), campaign.id, reports[0]!.id, reports[0]!.version, { sourceId: reports[0]!.sourceId, periodFrom: '2025-09-01', periodTo: '2025-09-01', timeZone: 'America/Sao_Paulo', metrics: { spend: 999 } }, randomUUID())).rejects.toThrow();
  });
  it('keeps manual results on overlap and preserves foreign currency separately', async () => {
    const { svc, campaign, source, link } = await linked();
    const manual = await createResultReport(context(), campaign.id, { sourceId: source.id, periodFrom: '2025-09-01', periodTo: '2025-09-07', timeZone: 'America/Sao_Paulo', metrics: { spend: 50 } }, randomUUID());
    expect(await svc.sync(context(), campaign.id, link.id, { from: '2025-09-01', to: '2025-09-01' }, randomUUID())).toMatchObject({ status: 'needs_review' });
    expect((await listResultReports(context(), campaign.id))[0]?.id).toBe(manual.id);
    const foreignClient = { ...provider, accounts: async () => [{ ...account, currency: 'USD' }], dailyMetrics: async () => [{ date: '2025-09-01', currency: 'USD', timeZone: 'America/New_York', spend: 12, clicks: 2, impressions: 30, conversions: null }] };
    const foreign = await linked(service(foreignClient));
    await foreign.svc.sync(context(), foreign.campaign.id, foreign.link.id, { from: '2025-09-01', to: '2025-09-01' }, randomUUID());
    expect((await foreign.svc.results(context(), foreign.campaign.id, foreign.link.id)).daily[0]?.currency).toBe('USD');
    expect(await listResultReports(context(), foreign.campaign.id)).toHaveLength(0);
  });
  it('creates reviewable native lead previews without inventing people from metrics', async () => {
    const client = { ...provider, leads: async () => [{ externalId: 'native-one', externalCampaignId: '456', name: 'Lead', email: `${randomUUID()}@example.invalid`, occurredAt: '2025-09-01T10:00:00Z' }] };
    const { svc, campaign, link } = await linked(service(client),'native_form');
    const receipt = await svc.sync(context(), campaign.id, link.id, { from: '2025-09-01', to: '2025-09-01' }, randomUUID());
    expect(receipt.previewId).toEqual(expect.any(String));
    expect((await listCampaignLeads(context(), campaign.id, { limit: 100 })).data).toHaveLength(0);
  });
  it('fences an in-flight synchronization after disconnect and stops using an inactive installation owner', async () => {
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const client = { ...provider, dailyMetrics: async () => { entered(); await gate; return provider.dailyMetrics({ accessToken: 't', scopes: [] }, account, '456', '2025-09-01', '2025-09-01'); } };
    const { svc, campaign, link } = await linked(service(client));
    const pending = svc.sync(context(), campaign.id, link.id, { from: '2025-09-01', to: '2025-09-01' }, randomUUID()); await started;
    const row = (await svc.list(context())).find(row => row.provider === 'google')!;
    await svc.disconnect(context(), 'google', row.version); release();
    await expect(pending).rejects.toMatchObject({ code: 'connection_changed' });
    expect((await svc.results(context(), campaign.id, link.id)).daily).toHaveLength(0);
    const raw = await withActorTransaction(pool, manager, randomUUID(), db => db.query('select tokens_cipher from marketing_ops.ads_connections where provider=$1', ['google']));
    expect(raw.rows[0]?.tokens_cipher).toBeNull();
  });
  it('does not request native forms for campaigns that send visitors to landing pages',async()=>{
    let leadCalls=0;
    const client={...provider,leads:async()=>{ leadCalls++; throw Object.assign(new Error('sensitive upstream details'),{code:'ads_permission_required'}); }};
    const {svc,campaign,link}=await linked(service(client));
    const receipt=await svc.sync(context(),campaign.id,link.id,{from:'2025-09-01',to:'2025-09-01'},randomUUID());
    expect(leadCalls).toBe(0);
    expect(receipt.warnings).not.toContain('native_leads_permission_required');
    expect((await svc.list(context())).find(row=>row.provider==='google')?.status).toBe('connected');
  });
  it('audits installation authorization, selected account, and disconnect without secrets',async()=>{
    const svc=await connected(); const current=(await svc.list(context())).find(row=>row.provider==='google')!;
    await svc.disconnect(context(),'google',current.version);
    const events=await adminPool.query("select action,after_state from marketing_ops.audit_events where tenant_id=$1 and entity_type='ads_integration' order by created_at desc limit 3",[manager.tenantId]);
    expect(events.rows.map(row=>row.action).sort()).toEqual(['ads.account.selected','ads.authorization.started','ads.disconnected']);
    expect(JSON.stringify(events.rows)).not.toContain('never-expose');
  });
  it('reuses pending native reviews and does not create reviews for already received leads',async()=>{
    const email=`${randomUUID()}@example.invalid`;
    const client={...provider,leads:async()=>[{externalId:'native-repeat',externalCampaignId:'456',name:'Lead',email,occurredAt:'2025-09-01T10:00:00Z'}]};
    const {svc,campaign,link}=await linked(service(client),'native_form'); const period={from:'2025-09-01',to:'2025-09-01'};
    const first=await svc.sync(context(),campaign.id,link.id,period,randomUUID()); const repeat=await svc.sync(context(),campaign.id,link.id,period,randomUUID());
    expect(repeat.previewId).toBe(first.previewId);
    await confirmLeadImport(context(),campaign.id,first.previewId!,{decisions:[{rowIndex:0,action:'create'}]},randomUUID());
    const received=await svc.sync(context(),campaign.id,link.id,period,randomUUID()); expect(received.previewId).toBeNull();
    expect((await listCampaignLeads(context(),campaign.id,{limit:100})).data).toHaveLength(1);
  });
  it('retries a transient provider failure using the durable job without requiring OAuth again',async()=>{
    let calls=0; const client={...provider,dailyMetrics:async()=>{calls++; if(calls===1)throw Object.assign(new Error('Sensitive message'),{code:'ads_provider_unavailable'}); return provider.dailyMetrics({accessToken:'test',scopes:[]},account,'456','2025-09-01','2025-09-01');}};
    const {svc,campaign,link}=await linked(service(client)); const key=randomUUID(); const period={from:'2025-09-01',to:'2025-09-01'};
    await expect(svc.sync(context(),campaign.id,link.id,period,key)).rejects.toMatchObject({code:'ads_provider_unavailable'});
    const row=(await svc.list(context())).find(row=>row.provider==='google')!; expect(row.safeError).toBe('ads_provider_unavailable');
    expect(await svc.sync(context(),campaign.id,link.id,period,key)).toMatchObject({status:'completed'}); expect(calls).toBe(2);
  });
  it('serializes concurrent fetches for one linked advertisement even with different request keys',async()=>{
    let release!:()=>void; let entered!:()=>void; let calls=0; const gate=new Promise<void>(resolve=>{release=resolve;}); const started=new Promise<void>(resolve=>{entered=resolve;});
    const client={...provider,dailyMetrics:async()=>{calls++; if(calls===1){entered();await gate;} return provider.dailyMetrics({accessToken:'test',scopes:[]},account,'456','2025-09-01','2025-09-01');}};
    const {svc,campaign,link}=await linked(service(client)); const period={from:'2025-09-01',to:'2025-09-01'};
    const first=svc.sync(context(),campaign.id,link.id,period,randomUUID()); await started;
    try {await expect(svc.sync(context(),campaign.id,link.id,period,randomUUID())).rejects.toMatchObject({code:'sync_in_progress'});} finally {release();await first;}
    expect(calls).toBe(1);
  });
  it('splits native leads into reviewable batches without discarding rows or creating people',async()=>{
    const suffix=randomUUID(); const client={...provider,leads:async()=>Array.from({length:501},(_,index)=>({externalId:`batch-${index}`,externalCampaignId:'456',name:`Lead ${index}`,email:`${suffix}-${index}@example.invalid`,occurredAt:'2025-09-01T10:00:00Z'}))};
    const {svc,campaign,link}=await linked(service(client),'native_form');
    const receipt=await svc.sync(context(),campaign.id,link.id,{from:'2025-09-01',to:'2025-09-01'},randomUUID());
    expect(receipt.previewIds).toHaveLength(2); expect(receipt.previewId).toBe(receipt.previewIds[0]);
    const persisted=await adminPool.query('select jsonb_array_length(rows) as count from marketing_ops.lead_import_previews where id=any($1::uuid[]) order by count desc',[receipt.previewIds]);
    expect(persisted.rows.map(row=>row.count)).toEqual([500,1]);
    expect((await listCampaignLeads(context(),campaign.id,{limit:100})).data).toHaveLength(0);
  });
  it('keeps LinkedIn account-only consent partial without advertising reporting or native capture claims',async()=>{
    const client={...provider,exchange:async()=>({accessToken:'test',scopes:['r_ads']})};
    const settings:AdsConfig={...config,providers:{linkedin:{...config.providers.google!,scopes:['r_ads']}}};
    const {svc,campaign,link}=await linked(new AdsIntegrationService(pool,settings,{linkedin:client}),'landing_page','linkedin');
    let row=(await svc.list(context())).find(row=>row.provider==='linkedin')!;
    expect(row).toMatchObject({status:'partial',capabilities:{metrics:false,nativeLeads:false}});
    await svc.sync(context(),campaign.id,link.id,{from:'2025-09-01',to:'2025-09-01'},randomUUID());
    row=(await svc.list(context())).find(row=>row.provider==='linkedin')!;
    expect(row).toMatchObject({status:'partial',capabilities:{metrics:false,nativeLeads:false}});
  });
  it('revokes native capture capability after an actual permission denial and preserves partial on landing-page sync',async()=>{
    const client={...provider,leads:async()=>{throw Object.assign(new Error('provider private details'),{code:'ads_permission_required'});}};
    const {svc,campaign,source,link}=await linked(service(client),'native_form');
    const period={from:'2025-09-01',to:'2025-09-01'};
    expect((await svc.sync(context(),campaign.id,link.id,period,randomUUID())).warnings).toContain('native_leads_permission_required');
    expect((await svc.list(context())).find(row=>row.provider==='google')).toMatchObject({status:'partial',capabilities:{metrics:true,nativeLeads:false}});
    await svc.disableLink(context(),campaign.id,link.id,link.version,randomUUID());
    const lp=await svc.createLink(context(),campaign.id,{provider:'google',sourceId:source.id,externalCampaignId:'456',destination:'landing_page'},randomUUID());
    await svc.sync(context(),campaign.id,lp.id,period,randomUUID());
    expect((await svc.list(context())).find(row=>row.provider==='google')).toMatchObject({status:'partial',capabilities:{metrics:true,nativeLeads:false}});
  });
  it('revokes reporting capability after a metrics permission denial instead of claiming metrics are available',async()=>{
    const client={...provider,dailyMetrics:async()=>{throw Object.assign(new Error('provider private details'),{code:'ads_permission_required'});}};
    const {svc,campaign,link}=await linked(service(client));
    await expect(svc.sync(context(),campaign.id,link.id,{from:'2025-09-01',to:'2025-09-01'},randomUUID())).rejects.toMatchObject({code:'ads_permission_required'});
    expect((await svc.list(context())).find(row=>row.provider==='google')).toMatchObject({status:'partial',capabilities:{metrics:false,nativeLeads:true},safeError:'ads_permission_required'});
  });
  it('keeps valid metrics when a native form version is unavailable and does not stop other landing-page links',async()=>{
    const client={...provider,campaigns:async()=>[{id:'456',name:'Native',status:'active'},{id:'789',name:'LP',status:'active'}],leads:async()=>{throw Object.assign(new Error('private upstream details'),{code:'ads_form_version_unavailable'});}};
    const {svc,campaign,link}=await linked(service(client),'native_form'); const period={from:'2025-09-01',to:'2025-09-01'};
    const receipt=await svc.sync(context(),campaign.id,link.id,period,randomUUID());
    expect(receipt).toMatchObject({status:'needs_review',days:1,reports:1,previewId:null}); expect(receipt.warnings).toContain('ads_form_version_unavailable');
    expect((await svc.list(context())).find(row=>row.provider==='google')).toMatchObject({status:'connected',capabilities:{metrics:true,nativeLeads:true}});
    const source=await createLeadSource(context(),campaign.id,{name:'LP',channel:'google_ads',kind:'manual'},randomUUID());
    const lp=await svc.createLink(context(),campaign.id,{provider:'google',sourceId:source.id,externalCampaignId:'789',destination:'landing_page'},randomUUID());
    expect(await svc.sync(context(),campaign.id,lp.id,period,randomUUID())).toMatchObject({status:'completed',days:1,reports:1});
  });
  it('imports native-only LinkedIn consent without inventing unavailable reporting data',async()=>{
    const email=`${randomUUID()}@example.invalid`;let metricCalls=0;
    const client={...provider,exchange:async()=>({accessToken:'test',scopes:['r_ads','r_marketing_leadgen_automation']}),dailyMetrics:async()=>{metricCalls++;throw Object.assign(new Error('reporting unavailable'),{code:'ads_permission_required'});},leads:async()=>[{externalId:'native-only',externalCampaignId:'456',name:'Lead',email,occurredAt:'2025-09-01T10:00:00Z'}]};
    const settings:AdsConfig={...config,providers:{linkedin:{...config.providers.google!,scopes:['r_ads','r_marketing_leadgen_automation']}}};
    const {svc,campaign,link}=await linked(new AdsIntegrationService(pool,settings,{linkedin:client}),'native_form','linkedin');
    const receipt=await svc.sync(context(),campaign.id,link.id,{from:'2025-09-01',to:'2025-09-01'},randomUUID());
    expect(metricCalls).toBe(0);expect(receipt.previewId).toEqual(expect.any(String));expect(receipt.warnings).toContain('metrics_permission_required');
    expect((await svc.results(context(),campaign.id,link.id)).daily).toHaveLength(0);expect(await listResultReports(context(),campaign.id)).toHaveLength(0);
    expect(await getLeadResults(context(),{campaignId:campaign.id})).toMatchObject({spend:null,sales:null,capturedLeads:0});
  });
  it('excludes disabled sources from the bounded scheduler discovery so healthy links cannot starve',async()=>{
    const client={...provider,campaigns:async()=>[{id:'456',name:'Healthy',status:'active'},...Array.from({length:11},(_,i)=>({id:`bad-${i}`,name:'Paused',status:'active'}))]};
    const {svc,campaign,link}=await linked(service(client));await transitionCampaign(context(),campaign.id,campaign.version,'planned',randomUUID());
    for(let i=0;i<11;i++){const source=await createLeadSource(context(),campaign.id,{name:`Paused ${i}`,channel:'google_ads',kind:'manual'},randomUUID());const bad=await svc.createLink(context(),campaign.id,{provider:'google',sourceId:source.id,externalCampaignId:`bad-${i}`,destination:'landing_page'},randomUUID());await updateLeadSource(context(),campaign.id,source.id,source.version,{enabled:false},randomUUID());await adminPool.query("update marketing_ops.ads_links set next_sync_at=now()-interval '1 day' where id=$1",[bad.id]);}
    const due=await pool.query('select * from marketing_ops_private.ads_due_links(10)');
    expect(due.rows.map(row=>row.link_id)).toEqual([link.id]);
  });
  it('retires missing authoritative days without retaining stale spend or overwriting a manual replacement',async()=>{
    let empty=false;const client={...provider,dailyMetrics:async()=>empty?[]:provider.dailyMetrics({accessToken:'test',scopes:[]},account,'456','2025-09-01','2025-09-01')};
    const {svc,campaign,source,link}=await linked(service(client));const period={from:'2025-09-01',to:'2025-09-01'};
    await svc.sync(context(),campaign.id,link.id,period,randomUUID());const previous=(await listResultReports(context(),campaign.id))[0]!;expect((await getLeadResults(context(),{campaignId:campaign.id})).spend).toBe(100);
    empty=true;await svc.sync(context(),campaign.id,link.id,period,randomUUID());
    expect((await svc.results(context(),campaign.id,link.id)).daily).toHaveLength(0);expect(await listResultReports(context(),campaign.id)).toHaveLength(0);expect((await getLeadResults(context(),{campaignId:campaign.id})).spend).toBeNull();
    const raw=await adminPool.query('select active,spend from marketing_ops.ads_daily_metrics where link_id=$1',[link.id]);expect(raw.rows[0]).toMatchObject({active:false,spend:'100.00'});expect(await listReportRevisions(context(),campaign.id,previous.id)).toHaveLength(2);
    await createResultReport(context(),campaign.id,{sourceId:source.id,periodFrom:'2025-09-01',periodTo:'2025-09-01',timeZone:'America/Sao_Paulo',metrics:{spend:50}},randomUUID());
    await svc.sync(context(),campaign.id,link.id,period,randomUUID());expect((await getLeadResults(context(),{campaignId:campaign.id})).spend).toBe(50);
  });
});
