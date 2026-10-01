import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { resolveActor } from '../auth/actor.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import { adsProviders, type AdsAccount, type AdsConfig, type AdsDailyMetric, type AdsLead, type AdsProvider, type AdsProviderClient, type AdsProviderConfig, type AdsTokens } from '../integrations/ads/types.js';
import { AdsSetupStore } from '../integrations/ads/setupStore.js';
import { createAdsProviderClient } from '../integrations/ads/providers.js';
import { adsSetupSchema } from './adsSetupContracts.js';
import type { CommandContext } from './context.js';
import { hashCanonicalPayload } from './hash.js';
import { executeIdempotentCommand } from './idempotency.js';
import { AdsAccountInputSchema, AdsCallbackSchema, AdsDailySchema, AdsLinkInputSchema, AdsPeriodSchema, adsSyncPeriod } from './adsContracts.js';
import { openAdsSecret, sealAdsSecret } from './adsCrypto.js';
import { leadReceiptKey, mapResultReport } from './leads.js';
import { LeadRowSchema, type ImportReviewRow } from './leadsContracts.js';
import { writeAudit } from './audit.js';
import { adsCallbackDiagnostic, type AdsCallbackPhase } from './adsDiagnostics.js';
import { createLogger } from '../observability/logger.js';

type Row = Record<string, any>;
export interface AdsConnectionView {
  provider: AdsProvider; status: 'unprepared'|'prepared'|'pending_account'|'connected'|'partial'|'reconnect_required'|'disconnected'|'error';
  version: number; accounts: AdsAccount[]; selectedAccountId: string|null;
  capabilities: { metrics: boolean; nativeLeads: boolean }; lastSyncAt: string|null; safeError: string|null;
}
export interface AdsLinkView {
  id: string; campaignId: string; provider: AdsProvider; sourceId: string; externalAccountId: string; externalCampaignId: string;
  destination: 'native_form'|'landing_page'|'whatsapp'; enabled: boolean; version: number; lastSyncAt: string|null; safeError: string|null;
}
export interface AdsSyncReceipt { id: string; status: 'completed'|'needs_review'; days: number; reports: number; previewId: string|null; previewIds: string[]; warnings: string[]; completedAt: string }
interface Snapshot { row: Row; tokens: AdsTokens; account: AdsAccount|null; client: AdsProviderClient }
export interface AdsSetupView {
  provider: AdsProvider; version: number; mode: 'empty'|'managed'|'external'; writable: boolean; ready: boolean;
  publicOrigin: string|null; redirectUri: string|null; clientId: string|null; apiVersion: string|null; scopes: string[];
  metaLoginConfigId: string|null; googleLoginCustomerId: string|null; hasClientSecret: boolean;
}
interface AdsSetupOptions { store: AdsSetupStore; createClient?: (provider: AdsProvider, config: AdsProviderConfig) => AdsProviderClient }
interface Reservation { link: Row; connection: Row; sourceVersion: number; jobId: string }
const iso = (value?: Date|string|null): string|null => value ? new Date(value).toISOString() : null;
const day = (value: Date|string): string => value instanceof Date ? value.toISOString().slice(0,10) : value;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const adsDiagnosticLogger = createLogger();
function viewLink(row: Row): AdsLinkView { return { id: row.id, campaignId: row.campaign_id, provider: row.provider, sourceId: row.source_id, externalAccountId: row.external_account_id, externalCampaignId: row.external_campaign_id, destination: row.destination, enabled: row.enabled, version: Number(row.version), lastSyncAt: iso(row.last_sync_at), safeError: row.safe_error }; }
function checkVersion(row: Row, expected: number): void { if (Number(row.version)!==expected) throw appError('version_conflict',409,'Observed version is stale',{ currentVersion: Number(row.version) }); }
function safeError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  return ['ads_provider_unavailable','ads_provider_error','ads_permission_required','ads_reconnect_required','ads_invalid_response','ads_rate_limited','ads_account_unavailable','ads_page_limit','ads_form_version_unavailable'].includes(code ?? '') ? code! : 'ads_provider_unavailable';
}
function grantedCapabilities(provider:AdsProvider,tokens:AdsTokens):AdsConnectionView['capabilities'] {
  const scopes=new Set(tokens.scopes);
  const metrics=provider==='google'?scopes.has('https://www.googleapis.com/auth/adwords'):provider==='meta'?(scopes.has('ads_read')||scopes.has('ads_management')):scopes.has('r_ads_reporting');
  const nativeLeads=provider==='google'?metrics:provider==='meta'?scopes.has('leads_retrieval'):scopes.has('r_marketing_leadgen_automation');
  return {metrics,nativeLeads};
}
function capabilityStatus(capabilities:AdsConnectionView['capabilities']):'connected'|'partial' {
  return capabilities.metrics&&capabilities.nativeLeads?'connected':'partial';
}
async function lockTenant(db: PoolClient, context: CommandContext) { await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`lead-ingestion:${context.actor.tenantId}`]); }
async function campaign(db: PoolClient,id: string,edit = false) {
  const visible = await db.query('select id from marketing_ops.campaigns where id=$1 and marketing_ops_private.can_access_campaign(id)',[id]);
  if (!visible.rows[0]) throw appError('not_found',404,'Campaign not found');
  if (edit) {
    const allowed = await db.query('select marketing_ops_private.can_edit_campaign($1) as allowed',[id]);
    if (!allowed.rows[0]?.allowed) throw appError('forbidden',403,'Campaign does not grant mutation authority');
    await db.query('select id from marketing_ops.campaigns where id=$1 for update',[id]);
  }
}

