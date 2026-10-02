import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { resolveActor } from '../auth/actor.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import { Ga4Client, ClarityClient } from '../integrations/analytics/providers.js';
import type { AnalyticsProvider, AnalyticsResource, AnalyticsConnection, AnalyticsLink, AnalyticsResults, AnalyticsTotals, AnalyticsBatch, AnalyticsChannel, AnalyticsSyncReceipt, Ga4ProviderClient, ClarityProviderClient } from '../integrations/analytics/types.js';
import type { AdsProviderConfig, AdsTokens } from '../integrations/ads/types.js';
import type { AdsIntegrationService } from './ads.js';
import type { CommandContext } from './context.js';
import { sealAdsSecret, openAdsSecret } from './adsCrypto.js';
import { hashCanonicalPayload } from './hash.js';
import { writeAudit } from './audit.js';
import { AnalyticsLinkSchema, AnalyticsResultsSchema, AnalyticsResourceSchema, ClarityConnectSchema, analyticsPeriod } from './webAnalyticsContracts.js';
type Row = Record<string, any>;
type Runtime = Awaited<ReturnType<AdsIntegrationService['analyticsRuntime']>>;
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const iso = (v: unknown) => v ? new Date(v as string).toISOString() : null;
const safe = (e: unknown) => ['analytics_api_disabled', 'analytics_permission_required', 'analytics_reconnect_required', 'analytics_rate_limited', 'analytics_invalid_response', 'analytics_page_limit', 'analytics_connection_changed', 'analytics_provider_unavailable'].includes((e as {
    code?: string;
})?.code ?? '') ? (e as {
    code: string;
}).code : 'analytics_provider_unavailable';
const binding = (context: CommandContext, provider: AnalyticsProvider, generation: number | string, purpose: string) => `${context.actor.tenantId}:web-analytics:${provider}:${generation}:${purpose}`;
const view = (provider: AnalyticsProvider, row?: Row, prepared = true): AnalyticsConnection => ({ provider, status: row?.status ?? (prepared ? 'prepared' : 'unprepared'), version: Number(row?.version ?? 0), resources: row?.resources ?? [], selectedResourceId: row?.selected_resource_id ?? null, lastSyncAt: iso(row?.last_sync_at), safeError: row?.safe_error ?? null });
const linkView = (r: Row): AnalyticsLink => ({ id: r.id, campaignId: r.campaign_id, provider: r.provider, resourceId: r.resource_id, utmCampaign: r.utm_campaign, enabled: r.enabled, version: Number(r.version) });
function version(r: Row | undefined, v: number) {
    if (Number(r?.version ?? 0) !== v)
        throw appError('version_conflict', 409, 'Observed version is stale', { currentVersion: Number(r?.version ?? 0) });
}
function qualityStatus(batch: AnalyticsBatch): 'partial' | 'completed' {
    return batch.warnings.some(w => ['analytics_thresholded', 'analytics_sampled', 'analytics_other_row', 'analytics_clarity_row_limit'].includes(w)) ? 'partial' : 'completed';
}
const organicGroups = new Set(['Organic Search', 'Organic Social', 'Organic Video', 'Organic Shopping']);
function measuredChannels(batch: AnalyticsBatch, from: string, to: string) {
    return batch.channelMetricsVersion === 1 && Array.isArray(batch.channels) && batch.channels.every(c =>
        typeof c.channelGroup === 'string' && typeof c.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.date >= from && c.date <= to &&
        [c.sessions, c.engagedSessions, c.pageViews, c.keyEvents].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0));
}
function requireSession(session: string) {
    if (!/^[a-f0-9]{64}$/.test(session))
        throw appError('oauth_session_required', 400, 'An internal session binding is required');
}
interface Clients {
    ga4?: (settings: AdsProviderConfig) => Ga4ProviderClient;
    clarity?: ClarityProviderClient;
}
export class WebAnalyticsService {
    constructor(readonly pool: Pool, private ads: AdsIntegrationService, private clients: Clients = {}) {
    }
    private async actor(context: CommandContext, admin = false) {
        const actor = await resolveActor(this.pool, context.actor.userId, context.actor.tenantId);
        if (actor.role !== context.actor.role || !['admin', 'manager'].includes(actor.role) || (admin && actor.role !== 'admin'))
            throw appError('forbidden', 403, 'Current installation authority is required');
    }
    private async runtime(context: CommandContext) {
        await this.actor(context);
        return this.ads.analyticsRuntime(context);
    }
    private ga4(runtime: Runtime): Ga4ProviderClient {
        if (!runtime.google)
            throw appError('integration_unprepared', 409, 'Prepare the company Google application first');
        return (this.clients.ga4 ?? (settings => new Ga4Client(settings)))(runtime.google);
    }
    private async tx<T>(context: CommandContext, runtime: Runtime, work: (db: PoolClient) => Promise<T>): Promise<T> {
        await this.actor(context);
        return withActorTransaction(this.pool, context.actor, context.correlationId, async (db) => {
            await db.query("select pg_advisory_xact_lock(hashtextextended('ads-installation-setup',0))");
            await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`web-analytics:${context.actor.tenantId}`]);
            const publication = await db.query("select version from marketing_ops_private.ads_setup_publications where provider='google'");
            if (runtime.version.startsWith('managed:') && `managed:${publication.rows[0]?.version}` !== runtime.version || publication.rows[0] && !runtime.version.startsWith('managed:'))
                throw appError('analytics_connection_changed', 409, 'Google application changed');
            return work(db);
        });
    }
    private async connection(db: PoolClient, context: CommandContext, provider: AnalyticsProvider) {
        return (await db.query('select * from marketing_ops.web_analytics_connections where tenant_id=$1 and provider=$2 for update', [context.actor.tenantId, provider])).rows[0] as Row | undefined;
    }
    private async invalidate(db: PoolClient, context: CommandContext, provider: AnalyticsProvider) {
        if (provider === 'ga4')
            await db.query('update marketing_ops.web_analytics_oauth_states set consumed_at=now() where tenant_id=$1 and consumed_at is null', [context.actor.tenantId]);
        await db.query("update marketing_ops.web_analytics_jobs set status='cancelled',safe_error='analytics_connection_changed' where tenant_id=$1 and provider=$2 and status='running'", [context.actor.tenantId, provider]);
    }
    private token(runtime: Runtime, context: CommandContext, row: Row): AdsTokens | string {
        return openAdsSecret(runtime.key, binding(context, row.provider, row.generation, 'tokens'), row.tokens_cipher);
    }
    private async snapshot(context: CommandContext, provider: AnalyticsProvider, runtime: Runtime) {
        return this.tx(context, runtime, async (db) => {
            const row = await this.connection(db, context, provider);
            if (!row?.tokens_cipher)
                throw appError('analytics_reconnect_required', 409, 'Analytics authorization must be renewed');
            if (provider === 'ga4' && row.config_version !== runtime.version)
                throw appError('analytics_connection_changed', 409, 'Google application changed');
            return { row, token: this.token(runtime, context, row) };
        });
    }
    private async persistFailure(context: CommandContext, runtime: Runtime, provider: AnalyticsProvider, generation: unknown, error: unknown) {
        try {
            await this.tx(context, runtime, async (db) => {
                const code = safe(error);
                await db.query("update marketing_ops.web_analytics_connections set safe_error=$4,status=case when $4='analytics_reconnect_required' then 'reconnect_required' when $4='analytics_permission_required' then 'error' else status end,next_sync_at=now()+interval '8 hours' where tenant_id=$1 and provider=$2 and generation=$3", [context.actor.tenantId, provider, generation, code]);
            });
        }
        catch { /* replacement/revocation wins */
        }
    }
    async list(context: CommandContext): Promise<AnalyticsConnection[]> {
        const runtime = await this.runtime(context);
        return this.tx(context, runtime, async (db) => {
            const rows = await db.query('select * from marketing_ops.web_analytics_connections where tenant_id=$1', [context.actor.tenantId]);
            return (['ga4', 'clarity'] as const).map(provider => {
                const row = rows.rows.find(r => r.provider === provider);
                return view(provider, row, provider === 'clarity' || !!runtime.google);
            });
        });
    }
    async authorize(context: CommandContext, session: string): Promise<{
        authorizationUrl: string;
    }> {
        requireSession(session);
        const runtime = await this.runtime(context);
        const client = this.ga4(runtime);
        const state = randomBytes(32).toString('base64url');
        const verifier = randomBytes(32).toString('base64url');
        await this.tx(context, runtime, async (db) => {
            await this.invalidate(db, context, 'ga4');
            const row = (await db.query("insert into marketing_ops.web_analytics_connections(tenant_id,provider,owner_id,config_version) values($1,'ga4',$2,$3) on conflict(tenant_id,provider) do update set owner_id=excluded.owner_id,config_version=excluded.config_version,generation=web_analytics_connections.generation+1,version=web_analytics_connections.version+1,status='prepared',tokens_cipher=null,resources='[]',selected_resource_id=null,safe_error=null returning *", [context.actor.tenantId, context.actor.userId, runtime.version])).rows[0]!;
            await db.query('insert into marketing_ops.web_analytics_oauth_states(state_hash,tenant_id,actor_id,session_hash,generation,config_version,verifier_cipher) values($1,$2,$3,$4,$5,$6,$7)', [digest(state), context.actor.tenantId, context.actor.userId, digest(session), row.generation, runtime.version, sealAdsSecret(runtime.key, binding(context, 'ga4', row.generation, 'verifier'), verifier)]);
        });
        return { authorizationUrl: client.authorizationUrl(state, verifier) };
    }
    async ownsState(context: CommandContext, session: string, state: string): Promise<boolean> {
        requireSession(session);
        const runtime = await this.runtime(context);
        return this.tx(context, runtime, async (db) => {
            const row = (await db.query('select state_hash from marketing_ops.web_analytics_oauth_states where state_hash=$1 and tenant_id=$2 and actor_id=$3 and session_hash=$4', [digest(state), context.actor.tenantId, context.actor.userId, digest(session)])).rows[0];
            return !!row;
        });
    }
    async callback(context: CommandContext, session: string, input: {
        state: string;
        code?: string | undefined;
        error?: string | undefined;
    }): Promise<{
        provider: 'ga4';
    }> {
        requireSession(session);
        const runtime = await this.runtime(context);
        const client = this.ga4(runtime);
        const reserved = await this.tx(context, runtime, async (db) => {
            const state = (await db.query('select * from marketing_ops.web_analytics_oauth_states where state_hash=$1 and tenant_id=$2 and actor_id=$3 and session_hash=$4 for update', [digest(input.state), context.actor.tenantId, context.actor.userId, digest(session)])).rows[0];
            const row = await this.connection(db, context, 'ga4');
            if (!state || state.consumed_at || new Date(state.expires_at).getTime() <= Date.now() || state.generation !== row?.generation || state.config_version !== runtime.version)
                throw appError('oauth_state_invalid', 400, 'OAuth state is invalid');
            await db.query('update marketing_ops.web_analytics_oauth_states set consumed_at=now() where state_hash=$1', [state.state_hash]);
            return { generation: row!.generation, verifier: openAdsSecret<string>(runtime.key, binding(context, 'ga4', row!.generation, 'verifier'), state.verifier_cipher) };
        });
        try {
            if (input.error || !input.code)
                throw appError('analytics_permission_required', 403, 'Analytics permission is required');
            const deadline=AbortSignal.timeout(100000);
            const tokens = await client.exchange(input.code, reserved.verifier,deadline);
            const resources = await client.resources(tokens,deadline);
            await this.tx(context, runtime, async (db) => {
                const row = await this.connection(db, context, 'ga4');
                if (row?.generation !== reserved.generation)
                    throw appError('analytics_connection_changed', 409, 'Analytics connection changed');
                await db.query("update marketing_ops.web_analytics_connections set status='pending_resource',resources=$3::jsonb,tokens_cipher=$4,safe_error=null,version=version+1 where tenant_id=$1 and provider='ga4' and generation=$2", [context.actor.tenantId, reserved.generation, JSON.stringify(resources), sealAdsSecret(runtime.key, binding(context, 'ga4', reserved.generation, 'tokens'), tokens)]);
            });
            return { provider: 'ga4' };
        }
        catch (e) {
            await this.persistFailure(context, runtime, 'ga4', reserved.generation, e);
            throw appError(safe(e), (e as {
                status?: number;
            }).status ?? 502, 'Analytics authorization could not be completed');
        }
    }
    async resources(context: CommandContext): Promise<AnalyticsResource[]> {
        const runtime = await this.runtime(context);
        const { row, token } = await this.snapshot(context, 'ga4', runtime);
        try {
            const deadline=AbortSignal.timeout(100000);
            const tokens = await this.ga4(runtime).refresh(token as AdsTokens,deadline);
            const resources = await this.ga4(runtime).resources(tokens,deadline);
            await this.tx(context, runtime, async (db) => {
                const current = await this.connection(db, context, 'ga4');
                if (current?.generation !== row.generation)
                    throw appError('analytics_connection_changed', 409, 'Analytics connection changed');
                await db.query('update marketing_ops.web_analytics_connections set resources=$3::jsonb,tokens_cipher=$4 where tenant_id=$1 and provider=$2', [context.actor.tenantId, 'ga4', JSON.stringify(resources), sealAdsSecret(runtime.key, binding(context, 'ga4', row.generation, 'tokens'), tokens)]);
            });
            return resources;
        }
        catch (e) {
            await this.persistFailure(context, runtime, 'ga4', row.generation, e);
            throw appError(safe(e), (e as {
                status?: number;
            }).status ?? 502, 'Analytics resources could not be read');
        }
    }
    async selectResource(context: CommandContext, expected: number, input: unknown): Promise<AnalyticsConnection> {
        const value = AnalyticsResourceSchema.parse(input);
        const runtime = await this.runtime(context);
        const { row, token } = await this.snapshot(context, 'ga4', runtime);
        version(row, expected);
        if (row.selected_resource_id && row.selected_resource_id !== value.resourceId && !value.confirmReplacement)
            throw appError('analytics_confirmation_required', 409, 'Confirm property replacement');
        const client = this.ga4(runtime);
        const deadline=AbortSignal.timeout(100000);
        const tokens = await client.refresh(token as AdsTokens,deadline);
        const resources = await client.resources(tokens,deadline);
        if (!resources.some(r => r.id === value.resourceId))
            throw appError('analytics_resource_unavailable', 422, 'This property is not accessible');
        return this.tx(context, runtime, async (db) => {
            const current = await this.connection(db, context, 'ga4');
            version(current, expected);
            if (current?.generation !== row.generation)
                throw appError('analytics_connection_changed', 409, 'Analytics connection changed');
            await this.invalidate(db, context, 'ga4');
            const generation = Number(row.generation) + 1;
            const result = (await db.query("update marketing_ops.web_analytics_connections set resources=$3::jsonb,selected_resource_id=$4,generation=$5,version=version+1,tokens_cipher=$6,status='connected',safe_error=null,last_sync_at=null,next_sync_at=now() where tenant_id=$1 and provider=$2 returning *", [context.actor.tenantId, 'ga4', JSON.stringify(resources), value.resourceId, generation, sealAdsSecret(runtime.key, binding(context, 'ga4', generation, 'tokens'), tokens)])).rows[0]!;
            await writeAudit(db, context, 'web_analytics', context.actor.tenantId, 'analytics.property_selected', view('ga4', current), view('ga4', result));
            return view('ga4', result);
        });
    }
    private async reserveQuota(context: CommandContext, runtime: Runtime, calls: number) {
        await this.tx(context, runtime, async (db) => {
            await db.query('insert into marketing_ops.web_analytics_quota(tenant_id) values($1) on conflict do nothing', [context.actor.tenantId]);
            const result = await db.query("update marketing_ops.web_analytics_quota set used=used+$2 where tenant_id=$1 and day=(now() at time zone 'UTC')::date and used+$2<=10 returning used", [context.actor.tenantId, calls]);
            if (!result.rows[0])
                throw appError('analytics_rate_limited', 429, 'Clarity daily request quota is exhausted');
        });
    }
    private async receipt(db: PoolClient, context: CommandContext, operation: string, key: string, hash: string) {
        const row = (await db.query('select * from marketing_ops.web_analytics_receipts where tenant_id=$1 and actor_id=$2 and operation=$3 and idempotency_key=$4', [context.actor.tenantId, context.actor.userId, operation, key])).rows[0];
        if (row && row.request_hash !== hash)
            throw appError('idempotency_conflict', 409, 'Command key was used with another payload');
        return row?.response;
    }
    private async saveReceipt(db: PoolClient, context: CommandContext, operation: string, key: string, hash: string, response: unknown) {
        await db.query('insert into marketing_ops.web_analytics_receipts(tenant_id,actor_id,operation,idempotency_key,request_hash,response) values($1,$2,$3,$4,$5,$6::jsonb)', [context.actor.tenantId, context.actor.userId, operation, key, hash, JSON.stringify(response)]);
    }
    async connectClarity(context: CommandContext, expected: number, input: unknown, key: string): Promise<AnalyticsConnection> {
        await this.actor(context, true);
        const value = ClarityConnectSchema.parse(input);
        const runtime = await this.runtime(context);
        const hash = hashCanonicalPayload({ expected, ...value, token: digest(value.token) });
        const previous = await this.tx(context, runtime, async (db) => {
            const cached = await this.receipt(db, context, 'clarity.connect', key, hash);
            if (cached)
                return { cached, row: null };
            const row = await this.connection(db, context, 'clarity');
            version(row, expected);
            if (row?.tokens_cipher && !value.confirmReplacement)
                throw appError('analytics_confirmation_required', 409, 'Confirm Clarity token replacement');
            return { cached: null, row };
        });
        if (previous.cached)
            return previous.cached;
        const batch = await (this.clients.clarity ?? new ClarityClient()).report(value.token, calls => this.reserveQuota(context, runtime, calls));
        return this.tx(context, runtime, async (db) => {
            const cached = await this.receipt(db, context, 'clarity.connect', key, hash);
            if (cached)
                return cached;
            const row = await this.connection(db, context, 'clarity');
            version(row, expected);
            await this.invalidate(db, context, 'clarity');
            const generation = Number(row?.generation ?? 0) + 1;
            const resource: AnalyticsResource = { id: value.projectId, name: value.projectName, timeZone: 'UTC' };
            const result = (await db.query("insert into marketing_ops.web_analytics_connections(tenant_id,provider,owner_id,generation,version,tokens_cipher,resources,selected_resource_id,status,last_sync_at,next_sync_at) values($1,'clarity',$2,$3,$4,$5,$6::jsonb,$7,'connected',now(),now()+interval '8 hours') on conflict(tenant_id,provider) do update set owner_id=excluded.owner_id,generation=excluded.generation,version=excluded.version,tokens_cipher=excluded.tokens_cipher,resources=excluded.resources,selected_resource_id=excluded.selected_resource_id,status='connected',last_sync_at=now(),safe_error=null,next_sync_at=excluded.next_sync_at returning *", [context.actor.tenantId, context.actor.userId, generation, expected + 1, sealAdsSecret(runtime.key, binding(context, 'clarity', generation, 'tokens'), value.token), JSON.stringify([resource]), resource.id])).rows[0]!;
            await this.publishSnapshot(db, context, 'clarity', resource.id, generation, batch, batch.window!.from.slice(0, 10), batch.window!.to.slice(0, 10));
            const initialStatus = qualityStatus(batch) === 'partial' ? 'partial' : 'connected';
            await db.query('update marketing_ops.web_analytics_connections set status=$2 where tenant_id=$1 and provider=\'clarity\'', [context.actor.tenantId, initialStatus]);
            result.status = initialStatus;
            const response = view('clarity', result);
            await writeAudit(db, context, 'web_analytics', context.actor.tenantId, 'analytics.clarity_configured', row ? view('clarity', row) : null, response);
            await this.saveReceipt(db, context, 'clarity.connect', key, hash, response);
            return response;
        });
    }
    async disconnect(context: CommandContext, provider: AnalyticsProvider, expected: number): Promise<AnalyticsConnection> {
        const runtime = await this.runtime(context);
        return this.tx(context, runtime, async (db) => {
            const row = await this.connection(db, context, provider);
            version(row, expected);
            if (!row)
                throw appError('not_found', 404, 'Analytics connection not found');
            await this.invalidate(db, context, provider);
            const updated = (await db.query("update marketing_ops.web_analytics_connections set status='disconnected',generation=generation+1,version=version+1,tokens_cipher=null,selected_resource_id=null,resources='[]',safe_error=null where tenant_id=$1 and provider=$2 returning *", [context.actor.tenantId, provider])).rows[0]!;
            await writeAudit(db, context, 'web_analytics', context.actor.tenantId, 'analytics.disconnected', view(provider, row), view(provider, updated));
            return view(provider, updated);
        });
    }
    private async publishSnapshot(db: PoolClient, context: CommandContext, provider: AnalyticsProvider, resourceId: string, generation: number, batch: AnalyticsBatch, from: string, to: string) {
        await db.query('insert into marketing_ops.web_analytics_snapshots(tenant_id,provider,resource_id,generation,period_from,period_to,payload) values($1,$2,$3,$4,$5,$6,$7::jsonb)', [context.actor.tenantId, provider, resourceId, generation, from, to, JSON.stringify(batch)]);
    }
    async sync(context: CommandContext, provider: AnalyticsProvider, input: unknown, key: string): Promise<AnalyticsSyncReceipt> {
        const runtime = await this.runtime(context);
        const { row, token } = await this.snapshot(context, provider, runtime);
        const resource: AnalyticsResource | undefined = row.resources.find((r: AnalyticsResource) => r.id === row.selected_resource_id);
        if (!resource)
            throw appError('analytics_resource_required', 409, 'Choose an analytics resource first');
        const period = provider === 'clarity' ? analyticsPeriod({}, 'UTC') : analyticsPeriod(input, resource.timeZone);
        const hash = hashCanonicalPayload({ provider, resource: resource.id, input });
        const reserved = await this.tx(context, runtime, async (db) => {
            const current = await this.connection(db, context, provider);
            if (current?.generation !== row.generation)
                throw appError('analytics_connection_changed', 409, 'Analytics connection changed');
            const previous = (await db.query('select * from marketing_ops.web_analytics_jobs where tenant_id=$1 and provider=$2 and actor_id=$3 and idempotency_key=$4 for update', [context.actor.tenantId, provider, context.actor.userId, key])).rows[0];
            if (previous?.request_hash !== undefined && previous.request_hash !== hash)
                throw appError('idempotency_conflict', 409, 'Sync key was used with another payload');
            if (previous?.receipt)
                return { cached: previous.receipt, id: previous.id, attempt: previous.attempt };
            if (previous?.generation !== undefined && previous.generation !== row.generation)
                throw appError('analytics_connection_changed', 409, 'Analytics connection changed');
            const running = await db.query("select id from marketing_ops.web_analytics_jobs where tenant_id=$1 and provider=$2 and status='running' and lease_until>now()", [context.actor.tenantId, provider]);
            if (running.rows.length)
                throw appError('analytics_sync_in_progress', 409, 'Analytics synchronization is already running');
            const attempt = randomUUID();
            const job = previous ? (await db.query("update marketing_ops.web_analytics_jobs set status='running',attempt=$2,lease_until=now()+interval '5 minutes',safe_error=null where id=$1 returning *", [previous.id, attempt])).rows[0] : (await db.query('insert into marketing_ops.web_analytics_jobs(tenant_id,provider,actor_id,idempotency_key,request_hash,generation,attempt) values($1,$2,$3,$4,$5,$6,$7) returning *', [context.actor.tenantId, provider, context.actor.userId, key, hash, row.generation, attempt])).rows[0];
            return { cached: null, id: job.id, attempt };
        });
        if (reserved.cached)
            return reserved.cached;
        try {
            const deadline=AbortSignal.timeout(100000);
            const tokens = provider === 'ga4' ? await this.ga4(runtime).refresh(token as AdsTokens,deadline) : token;
            const batch = provider === 'ga4' ? await this.ga4(runtime).report(tokens as AdsTokens, resource.id, period.from, period.to,deadline) : await (this.clients.clarity ?? new ClarityClient()).report(token as string, calls => this.reserveQuota(context, runtime, calls));
            return await this.tx(context, runtime, async (db) => {
                const current = await this.connection(db, context, provider);
                const job = (await db.query('select * from marketing_ops.web_analytics_jobs where id=$1 for update', [reserved.id])).rows[0];
                if (current?.generation !== row.generation || job?.attempt !== reserved.attempt || job.status !== 'running' || new Date(job.lease_until).getTime() <= Date.now())
                    throw appError('analytics_connection_changed', 409, 'Analytics connection changed');
                await this.publishSnapshot(db, context, provider, resource.id, Number(row.generation), batch, provider === 'clarity' ? batch.window!.from.slice(0, 10) : period.from, provider === 'clarity' ? batch.window!.to.slice(0, 10) : period.to);
                const receipt: AnalyticsSyncReceipt = { id: reserved.id, status: qualityStatus(batch), completedAt: new Date().toISOString(), warnings: batch.warnings };
                await db.query('update marketing_ops.web_analytics_jobs set status=$2,receipt=$3::jsonb where id=$1', [reserved.id, receipt.status, JSON.stringify(receipt)]);
                await db.query('update marketing_ops.web_analytics_connections set tokens_cipher=$3,last_sync_at=now(),next_sync_at=now()+interval \'8 hours\',safe_error=null,status=$4 where tenant_id=$1 and provider=$2', [context.actor.tenantId, provider, sealAdsSecret(runtime.key, binding(context, provider, row.generation, 'tokens'), tokens), receipt.status === 'partial' ? 'partial' : 'connected']);
                return receipt;
            });
        }
        catch (e) {
            try {
                await this.tx(context, runtime, async (db) => {
                    const current=await this.connection(db,context,provider);
                    const job=(await db.query('select * from marketing_ops.web_analytics_jobs where id=$1 for update',[reserved.id])).rows[0];
                    // A late failure has no authority once another attempt owns
                    // the lease, completes the job or replaces the connection.
                    if(current?.generation!==row.generation||job?.attempt!==reserved.attempt||job.status!=='running'||new Date(job.lease_until).getTime()<=Date.now())return;
                    const code=safe(e);
                    if(code!=='analytics_connection_changed')await db.query("update marketing_ops.web_analytics_connections set safe_error=$4,status=case when $4='analytics_reconnect_required' then 'reconnect_required' when $4='analytics_permission_required' then 'error' else status end,next_sync_at=now()+interval '8 hours' where tenant_id=$1 and provider=$2 and generation=$3",[context.actor.tenantId,provider,row.generation,code]);
                    await db.query("update marketing_ops.web_analytics_jobs set status=$4,safe_error=$3 where id=$1 and attempt=$2 and status='running'", [reserved.id, reserved.attempt, code,code==='analytics_connection_changed'?'cancelled':'error']);
                });
            }
            catch {
            }
            throw appError(safe(e), (e as {
                status?: number;
            }).status ?? 502, 'Analytics synchronization could not be completed');
        }
    }
    private async campaign(db: PoolClient, id: string, edit = false) {
        const row = (await db.query('select id from marketing_ops.campaigns where id=$1 and marketing_ops_private.can_access_campaign(id)', [id])).rows[0];
        if (!row)
            throw appError('not_found', 404, 'Campaign not found');
        if (edit && !(await db.query('select marketing_ops_private.can_edit_campaign($1) allowed', [id])).rows[0]?.allowed)
            throw appError('forbidden', 403, 'Campaign mutation authority is required');
    }
    async listLinks(context: CommandContext, campaignId: string): Promise<AnalyticsLink[]> {
        const runtime = await this.runtime(context);
        return this.tx(context, runtime, async (db) => {
            await this.campaign(db, campaignId);
            return (await db.query('select * from marketing_ops.web_analytics_links where campaign_id=$1 order by provider,utm_campaign', [campaignId])).rows.map(linkView);
        });
    }
    async createLink(context: CommandContext, campaignId: string, input: unknown, key: string): Promise<AnalyticsLink> {
        const value = AnalyticsLinkSchema.parse(input);
        const runtime = await this.runtime(context);
        const hash = hashCanonicalPayload({ campaignId, ...value });
        return this.tx(context, runtime, async (db) => {
            await this.campaign(db, campaignId, true);
            const cached = await this.receipt(db, context, `link:${campaignId}`, key, hash);
            if (cached)
                return cached;
            const connection = await this.connection(db, context, value.provider);
            if (!connection?.selected_resource_id || !connection.tokens_cipher)
                throw appError('analytics_resource_required', 409, 'Connect and select an analytics resource first');
            const duplicate = (await db.query('select id from marketing_ops.web_analytics_links where tenant_id=$1 and provider=$2 and resource_id=$3 and utm_campaign=$4 and enabled', [context.actor.tenantId, value.provider, connection.selected_resource_id, value.utmCampaign])).rows[0];
            if (duplicate)
                throw appError('analytics_segment_already_linked', 409, 'This UTM segment already belongs to a campaign');
            const row = (await db.query('insert into marketing_ops.web_analytics_links(tenant_id,campaign_id,provider,resource_id,utm_campaign,created_by) values($1,$2,$3,$4,$5,$6) returning *', [context.actor.tenantId, campaignId, value.provider, connection.selected_resource_id, value.utmCampaign, context.actor.userId])).rows[0];
            const response = linkView(row);
            await writeAudit(db, context, 'web_analytics_link', row.id, 'analytics.utm_linked', null, response);
            await this.saveReceipt(db, context, `link:${campaignId}`, key, hash, response);
            return response;
        });
    }
    async disableLink(context: CommandContext, campaignId: string, linkId: string, expected: number): Promise<AnalyticsLink> {
        const runtime = await this.runtime(context);
        return this.tx(context, runtime, async (db) => {
            await this.campaign(db, campaignId, true);
            const row = (await db.query('select * from marketing_ops.web_analytics_links where id=$1 and campaign_id=$2 for update', [linkId, campaignId])).rows[0];
            if (!row)
                throw appError('not_found', 404, 'Analytics link not found');
            version(row, expected);
            return linkView((await db.query('update marketing_ops.web_analytics_links set enabled=false,version=version+1 where id=$1 returning *', [linkId])).rows[0]);
        });
    }
    async results(context: CommandContext, provider: AnalyticsProvider, input: unknown, utmCampaign?: string,expectedResourceId?:string): Promise<AnalyticsResults> {
        const { scope, ...periodInput } = AnalyticsResultsSchema.parse(input);
        if (scope && (provider !== 'ga4' || utmCampaign)) throw appError('validation_error', 400, 'Organic scope requires global GA4 results');
        const organic = scope === 'organic';
        const runtime = await this.runtime(context);
        return this.tx(context, runtime, async (db) => {
            const connection = await this.connection(db, context, provider);
            if(expectedResourceId&&connection?.selected_resource_id!==expectedResourceId)
                throw appError('analytics_connection_changed',409,'Analytics resource changed while reading campaign results');
            const resource: AnalyticsResource | null = connection?.resources.find((r: AnalyticsResource) => r.id === connection.selected_resource_id) ?? null;
            const period = provider === 'clarity' ? analyticsPeriod({}, 'UTC') : analyticsPeriod(periodInput, resource?.timeZone ?? 'UTC');
            const result: AnalyticsResults = { provider, resource, ...period, lastSyncAt: iso(connection?.last_sync_at), totals: null, daily: [], channels: [], campaigns: [], warnings: [], window: null, stale: !connection?.last_sync_at || Date.now() - new Date(connection.last_sync_at).getTime() > 12 * 3600000 || !!connection.safe_error };
            if (!resource)
                return result;
            const snapshots = (await db.query('select * from marketing_ops.web_analytics_snapshots where tenant_id=$1 and provider=$2 and resource_id=$3 and ($2=\'clarity\' or (period_from<=$5::date and period_to>=$4::date)) order by observed_at desc,id desc limit 200', [context.actor.tenantId, provider, resource.id, period.from, period.to])).rows;
            const channelMap = new Map<string, AnalyticsChannel>();
            const campaignMap = new Map<string, number>();
            const addChannel = (r: AnalyticsChannel) => {
                const key = JSON.stringify([r.source, r.medium, ...(organic ? [r.channelGroup] : [])]);
                const existing = channelMap.get(key);
                channelMap.set(key, { source: r.source, medium: r.medium, sessions: (existing?.sessions ?? 0) + r.sessions,
                    ...(organic ? { channelGroup: r.channelGroup, engagedSessions: (existing?.engagedSessions ?? 0) + r.engagedSessions!, pageViews: (existing?.pageViews ?? 0) + r.pageViews!, keyEvents: (existing?.keyEvents ?? 0) + r.keyEvents! } : {}) });
            };
            if (provider === 'clarity') {
                const batch = snapshots[0]?.payload as AnalyticsBatch | undefined;
                if (!batch)
                    return result;
                result.window = batch.window;
                result.warnings = batch.warnings;
                result.lastSyncAt = iso(snapshots[0].observed_at);
                result.totals = utmCampaign ? null : batch.totals;
                for (const c of batch.channels) {
                    if (!utmCampaign || c.utmCampaign === utmCampaign)
                        addChannel(c);
                }
                for (const c of batch.campaigns) {
                    if (!utmCampaign || c.utmCampaign === utmCampaign)
                        campaignMap.set(c.utmCampaign, c.sessions);
                }
                if (utmCampaign && campaignMap.has(utmCampaign))
                    result.totals = { ...batch.totals, sessions: campaignMap.get(utmCampaign)!, botSessions: null, engagedSessions: null, pageViews: null, keyEvents: null, rageClicks: null, deadClicks: null, scrollDepth: null };
                if (utmCampaign && !campaignMap.has(utmCampaign))
                    result.warnings = [...result.warnings, 'analytics_segment_not_measured'];
                if (batch.window && (batch.window.from.slice(0, 10) !== period.from || batch.window.to.slice(0, 10) !== period.to))
                    result.warnings = [...result.warnings, 'analytics_clarity_period_not_supported'];
            }
            else {
                const covered = new Set<string>();
                const contributors:number[]=[];
                result.lastSyncAt=null;
                result.stale=true;
                const warnings = new Set<string>();
                for (const snapshot of snapshots) {
                    const batch = snapshot.payload as AnalyticsBatch;
                    for (let day = new Date(`${period.from}T00:00:00Z`); day.toISOString().slice(0, 10) <= period.to; day.setUTCDate(day.getUTCDate() + 1)) {
                        const date = day.toISOString().slice(0, 10);
                        const lower = new Date(snapshot.period_from).toISOString().slice(0, 10);
                        const upper = new Date(snapshot.period_to).toISOString().slice(0, 10);
                        if (covered.has(date) || date < lower || date > upper)
                            continue;
                        if (organic && !measuredChannels(batch, lower, upper)) {
                            warnings.add('analytics_organic_not_measured');
                            continue;
                        }
                        const partial = batch.warnings.some(w => ['analytics_thresholded', 'analytics_sampled', 'analytics_other_row'].includes(w));
                        const organicRows = organic ? batch.channels.filter(c => c.date === date && organicGroups.has(c.channelGroup!)) : [];
                        // Absent rows in a reduced report are unknown, not zero.
                        if (partial && !(organic ? organicRows.length : utmCampaign ? batch.campaigns.some(c => c.date === date && c.utmCampaign === utmCampaign) : batch.daily.some(d => d.date === date))) {
                            for (const w of batch.warnings)
                                warnings.add(w);
                            continue;
                        }
                        covered.add(date);
                        contributors.push(new Date(snapshot.observed_at).getTime());
                        for (const w of batch.warnings)
                            warnings.add(w);
                        const measured = organic ? organicRows : utmCampaign ? batch.campaigns.filter(c => c.date === date && c.utmCampaign === utmCampaign) : batch.daily.filter(d => d.date === date);
                        const daily = { date, sessions: 0, engagedSessions: 0, pageViews: 0, keyEvents: 0 };
                        for (const d of measured) {
                            daily.sessions += d.sessions;
                            daily.engagedSessions += d.engagedSessions ?? 0;
                            daily.pageViews += d.pageViews ?? 0;
                            daily.keyEvents += d.keyEvents ?? 0;
                        }
                        result.daily.push(daily);
                        for (const c of organic ? organicRows : utmCampaign ? batch.campaignChannels : batch.channels) {
                            if (c.date === date && (!utmCampaign || c.utmCampaign === utmCampaign))
                                addChannel(c);
                        }
                        for (const c of organic ? [] : batch.campaigns) {
                            if (c.date === date && (!utmCampaign || c.utmCampaign === utmCampaign))
                                campaignMap.set(c.utmCampaign, (campaignMap.get(c.utmCampaign) ?? 0) + c.sessions);
                        }
                    }
                }
                if (covered.size) {
                    // The oldest measurement used represents freshness of the
                    // whole requested period, including reduced-report fallback.
                    const oldest=Math.min(...contributors);
                    result.lastSyncAt=new Date(oldest).toISOString();
                    result.stale=Date.now()-oldest>12*3_600_000||!!connection?.safe_error;
                    result.totals = { sessions: 0, engagedSessions: 0, pageViews: 0, keyEvents: 0, rageClicks: null, deadClicks: null, scrollDepth: null };
                    for (const d of result.daily) {
                        result.totals.sessions += d.sessions;
                        result.totals.engagedSessions! += d.engagedSessions ?? 0;
                        result.totals.pageViews! += d.pageViews ?? 0;
                        result.totals.keyEvents! += d.keyEvents ?? 0;
                    }
                }
                const expected = (Date.parse(period.to) - Date.parse(period.from)) / 86400000 + 1;
                if (covered.size < expected)
                    warnings.add('analytics_incomplete_coverage');
                result.warnings = [...warnings];
                result.daily.sort((a, b) => a.date.localeCompare(b.date));
            }
            result.channels = [...channelMap.values()].sort((a, b) => b.sessions - a.sessions);
            result.campaigns = [...campaignMap].map(([utmCampaign, sessions]) => ({ utmCampaign, sessions })).sort((a, b) => b.sessions - a.sessions);
            return result;
        });
    }
    async campaignResults(context: CommandContext, campaignId: string, input: unknown): Promise<{
        ga4: AnalyticsResults | null;
        clarity: AnalyticsResults | null;
    }> {
        const links = await this.listLinks(context, campaignId);
        const output: {
            ga4: AnalyticsResults | null;
            clarity: AnalyticsResults | null;
        } = { ga4: null, clarity: null };
        for (const provider of ['ga4', 'clarity'] as const) {
            const connection = (await this.list(context)).find(c => c.provider === provider);
            const active = links.filter(l => l.enabled && l.provider === provider && l.resourceId === connection?.selectedResourceId);
            for (const link of active) {
                const next = await this.results(context, provider, input, link.utmCampaign,link.resourceId);
                const current = output[provider];
                if (!current) {
                    output[provider] = next;
                    continue;
                }
                current.warnings = [...new Set([...current.warnings, ...next.warnings])];
                current.stale = current.stale || next.stale;
                if(next.lastSyncAt&&(!current.lastSyncAt||next.lastSyncAt<current.lastSyncAt))current.lastSyncAt=next.lastSyncAt;
                if (current.totals && next.totals) {
                    current.totals.sessions += next.totals.sessions;
                    for (const metric of ['engagedSessions', 'pageViews', 'keyEvents', 'rageClicks', 'deadClicks'] as const)
                        current.totals[metric] = current.totals[metric] === null || next.totals[metric] === null ? null : current.totals[metric]! + next.totals[metric]!;
                    current.totals.scrollDepth = null;
                }
                else if (!current.totals)
                    current.totals = next.totals;
                const daily = new Map(current.daily.map(d => [d.date, d]));
                for (const d of next.daily) {
                    const old = daily.get(d.date);
                    if (!old) {
                        daily.set(d.date, d);
                        continue;
                    }
                    old.sessions += d.sessions;
                    for (const metric of ['engagedSessions', 'pageViews', 'keyEvents'] as const)
                        old[metric] = old[metric] === null || d[metric] === null ? null : old[metric]! + d[metric]!;
                }
                current.daily = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
                const channels = new Map(current.channels.map(c => [JSON.stringify([c.source, c.medium]), c]));
                for (const channel of next.channels) {
                    const key = JSON.stringify([channel.source, channel.medium]);
                    const old = channels.get(key);
                    if (old)
                        old.sessions += channel.sessions;
                    else
                        channels.set(key, channel);
                }
                current.channels = [...channels.values()].sort((a, b) => b.sessions - a.sessions);
                current.campaigns.push(...next.campaigns);
            }
        }
        return output;
    }
    async syncDue(): Promise<void> {
        const due = await this.pool.query('select * from marketing_ops_private.web_analytics_due(10)');
        for (const row of due.rows) {
            try {
                const actor = await resolveActor(this.pool, row.owner_id, row.tenant_id);
                const context: CommandContext = { pool: this.pool, actor, origin: 'internal', correlationId: randomUUID() };
                await this.sync(context, row.provider, {}, `scheduled:${new Date().toISOString().slice(0, 13)}`);
            }
            catch { /* safe_error and backoff persisted by synchronization; no provider bodies logged */
            }
        }
    }
}