export class AdsIntegrationService {
  private readonly external: AdsConfig['providers'];
  private readonly externalClients: Partial<Record<AdsProvider, AdsProviderClient>>;
  private publications: Row[] = [];
  private installationTenantId: string|null = null;
  private readonly loadedFiles = new Map<AdsProvider,string>();
  constructor(readonly pool: Pool, private config: AdsConfig, private providers: Partial<Record<AdsProvider,AdsProviderClient>>, private setupOptions?: AdsSetupOptions) {
    this.external = { ...config.providers }; this.externalClients = { ...providers };
    this.config={...config,providers:{...config.providers}}; this.providers={...providers};
    if (setupOptions) this.config.encryptionKey = setupOptions.store.key;
  }
  /** Server-only runtime snapshot. Never serialize this result into HTTP. */
  async analyticsRuntime(context:CommandContext):Promise<{key:Buffer;google:AdsProviderConfig|null;version:string}> {
    await this.actor(context,true);
    return this.transaction(context,async()=>{
      if(!this.config.encryptionKey) throw appError('analytics_storage_unavailable',503,'Private analytics storage is unavailable');
      const google=this.prepared('google')?this.config.providers.google!:null;
      const publication=this.publications.find(row=>row.provider==='google');
      return {key:this.config.encryptionKey,google:google?{...google,scopes:[...google.scopes]}:null,version:publication?`managed:${publication.version}`:google?`external:${digest(JSON.stringify(google))}`:'empty'};
    });
  }
  private prepared(provider: AdsProvider): boolean { return !!this.config.providers[provider] && this.config.encryptionKey?.length===32 && !!this.providers[provider] && (!this.setupOptions || !!this.config.publicOrigin); }
  private client(provider: AdsProvider): AdsProviderClient {
    if (!this.prepared(provider)) throw appError('integration_unprepared',409,'This installation has not prepared the provider');
    return this.providers[provider]!;
  }
  private binding(context: CommandContext,provider: AdsProvider,generation: number|string,purpose: string) { return `${context.actor.tenantId}:${provider}:${generation}:${purpose}`; }
  private async actor(context: CommandContext, manage = false) {
    const current = await resolveActor(this.pool,context.actor.userId,context.actor.tenantId);
    if (current.role!==context.actor.role || (manage && !['admin','manager'].includes(current.role))) throw appError('forbidden',403,'Current installation manager authority is required');
  }
  private transaction<T>(context: CommandContext,work: (db: PoolClient)=>Promise<T>,allowForeign=false) {
    return withActorTransaction(this.pool,context.actor,context.correlationId,async db => {
      if (this.setupOptions) {
        // The same lock serializes publication and all token/state writers across
        // processes. HTTP reads happen after releasing it and retain their client.
        await db.query("select pg_advisory_xact_lock(hashtextextended('ads-installation-setup',0))");
        const binding=await db.query('select tenant_id from marketing_ops_private.ads_setup_binding');
        this.installationTenantId=binding.rows[0]?.tenant_id??null;
        if(this.installationTenantId && this.installationTenantId!==context.actor.tenantId) {
          if(!allowForeign) throw appError('forbidden',403,'This installation belongs to another tenant');
        } else await this.reloadSetup(db);
      }
      return work(db);
    });
  }
  private async reloadSetup(db: PoolClient): Promise<void> {
    const rows=await db.query('select * from marketing_ops_private.ads_setup_publications');
    this.publications=rows.rows;
    for(const provider of adsProviders) {
      const publication=rows.rows.find(row=>row.provider===provider);
      if(publication) {
        // Stored credentials survive moves between environments. Callback URLs
        // always follow the current trusted server origin, never the saved host.
        const settings={...this.setupOptions!.store.read(provider,publication.file_id),redirectUri:this.config.publicOrigin?`${this.config.publicOrigin}/api/ads/oauth/${provider}/callback`:''};
        this.config.providers[provider]=settings;
        if(!this.config.publicOrigin) {
          delete this.providers[provider]; this.loadedFiles.delete(provider);
        } else if(this.loadedFiles.get(provider)!==publication.file_id) {
          this.providers[provider]=(this.setupOptions!.createClient??createAdsProviderClient)(provider,settings);
          this.loadedFiles.set(provider,publication.file_id);
        }
      } else {
        this.loadedFiles.delete(provider);
        if(this.external[provider]) {
          this.config.providers[provider]=this.external[provider];
          this.providers[provider]=this.externalClients[provider]??(this.setupOptions!.createClient??createAdsProviderClient)(provider,this.external[provider]!);
        } else { delete this.config.providers[provider]; delete this.providers[provider]; }
      }
    }
  }
  private setupView(provider: AdsProvider, settings=this.config.providers[provider], version=Number(this.publications.find(row=>row.provider===provider)?.version??1), managed=this.publications.some(row=>row.provider===provider)): AdsSetupView {
    const mode=managed?'managed':settings?'external':'empty'; const origin=this.config.publicOrigin??null;
    return {provider,version,mode,writable:!!this.setupOptions&&mode!=='external'&&!!origin,ready:!!settings&&this.config.encryptionKey?.length===32&&(!this.setupOptions||!!origin),
      publicOrigin:origin,redirectUri:origin?`${origin}/api/ads/oauth/${provider}/callback`:null,clientId:settings?.clientId??null,apiVersion:settings?.apiVersion??null,scopes:settings?.scopes??[],metaLoginConfigId:provider==='meta'?settings?.loginConfigId??null:null,googleLoginCustomerId:provider==='google'?settings?.loginCustomerId??null:null,hasClientSecret:!!settings?.clientSecret};
  }
  private async setupAdmin(context: CommandContext): Promise<void> {
    await this.actor(context,true);
    if(context.actor.role!=='admin') throw appError('forbidden',403,'Current installation administrator authority is required');
  }
  async setup(context: CommandContext,provider: AdsProvider): Promise<AdsSetupView> {
    await this.setupAdmin(context); return this.transaction(context,async db=>{
      if(this.setupOptions && !this.installationTenantId) {
        await db.query('insert into marketing_ops_private.ads_setup_binding(singleton,tenant_id) values(true,$1) on conflict(singleton) do nothing',[context.actor.tenantId]);
        this.installationTenantId=context.actor.tenantId;
      }
      return this.setupView(provider);
    });
  }
  async saveSetup(context: CommandContext,provider: AdsProvider,expected: number,input: unknown,key: string): Promise<AdsSetupView> {
    await this.setupAdmin(context);
    const value=adsSetupSchema(provider).parse(input);
    if(!this.setupOptions) throw appError('ads_setup_storage_unavailable',503,'Private Ads configuration storage is unavailable');
    if(!this.config.publicOrigin) throw appError('ads_setup_origin_required',409,'A trusted public application origin must be configured');
    const hash=hashCanonicalPayload({expected,input:value});
    return this.transaction(context,async db=>{
      const previous=await db.query('select * from marketing_ops_private.ads_setup_receipts where tenant_id=$1 and actor_id=$2 and provider=$3 and idempotency_key=$4',[context.actor.tenantId,context.actor.userId,provider,key]);
      if(previous.rows[0]) {
        if(previous.rows[0].request_hash!==hash) throw appError('idempotency_conflict',409,'Setup key already used with another configuration');
        return previous.rows[0].response as AdsSetupView;
      }
      const current=this.setupView(provider);
      if(current.version!==expected) throw appError('version_conflict',409,'Observed version is stale',{currentVersion:current.version});
      if(current.mode!=='empty' && (!value.confirmReplacement || (current.mode==='external'&&!value.takeOverExternal))) throw appError('ads_setup_confirmation_required',409,'Confirm replacement and renewed account authorization');
      const secret=value.clientSecret?.trim() || (current.mode==='managed'?this.config.providers[provider]?.clientSecret:undefined);
      if(!secret) throw appError('ads_setup_secret_required',422,'A client secret is required for the first setup or external takeover');
      const settings: AdsProviderConfig={clientId:value.clientId,clientSecret:secret,apiVersion:value.apiVersion,scopes:value.scopes,redirectUri:current.redirectUri!};
      if(provider==='meta') settings.loginConfigId=(value as unknown as {metaLoginConfigId:string}).metaLoginConfigId;
      if(provider==='google') {
        const loginCustomerId=(value as {googleLoginCustomerId?:string}).googleLoginCustomerId;
        if(loginCustomerId) settings.loginCustomerId=loginCustomerId;
      }
      this.setupOptions!.store.prune(this.publications.map(row=>row.file_id));
      const file=this.setupOptions!.store.write(provider,settings);
      // Build before publishing so factory/configuration errors leave DB intact.
      (this.setupOptions!.createClient??createAdsProviderClient)(provider,settings);
      await lockTenant(db,context);
      await db.query('insert into marketing_ops_private.ads_setup_binding(singleton,tenant_id) values(true,$1) on conflict(singleton) do nothing',[context.actor.tenantId]);
      await db.query('insert into marketing_ops_private.ads_setup_publications(provider,tenant_id,version,file_id) values($1,$2,$3,$4) on conflict(provider) do update set version=excluded.version,file_id=excluded.file_id,updated_at=now()',[provider,context.actor.tenantId,current.version+1,file]);
      await db.query(`insert into marketing_ops.ads_connections(tenant_id,provider,owner_id,status) values($1,$2,$3,'prepared') on conflict(tenant_id,provider) do update set owner_id=excluded.owner_id,generation=ads_connections.generation+1,version=ads_connections.version+1,status='prepared',tokens_cipher=null,accounts='[]',selected_account_id=null,capabilities='{"metrics":false,"nativeLeads":false}',safe_error=null,updated_at=now()`,[context.actor.tenantId,provider,context.actor.userId]);
      await db.query('update marketing_ops.ads_oauth_states set consumed_at=now() where tenant_id=$1 and provider=$2 and consumed_at is null',[context.actor.tenantId,provider]);
      if(provider==='google') {
        await db.query("update marketing_ops.web_analytics_connections set status='prepared',generation=generation+1,version=version+1,tokens_cipher=null,resources='[]',selected_resource_id=null,safe_error=null where tenant_id=$1 and provider='ga4'",[context.actor.tenantId]);
        await db.query('update marketing_ops.web_analytics_oauth_states set consumed_at=now() where tenant_id=$1 and consumed_at is null',[context.actor.tenantId]);
        await db.query("update marketing_ops.web_analytics_jobs set status='cancelled',safe_error='analytics_connection_changed' where tenant_id=$1 and provider='ga4' and status='running'",[context.actor.tenantId]);
      }
      await db.query("update marketing_ops.ads_sync_jobs set status='cancelled',finished_at=now(),safe_error='connection_changed' where tenant_id=$1 and status='running' and link_id in(select id from marketing_ops.ads_links where provider=$2)",[context.actor.tenantId,provider]);
      const response=this.setupView(provider,settings,current.version+1,true);
      await db.query('insert into marketing_ops_private.ads_setup_receipts(tenant_id,actor_id,provider,idempotency_key,request_hash,response) values($1,$2,$3,$4,$5,$6::jsonb)',[context.actor.tenantId,context.actor.userId,provider,key,hash,JSON.stringify(response)]);
      await writeAudit(db,context,'ads_integration',context.actor.tenantId,'ads.setup.saved',null,{provider,version:response.version,mode:'managed'});
      return response;
    });
  }
  private view(provider: AdsProvider,row?: Row): AdsConnectionView {
    return { provider, status: !this.prepared(provider) ? 'unprepared' : row?.status ?? 'prepared', version: Number(row?.version ?? 1), accounts: row?.accounts ?? [], selectedAccountId: row?.selected_account_id ?? null, capabilities: row?.capabilities ?? { metrics: false,nativeLeads: false }, lastSyncAt: iso(row?.last_sync_at), safeError: row?.safe_error ?? null };
  }
  private async connection(db: PoolClient,provider: AdsProvider,lock = false): Promise<Row> {
    const found = await db.query(`select * from marketing_ops.ads_connections where provider=$1${lock ? ' for update':''}`,[provider]);
    if (!found.rows[0]) throw appError('integration_not_connected',409,'Connect the provider first');
    return found.rows[0];
  }
  async list(context: CommandContext): Promise<AdsConnectionView[]> {
    await this.actor(context);
    return this.transaction(context,async db => { if(this.installationTenantId&&this.installationTenantId!==context.actor.tenantId)return adsProviders.map(provider=>({...this.view(provider),status:'unprepared' as const,accounts:[],selectedAccountId:null})); const rows = await db.query('select * from marketing_ops.ads_connections'); return adsProviders.map(provider => this.view(provider,rows.rows.find(row=>row.provider===provider))); },true);
  }
  async authorize(context: CommandContext,provider: AdsProvider,sessionHash: string): Promise<{ authorizationUrl: string }> {
    await this.actor(context,true);
    if (!/^[0-9a-f]{64}$/.test(sessionHash)) throw appError('oauth_session_required',400,'An internal session binding is required');
    const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(32).toString('base64url');
    return this.transaction(context,async db => {
      const client=this.client(provider);
      await lockTenant(db,context);
      const result = await db.query(`insert into marketing_ops.ads_connections(tenant_id,provider,owner_id,status) values($1,$2,$3,'prepared')
        on conflict(tenant_id,provider) do update set owner_id=excluded.owner_id,generation=ads_connections.generation+1,version=ads_connections.version+1,status='prepared',tokens_cipher=null,accounts='[]',selected_account_id=null,capabilities='{"metrics":false,"nativeLeads":false}',safe_error=null,updated_at=now() returning *`,[context.actor.tenantId,provider,context.actor.userId]);
      const row = result.rows[0]!;
      await db.query('update marketing_ops.ads_oauth_states set consumed_at=now() where tenant_id=$1 and provider=$2 and consumed_at is null',[context.actor.tenantId,provider]);
      await db.query(`insert into marketing_ops.ads_oauth_states(state_hash,tenant_id,provider,actor_id,session_hash,generation,verifier_cipher) values($1,$2,$3,$4,$5,$6,$7)`,[digest(state),context.actor.tenantId,provider,context.actor.userId,sessionHash,row.generation,sealAdsSecret(this.config.encryptionKey!,this.binding(context,provider,row.generation,'pkce'),verifier)]);
      await writeAudit(db,context,'ads_integration',context.actor.tenantId,'ads.authorization.started',null,{provider,generation:Number(row.generation)});
      return {authorizationUrl:client.authorizationUrl(state,verifier)};
    });
  }
  async callback(context: CommandContext,provider: AdsProvider,sessionHash: string,input: unknown): Promise<AdsConnectionView> {
    await this.actor(context,true); const callback = AdsCallbackSchema.parse(input);
    // Consume in a committed transaction. Denial/exchange failure cannot make
    // a state reusable, and HTTP never holds a database transaction open.
    const consumed = await this.transaction(context,async db => {
      const client=this.client(provider);
      await lockTenant(db,context);
      const found = await db.query(`update marketing_ops.ads_oauth_states set consumed_at=now() where state_hash=$1 and tenant_id=$2 and provider=$3 and actor_id=$4 and session_hash=$5 and consumed_at is null and expires_at>now()
        and generation=(select generation from marketing_ops.ads_connections where tenant_id=$2 and provider=$3) returning *`,[digest(callback.state),context.actor.tenantId,provider,context.actor.userId,sessionHash]);
      if (!found.rows[0]) throw appError('oauth_state_invalid',400,'OAuth state expired or does not belong to this session');
      return {state:found.rows[0],client};
    });
    const {state,client}=consumed;
    if (callback.error) { await this.markConnection(context,provider,Number(state.generation),'disconnected','oauth_denied'); throw appError('oauth_denied',400,'Authorization was not granted'); }
    let phase: AdsCallbackPhase = 'verifier';
    try {
      const verifier = openAdsSecret<string>(this.config.encryptionKey!,this.binding(context,provider,state.generation,'pkce'),state.verifier_cipher);
      phase = 'exchange';
      const tokens = await client.exchange(callback.code!,verifier);
      phase = 'accounts';
      const accounts = await client.accounts(tokens);
      phase = 'persistence';
      await this.actor(context,true);
      return await this.transaction(context,async db => {
        await lockTenant(db,context); const row = await this.connection(db,provider,true);
        if (Number(row.generation)!==Number(state.generation)) throw appError('connection_changed',409,'Connection changed during authorization');
        const capabilities=grantedCapabilities(provider,tokens);
        const updated = await db.query(`update marketing_ops.ads_connections set tokens_cipher=$2,accounts=$3::jsonb,status='pending_account',capabilities=$4::jsonb,safe_error=null,version=version+1,updated_at=now() where tenant_id=$1 and provider=$5 returning *`,[context.actor.tenantId,sealAdsSecret(this.config.encryptionKey!,this.binding(context,provider,row.generation,'tokens'),tokens),JSON.stringify(accounts),JSON.stringify(capabilities),provider]);
        return this.view(provider,updated.rows[0]);
      });
    } catch (error) {
      if ((error as {code?:string})?.code==='connection_changed') throw error;
      adsDiagnosticLogger.warn('Ads authorization failed',adsCallbackDiagnostic(provider,phase,error));
      const code = safeError(error); await this.markConnection(context,provider,Number(state.generation),code==='ads_reconnect_required' ? 'reconnect_required':'error',code);
      throw appError(code,502,'The provider could not complete authorization');
    }
  }
  private async markConnection(context: CommandContext,provider: AdsProvider,generation: number,status: string,error: string|null) {
    await this.transaction(context,async db => { await lockTenant(db,context); await db.query('update marketing_ops.ads_connections set status=$4,safe_error=$5,version=version+1,updated_at=now() where tenant_id=$1 and provider=$2 and generation=$3',[context.actor.tenantId,provider,generation,status,error]); });
  }
  private async snapshot(context: CommandContext,provider: AdsProvider): Promise<Snapshot> {
    const saved=await this.transaction(context,async db=>({row:await this.connection(db,provider),client:this.client(provider)})); const {row,client}=saved;
    if (!row.tokens_cipher || !['pending_account','connected','partial'].includes(row.status)) throw appError('integration_not_connected',409,'Reconnect the provider to continue');
    const owner = await resolveActor(this.pool,row.owner_id,context.actor.tenantId);
    if (!['admin','manager'].includes(owner.role)) throw appError('integration_owner_inactive',403,'The integration owner no longer has installation authority');
    return { row,client, tokens: openAdsSecret<AdsTokens>(this.config.encryptionKey!,this.binding(context,provider,row.generation,'tokens'),row.tokens_cipher), account: row.accounts.find((account: AdsAccount)=>account.id===row.selected_account_id) ?? null };
  }
  private async refreshed(context: CommandContext,provider: AdsProvider,snapshot: Snapshot): Promise<AdsTokens> {
    let tokens = snapshot.tokens; if (!tokens.expiresAt || Date.parse(tokens.expiresAt)>Date.now()+60000) return tokens;
    try { tokens = await snapshot.client.refresh(tokens); }
    catch (error) { const code = safeError(error); const transient=['ads_provider_unavailable','ads_provider_error','ads_rate_limited'].includes(code); await this.markConnection(context,provider,Number(snapshot.row.generation),code==='ads_reconnect_required'?'reconnect_required':transient?snapshot.row.status:'error',code); throw appError(code,502,'Unable to refresh the Ads connection'); }
    await this.transaction(context,async db => { await lockTenant(db,context); const current = await this.connection(db,provider,true); if (current.generation!==snapshot.row.generation || !current.tokens_cipher) throw appError('connection_changed',409,'Connection changed during token refresh');
      await db.query('update marketing_ops.ads_connections set tokens_cipher=$3,updated_at=now() where tenant_id=$1 and provider=$2',[context.actor.tenantId,provider,sealAdsSecret(this.config.encryptionKey!,this.binding(context,provider,current.generation,'tokens'),tokens)]);
    }); return tokens;
  }
  async accounts(context: CommandContext,provider: AdsProvider): Promise<AdsAccount[]> {
    await this.actor(context,true); const snapshot = await this.snapshot(context,provider); const tokens = await this.refreshed(context,provider,snapshot); const accounts = await snapshot.client.accounts(tokens);
    await this.transaction(context,async db => { await lockTenant(db,context); const row = await this.connection(db,provider,true); if (row.generation!==snapshot.row.generation || !row.tokens_cipher) throw appError('connection_changed',409,'Connection changed during account listing');
      await db.query('update marketing_ops.ads_connections set accounts=$3::jsonb where tenant_id=$1 and provider=$2',[context.actor.tenantId,provider,JSON.stringify(accounts)]);
    }); return accounts;
  }
  async selectAccount(context: CommandContext,provider: AdsProvider,expected: number,input: unknown): Promise<AdsConnectionView> {
    await this.actor(context,true); const { accountId } = AdsAccountInputSchema.parse(input); const snapshot = await this.snapshot(context,provider); checkVersion(snapshot.row,expected);
    const tokens = await this.refreshed(context,provider,snapshot); const accounts = await snapshot.client.accounts(tokens);
    if (!accounts.some(account=>account.id===accountId && !account.manager)) throw appError('account_not_accessible',422,'Select an accessible advertising account');
    await this.actor(context,true);
    return this.transaction(context,async db => {
      await lockTenant(db,context); const row = await this.connection(db,provider,true); checkVersion(row,expected);
      if (row.generation!==snapshot.row.generation || !row.tokens_cipher) throw appError('connection_changed',409,'Connection changed during account selection');
      const generation = Number(row.generation)+1;
      const updated = await db.query(`update marketing_ops.ads_connections set selected_account_id=$3,accounts=$4::jsonb,generation=$5,tokens_cipher=$6,status=$7,version=version+1,safe_error=null,updated_at=now() where tenant_id=$1 and provider=$2 returning *`,[context.actor.tenantId,provider,accountId,JSON.stringify(accounts),generation,sealAdsSecret(this.config.encryptionKey!,this.binding(context,provider,generation,'tokens'),tokens),capabilityStatus(row.capabilities)]);
      await writeAudit(db,context,'ads_integration',context.actor.tenantId,'ads.account.selected',null,{provider,accountId,generation});
      return this.view(provider,updated.rows[0]);
    });
  }
  async disconnect(context: CommandContext,provider: AdsProvider,expected: number): Promise<AdsConnectionView> {
    await this.actor(context,true); return this.transaction(context,async db => {
      await lockTenant(db,context); const row = await this.connection(db,provider,true); checkVersion(row,expected);
      const updated = await db.query(`update marketing_ops.ads_connections set generation=generation+1,version=version+1,status='disconnected',tokens_cipher=null,safe_error=null,updated_at=now() where tenant_id=$1 and provider=$2 returning *`,[context.actor.tenantId,provider]);
      await db.query('update marketing_ops.ads_oauth_states set consumed_at=now() where tenant_id=$1 and provider=$2 and consumed_at is null',[context.actor.tenantId,provider]);
      await db.query(`update marketing_ops.ads_sync_jobs set status='cancelled',finished_at=now(),safe_error='connection_changed' where tenant_id=$1 and status='running' and link_id in(select id from marketing_ops.ads_links where provider=$2)`,[context.actor.tenantId,provider]);
      await writeAudit(db,context,'ads_integration',context.actor.tenantId,'ads.disconnected',null,{provider,generation:Number(updated.rows[0].generation)});
      return this.view(provider,updated.rows[0]);
    });
  }
  async externalCampaigns(context: CommandContext,provider: AdsProvider) {
    await this.actor(context,true); const snapshot = await this.snapshot(context,provider); if (!snapshot.account) throw appError('account_required',409,'Select an advertising account');
    const tokens = await this.refreshed(context,provider,snapshot); const campaigns=await snapshot.client.campaigns(tokens,snapshot.account);
    await this.actor(context,true);
    await this.transaction(context,async db=>{
      const current=await this.connection(db,provider);
      if(current.generation!==snapshot.row.generation || !current.tokens_cipher) throw appError('connection_changed',409,'Connection changed during campaign listing');
    });
    return campaigns;
  }
  async listLinks(context: CommandContext,campaignId: string): Promise<AdsLinkView[]> {
    await this.actor(context); return this.transaction(context,async db => { await campaign(db,campaignId); const result = await db.query('select * from marketing_ops.ads_links where campaign_id=$1 order by created_at,id',[campaignId]); return result.rows.map(viewLink); });
  }
  async createLink(context: CommandContext,campaignId: string,input: unknown,key: string): Promise<AdsLinkView> {
    await this.actor(context,true); const parsed = AdsLinkInputSchema.parse(input); const snapshot = await this.snapshot(context,parsed.provider); if (!snapshot.account) throw appError('account_required',409,'Select an advertising account');
    const tokens = await this.refreshed(context,parsed.provider,snapshot); const campaigns = await snapshot.client.campaigns(tokens,snapshot.account);
    if (!campaigns.some(campaign=>campaign.id===parsed.externalCampaignId)) throw appError('external_campaign_not_accessible',422,'Choose a campaign from the selected advertising account');
    try { return await this.transaction(context,async db => {
      await lockTenant(db,context); await campaign(db,campaignId,true);
      return executeIdempotentCommand(db,context,`ads.link.create:${campaignId}`,key,parsed,async () => {
        const source = await db.query('select * from marketing_ops.lead_sources where id=$1 and campaign_id=$2 for update',[parsed.sourceId,campaignId]); const row = source.rows[0];
        if (!row || !row.enabled) throw appError('source_disabled',409,'Choose an enabled source from this campaign');
        if (row.channel!==`${parsed.provider}_ads` || row.classification!=='lead' || (row.external_account_id && row.external_account_id!==snapshot.account!.id) || (row.external_campaign_id && row.external_campaign_id!==parsed.externalCampaignId)) throw appError('source_attribution_conflict',422,'Source attribution must match the selected provider account and campaign');
        const current = await this.connection(db,parsed.provider,true); if (current.generation!==snapshot.row.generation || current.selected_account_id!==snapshot.account!.id || !current.tokens_cipher) throw appError('connection_changed',409,'Connection changed while linking');
        const result = await db.query(`insert into marketing_ops.ads_links(id,tenant_id,campaign_id,provider,source_id,external_account_id,external_campaign_id,destination,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[randomUUID(),context.actor.tenantId,campaignId,parsed.provider,parsed.sourceId,snapshot.account!.id,parsed.externalCampaignId,parsed.destination,context.actor.userId]);
        const link = viewLink(result.rows[0]); await writeAudit(db,context,'campaign',campaignId,'ads.link.created',null,link); return link;
      });
    }); } catch (error) { if ((error as {code?:string}).code==='23505') throw appError('ads_link_conflict',409,'This advertisement or source already has an active campaign link'); throw error; }
  }
  async disableLink(context: CommandContext,campaignId: string,linkId: string,expected: number,key: string): Promise<AdsLinkView> {
    await this.actor(context,true); return this.transaction(context,async db => {
      await lockTenant(db,context); await campaign(db,campaignId,true);
      return executeIdempotentCommand(db,context,`ads.link.disable:${linkId}`,key,{expected},async()=>{
        const found = await db.query('select * from marketing_ops.ads_links where id=$1 and campaign_id=$2 for update',[linkId,campaignId]); if (!found.rows[0]) throw appError('not_found',404,'Advertisement link not found'); checkVersion(found.rows[0],expected);
        const updated = await db.query('update marketing_ops.ads_links set enabled=false,version=version+1 where id=$1 returning *',[linkId]);
        await db.query("update marketing_ops.ads_sync_jobs set status='cancelled',finished_at=now(),safe_error='connection_changed' where link_id=$1 and status='running'",[linkId]); return viewLink(updated.rows[0]);
      });
    });
  }
  async results(context: CommandContext,campaignId: string,linkId: string): Promise<{ daily: AdsDailyMetric[]; receipts: AdsSyncReceipt[] }> {
    await this.actor(context); return this.transaction(context,async db => {
      await campaign(db,campaignId); const link = await db.query('select id from marketing_ops.ads_links where id=$1 and campaign_id=$2',[linkId,campaignId]); if (!link.rows[0]) throw appError('not_found',404,'Advertisement link not found');
      const daily = await db.query('select * from marketing_ops.ads_daily_metrics where link_id=$1 and active order by day',[linkId]);
      const jobs = await db.query('select receipt from marketing_ops.ads_sync_jobs where link_id=$1 and receipt is not null order by created_at desc limit 20',[linkId]);
      return { daily: daily.rows.map(row=>({date:day(row.day),currency:row.currency,timeZone:row.time_zone,spend:Number(row.spend),impressions:Number(row.impressions),clicks:Number(row.clicks),conversions:row.conversions===null?null:Number(row.conversions)})),receipts:jobs.rows.map(row=>row.receipt) };
    });
  }
  async sync(context: CommandContext,campaignId: string,linkId: string,input: unknown,key: string): Promise<AdsSyncReceipt> {
    await this.actor(context,true); const period = AdsPeriodSchema.parse(input); const requestHash = hashCanonicalPayload(period); const attempt = randomUUID();
    const reserved = await this.transaction<Reservation|{receipt:AdsSyncReceipt}>(context,async db => {
      await lockTenant(db,context); await campaign(db,campaignId,true);
      const found = await db.query('select * from marketing_ops.ads_links where id=$1 and campaign_id=$2 for update',[linkId,campaignId]); const link = found.rows[0]; if (!link) throw appError('not_found',404,'Advertisement link not found');
      const existing = await db.query('select * from marketing_ops.ads_sync_jobs where tenant_id=$1 and actor_id=$2 and link_id=$3 and idempotency_key=$4 for update',[context.actor.tenantId,context.actor.userId,linkId,key]); const previous = existing.rows[0];
      if (previous && previous.request_hash!==requestHash) throw appError('idempotency_conflict',409,'Sync key already used with another period'); if (previous?.receipt) return {receipt:previous.receipt as AdsSyncReceipt};
      if (previous?.status==='running' && Date.parse(previous.lease_until)>Date.now()) throw appError('idempotency_in_progress',409,'Synchronization is already running');
      const running=await db.query("select id from marketing_ops.ads_sync_jobs where link_id=$1 and status='running' and lease_until>now() and id is distinct from $2::uuid",[linkId,previous?.id??null]);
      if(running.rows.length)throw appError('sync_in_progress',409,'Another synchronization is already reading this advertisement');
      if (!link.enabled) throw appError('ads_link_disabled',409,'Advertisement link is disabled');
      const source = await db.query('select * from marketing_ops.lead_sources where id=$1 for update',[link.source_id]); if (!source.rows[0]?.enabled) throw appError('source_disabled',409,'Lead source is disabled');
      const attribution=source.rows[0];
      if(attribution.channel!==`${link.provider}_ads` || attribution.classification!=='lead' || (attribution.external_account_id && attribution.external_account_id!==link.external_account_id) || (attribution.external_campaign_id && attribution.external_campaign_id!==link.external_campaign_id))throw appError('source_attribution_conflict',409,'Source attribution no longer matches the linked advertisement');
      const connection = await this.connection(db,link.provider,true); if (!connection.tokens_cipher || !['connected','partial'].includes(connection.status) || connection.selected_account_id!==link.external_account_id) throw appError('integration_not_connected',409,'Connect the linked advertising account');
      const job = previous ? await db.query("update marketing_ops.ads_sync_jobs set status='running',attempt=$2,generation=$3,lease_until=now()+interval '5 minutes',safe_error=null,finished_at=null where id=$1 returning id",[previous.id,attempt,connection.generation]) : await db.query('insert into marketing_ops.ads_sync_jobs(tenant_id,campaign_id,link_id,actor_id,idempotency_key,request_hash,generation,attempt) values($1,$2,$3,$4,$5,$6,$7,$8) returning id',[context.actor.tenantId,campaignId,linkId,context.actor.userId,key,requestHash,connection.generation,attempt]);
      return {link,connection,sourceVersion:Number(source.rows[0].version),jobId:job.rows[0]!.id as string};
    }); if ('receipt' in reserved) return reserved.receipt;
    const {link,connection,sourceVersion,jobId} = reserved; const provider = link.provider as AdsProvider;
    let metricsPermissionDenied=false;
    try {
      const snapshot = await this.snapshot(context,provider); if (snapshot.row.generation!==connection.generation || !snapshot.account) throw appError('connection_changed',409,'Connection changed before sync');
      const tokens = await this.refreshed(context,provider,snapshot); const client = snapshot.client;
      const warnings:string[]=[];let metrics:AdsDailyMetric[]=[];let metricsKnown=false;let nativeKnown=false;
      if(snapshot.row.capabilities.metrics){
        try {metrics=(await client.dailyMetrics(tokens,snapshot.account,link.external_campaign_id,period.from,period.to)).map(row=>AdsDailySchema.parse(row));metricsKnown=true;}
        catch(error){metricsPermissionDenied=safeError(error)==='ads_permission_required';if(metricsPermissionDenied&&link.destination==='native_form')warnings.push('metrics_permission_required');else throw error;}
      }else warnings.push('metrics_permission_required');
      if (metrics.some(row=>row.date<period.from || row.date>period.to || row.currency!==snapshot.account!.currency) || new Set(metrics.map(row=>row.date)).size!==metrics.length || metrics.length>30) throw appError('ads_invalid_response',502,'Provider metric dates or currency are incompatible');
      let leads: AdsLead[] = [];
      if (link.destination==='native_form') {
        if(snapshot.row.capabilities.nativeLeads){
          try {
            leads=await client.leads(tokens,snapshot.account,link.external_campaign_id,period.from,period.to);
            if(leads.length>5000)throw appError('ads_page_limit',422,'Reduce the sync period to review at most 5000 native leads');
            if(leads.some(lead=>lead.externalCampaignId!==link.external_campaign_id||Date.parse(lead.occurredAt)<Date.parse(period.from)-86400000||Date.parse(lead.occurredAt)>=Date.parse(period.to)+2*86400000))throw appError('ads_invalid_response',502,'Provider returned incompatible lead attribution');
            nativeKnown=true;
          }catch(error){leads=[];const code=safeError(error);warnings.push(code==='ads_permission_required'?'native_leads_permission_required':code);}
        }else warnings.push('native_leads_permission_required');
      }
      await this.actor(context,true); const owner = await resolveActor(this.pool,connection.owner_id,context.actor.tenantId); if (!['admin','manager'].includes(owner.role)) throw appError('integration_owner_inactive',403,'Integration owner is no longer active');
      return await this.transaction(context,async db => {
        await lockTenant(db,context); await campaign(db,campaignId,true);
        const currentSource = await db.query('select * from marketing_ops.lead_sources where id=$1 for update',[link.source_id]);
        const currentLink = await db.query('select * from marketing_ops.ads_links where id=$1 for update',[linkId]); const current = await this.connection(db,provider,true); const job = await db.query('select * from marketing_ops.ads_sync_jobs where id=$1 for update',[jobId]);
        if (current.generation!==connection.generation || !current.tokens_cipher || !currentLink.rows[0]?.enabled || Number(currentLink.rows[0].version)!==Number(link.version) || !currentSource.rows[0]?.enabled || Number(currentSource.rows[0].version)!==sourceVersion || job.rows[0]?.status!=='running' || job.rows[0]?.attempt!==attempt || Date.parse(job.rows[0].lease_until)<=Date.now()) throw appError('connection_changed',409,'Connection or source changed during synchronization');
        await db.query("select set_config('app.ads_sync','true',true)"); let reports = 0; let overlap = false;
        if(metricsKnown){
          const dates=metrics.map(metric=>metric.date);
          const retired=await db.query('update marketing_ops.ads_daily_metrics set active=false,observed_at=now() where link_id=$1 and active and day between $2::date and $3::date and not(day=any($4::date[])) returning day',[linkId,period.from,period.to,dates]);
          const retiredReports=await db.query('update marketing_ops.result_reports set ads_active=false,version=version+1,updated_by=$5,updated_at=now() where ads_link_id=$1 and ads_active and period_from between $2::date and $3::date and not(period_from=any($4::date[])) returning *',[linkId,period.from,period.to,dates,context.actor.userId]);
          for(const row of retiredReports.rows){const report=mapResultReport(row);await db.query('insert into marketing_ops.result_report_revisions(tenant_id,campaign_id,report_id,version,snapshot,actor_id) values($1,$2,$3,$4,$5::jsonb,$6)',[context.actor.tenantId,campaignId,report.id,report.version,JSON.stringify({...report,adsLinkId:linkId,adsActive:false}),context.actor.userId]);}
          if(retired.rows.length||retiredReports.rows.length)warnings.push('missing_days_retired');
        }
        for (const metric of metrics) {
          await db.query(`insert into marketing_ops.ads_daily_metrics(tenant_id,campaign_id,link_id,day,currency,time_zone,spend,impressions,clicks,conversions) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            on conflict(link_id,day) do update set currency=excluded.currency,time_zone=excluded.time_zone,spend=excluded.spend,impressions=excluded.impressions,clicks=excluded.clicks,conversions=excluded.conversions,active=true,observed_at=now()`,[context.actor.tenantId,campaignId,linkId,metric.date,metric.currency,metric.timeZone,metric.spend,metric.impressions,metric.clicks,metric.conversions]);
          if (metric.currency!=='BRL') { if (!warnings.includes('foreign_currency_excluded')) warnings.push('foreign_currency_excluded'); continue; }
          const conflicts = await db.query(`select id from marketing_ops.result_reports where ads_active and source_id=$1 and daterange(period_from,period_to,'[]') @> $2::date and ads_link_id is distinct from $3::uuid`,[link.source_id,metric.date,linkId]); if (conflicts.rows.length) { overlap=true; continue; }
          const existing = await db.query('select * from marketing_ops.result_reports where ads_link_id=$1 and period_from=$2 for update',[linkId,metric.date]); const values = {spend:metric.spend,clicked:metric.clicks};
          if (existing.rows[0]?.ads_active && hashCanonicalPayload(existing.rows[0].metrics)===hashCanonicalPayload(values) && existing.rows[0].time_zone===metric.timeZone) { reports++; continue; }
          const updated = existing.rows[0] ? await db.query(`update marketing_ops.result_reports set metrics=$2::jsonb,time_zone=$3,ads_active=true,version=version+1,updated_by=$4,updated_at=now() where id=$1 returning *`,[existing.rows[0].id,JSON.stringify(values),metric.timeZone,context.actor.userId]) : await db.query(`insert into marketing_ops.result_reports(tenant_id,campaign_id,source_id,period_from,period_to,time_zone,metrics,notes,ads_link_id,created_by,updated_by) values($1,$2,$3,$4,$4,$5,$6::jsonb,$7,$8,$9,$9) returning *`,[context.actor.tenantId,campaignId,link.source_id,metric.date,metric.timeZone,JSON.stringify(values),'Resultados diários sincronizados; conversões do provedor não representam vendas.',linkId,context.actor.userId]);
          const report = mapResultReport(updated.rows[0]); await db.query('insert into marketing_ops.result_report_revisions(tenant_id,campaign_id,report_id,version,snapshot,actor_id) values($1,$2,$3,$4,$5::jsonb,$6)',[context.actor.tenantId,campaignId,report.id,report.version,JSON.stringify({...report,adsLinkId:linkId}),context.actor.userId]); reports++;
        }
        if (overlap) warnings.push('manual_report_overlap');
        const previewIds:string[]=[];
        const ordered=[...leads].sort((a,b)=>a.externalId.localeCompare(b.externalId));
        for(let offset=0;offset<ordered.length;offset+=500){const previewId=await this.leadPreview(db,context,link,currentSource.rows[0]!,ordered.slice(offset,offset+500));if(previewId)previewIds.push(previewId);}
        const needsReview=warnings.some(warning=>warning!=='foreign_currency_excluded');
        const receipt: AdsSyncReceipt = {id:jobId,status:needsReview?'needs_review':'completed',days:metrics.length,reports,previewId:previewIds[0]??null,previewIds,warnings:[...new Set(warnings)],completedAt:new Date().toISOString()};
        const measured=metricsKnown||nativeKnown;
        await db.query('update marketing_ops.ads_links set last_sync_at=case when $4 then now() else last_sync_at end,safe_error=$2,next_sync_at=now()+($3::bigint*interval \'1 millisecond\') where id=$1',[linkId,warnings.find(warning=>warning!=='foreign_currency_excluded')??null,this.config.syncIntervalMs,measured]);
        const capabilities:AdsConnectionView['capabilities']={...current.capabilities};
        if(warnings.includes('native_leads_permission_required'))capabilities.nativeLeads=false;
        if(metricsPermissionDenied)capabilities.metrics=false;
        const status=warnings.includes('ads_reconnect_required')||current.status==='reconnect_required'?'reconnect_required':capabilityStatus(capabilities);
        await db.query(`update marketing_ops.ads_connections set last_sync_at=case when $6 then now() else last_sync_at end,safe_error=$3,status=$4,capabilities=$5::jsonb,version=version+1 where tenant_id=$1 and provider=$2`,[context.actor.tenantId,provider,warnings.includes('ads_reconnect_required')?'ads_reconnect_required':null,status,JSON.stringify(capabilities),measured]);
        await db.query('update marketing_ops.ads_sync_jobs set status=$2,receipt=$3::jsonb,finished_at=now() where id=$1',[jobId,receipt.status,JSON.stringify(receipt)]);
        await writeAudit(db,context,'campaign',campaignId,'ads.sync.completed',null,{linkId,receipt}); return receipt;
      });
    } catch (error) {
      const code = ['connection_changed','integration_owner_inactive','source_disabled'].includes((error as {code?:string}).code??'') ? (error as {code:string}).code : safeError(error);
      await this.transaction(context,async db=>{
        await lockTenant(db,context); await db.query("update marketing_ops.ads_sync_jobs set status=case when $3='connection_changed' then 'cancelled' else 'error' end,safe_error=$3,finished_at=now() where id=$1 and attempt=$2 and status='running'",[jobId,attempt,code]);
        if(code!=='connection_changed') await db.query('update marketing_ops.ads_links link set safe_error=$2,next_sync_at=now()+($3::bigint*interval \'1 millisecond\') from marketing_ops.ads_connections connection where link.id=$1 and connection.tenant_id=link.tenant_id and connection.provider=link.provider and connection.generation=$4',[linkId,code,this.config.syncIntervalMs,connection.generation]);
        const transient=['ads_provider_unavailable','ads_provider_error','ads_rate_limited'].includes(code);
        if (code!=='connection_changed') await db.query(`update marketing_ops.ads_connections set safe_error=$4,status=$5,version=version+1 where tenant_id=$1 and provider=$2 and generation=$3`,[context.actor.tenantId,provider,connection.generation,code,code==='ads_reconnect_required'?'reconnect_required':code==='ads_permission_required'?'partial':transient?connection.status:'error']);
        if(metricsPermissionDenied)await db.query("update marketing_ops.ads_connections set capabilities=jsonb_set(capabilities,'{metrics}','false'::jsonb) where tenant_id=$1 and provider=$2 and generation=$3",[context.actor.tenantId,provider,connection.generation]);
      }); if (code==='connection_changed'||code==='integration_owner_inactive') throw error; throw appError(code,502,'Advertising synchronization could not be completed');
    }
  }
  private async leadPreview(db: PoolClient,context: CommandContext,link: Row,source: Row,leads: AdsLead[]): Promise<string|null> {
    const rows: ImportReviewRow[] = []; const seen = new Set<string>();
    for (const [rowIndex,lead] of leads.entries()) {
      const parsed = LeadRowSchema.safeParse({externalId:`${link.provider}:${link.external_account_id}:${lead.externalId}`,name:lead.name,email:lead.email,phone:lead.phone,company:lead.company,occurredAt:lead.occurredAt,classification:'lead'});
      if (!parsed.success) { rows.push({rowIndex,status:'invalid',input:null,issues:parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`),candidates:[],contactId:null}); continue; }
      const receiptKey = leadReceiptKey(parsed.data);
      const duplicate = await db.query('select contact_id from marketing_ops.lead_receipts where source_id=$1 and receipt_key=$2',[source.id,receiptKey]);
      const contactId = duplicate.rows[0]?.contact_id ?? null;
      const candidates = contactId || seen.has(receiptKey) ? [] : (await db.query('select id,name,email,phone,company from marketing_ops.lead_contacts where (email=$1 and $1 is not null) or (phone=$2 and $2 is not null) order by created_at,id limit 20',[parsed.data.email??null,parsed.data.phone??null])).rows;
      rows.push({rowIndex,status:contactId||seen.has(receiptKey)?'duplicate':candidates.length?'possible_duplicate':'new',input:parsed.data,issues:[],candidates,contactId}); seen.add(receiptKey);
    }
    if(rows.every(row=>row.status==='duplicate'))return null;
    const pending=await db.query('select id from marketing_ops.lead_import_previews where source_id=$1 and actor_id=$2 and source_version=$3 and confirmed_at is null and expires_at>now() and rows=$4::jsonb order by created_at desc limit 1',[source.id,context.actor.userId,source.version,JSON.stringify(rows)]);
    if(pending.rows[0])return pending.rows[0].id;
    const id = randomUUID(); await db.query('insert into marketing_ops.lead_import_previews(id,tenant_id,campaign_id,source_id,actor_id,source_version,rows) values($1,$2,$3,$4,$5,$6,$7::jsonb)',[id,context.actor.tenantId,link.campaign_id,source.id,context.actor.userId,source.version,JSON.stringify(rows)]); return id;
  }
  async syncDue(): Promise<number> {
    const due = await this.pool.query('select * from marketing_ops_private.ads_due_links(10)'); let completed = 0;
    for (const row of due.rows) {
      try { const actor = await resolveActor(this.pool,row.owner_id,row.tenant_id); if (!['manager','admin'].includes(actor.role)) continue;
        const context: CommandContext = {pool:this.pool,actor,origin:'internal',correlationId:randomUUID()}; const bucket = Math.floor(Date.now()/this.config.syncIntervalMs);
        await this.sync(context,row.campaign_id,row.link_id,adsSyncPeriod(row.time_zone??'UTC'),`scheduled:${bucket}:${row.link_id}`); completed++;
      } catch { /* Persisted safe job errors suffice; never log provider secrets. */ }
    } return completed;
  }
}
