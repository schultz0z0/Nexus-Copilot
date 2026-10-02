import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { resolveActor } from '../auth/actor.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import type { CommandContext } from './context.js';
import { sealAdsSecret, openAdsSecret } from './adsCrypto.js';
import { hashCanonicalPayload } from './hash.js';
import { writeAudit } from './audit.js';
import { WorkspaceSetupStore } from '../integrations/workspace/setupStore.js';
import { createWorkspaceProviderClient } from '../integrations/workspace/providers.js';
import { workspaceFamily, workspaceServices, type WorkspaceService, type WorkspaceFamily, type WorkspaceAppConfig, type WorkspaceProviderClient, type WorkspaceTokens, type WorkspaceResource } from '../integrations/workspace/types.js';
import { WorkspaceSetupSchema, WorkspaceAuthorizeSchema, WorkspaceSelectSchema, WorkspaceBrowseSchema, WorkspaceSheetSchema, WorkspaceMailSchema, WorkspaceSendSchema, WorkspaceEventSchema, WorkspaceLinkSchema, workspacePeriod } from './workspaceContracts.js';
type Row = Record<string, any>;
export interface WorkspaceOptions {
    key: Buffer;
    publicOrigin?: string;
    setupDirectory: string;
    googleFallback?: (context: CommandContext) => Promise<WorkspaceAppConfig | null>;
}
type Runtime = {
    config: WorkspaceAppConfig;
    version: string;
    family: WorkspaceFamily;
    adsVersion?: string;
};
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const binding = (c: CommandContext, s: string, g: number | string, p: string) => `${c.actor.tenantId}:workspace:${s}:${g}:${p}`;
const safe = (e: unknown) => /^workspace_[a-z_]+$/.test((e as any)?.code ?? '') ? (e as any).code : 'workspace_provider_unavailable';
const checkVersion = (r: Row | undefined, n: number) => {
    if (Number(r?.version ?? 0) !== n)
        throw appError('version_conflict', 409, 'Observed version is stale', { currentVersion: Number(r?.version ?? 0) });
};
const checkSession = (s: string) => {
    if (!/^[a-f0-9]{64}$/.test(s))
        throw appError('oauth_session_required', 400, 'Internal session binding required');
};
const view = (s: WorkspaceService, r: Row | undefined, configured: boolean) => ({ service: s, status: r?.status ?? (configured ? 'prepared' : 'unprepared'), version: Number(r?.version ?? 0), generation: Number(r?.generation ?? 0), configured, identity: r?.identity ?? null, selectedResource: r?.selected_resource ?? null, resources: r?.resources ?? [], safeError: r?.safe_error ?? null, lastSyncAt: r?.last_sync_at ? new Date(r.last_sync_at).toISOString() : null });
export class WorkspaceIntegrationService {
    private store: WorkspaceSetupStore;
    constructor(readonly pool: Pool, private options: WorkspaceOptions, private factory: (s: WorkspaceService, c: WorkspaceAppConfig) => WorkspaceProviderClient = createWorkspaceProviderClient) {
        this.store = new WorkspaceSetupStore(options.setupDirectory, options.key);
        if (options.publicOrigin) {
            const origin = new URL(options.publicOrigin);
            if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash)
                throw appError('workspace_unprepared', 503, 'Valid public installation origin is required');
        }
    }
    private async actor(c: CommandContext, admin = false) {
        const actor = await resolveActor(this.pool, c.actor.userId, c.actor.tenantId);
        if (actor.role !== c.actor.role || !['admin', 'manager'].includes(actor.role) || (admin && actor.role !== 'admin'))
            throw appError('forbidden', 403, 'Canonical installation authority required');
    }
    private async tx<T>(c: CommandContext, fn: (db: PoolClient) => Promise<T>) {
        await this.actor(c);
        return withActorTransaction(this.pool, c.actor, c.correlationId, async (db) => {
            await db.query("select pg_advisory_xact_lock(hashtextextended('ads-installation-setup',0))");
            await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`workspace:${c.actor.tenantId}`]);
            const installation = (await db.query('select tenant_id from marketing_ops_private.ads_setup_binding where singleton')).rows[0];
            if (installation && installation.tenant_id !== c.actor.tenantId)
                throw appError('forbidden', 403, 'This installation belongs to another company');
            return fn(db);
        });
    }
    private redirect(f: WorkspaceFamily) {
        if (!this.options.publicOrigin)
            throw appError('workspace_unprepared', 409, 'Public installation origin must be prepared by the operator');
        return new URL(`/api/workspace/oauth/${f}/callback`, this.options.publicOrigin).toString();
    }
    private async runtime(c: CommandContext, f: WorkspaceFamily): Promise<Runtime | null> {
        await this.actor(c);
        if (!this.options.publicOrigin)
            return null;
        const row = await this.tx(c, async (db) => (await db.query('select * from marketing_ops_private.workspace_apps where tenant_id=$1 and family=$2', [c.actor.tenantId, f])).rows[0]);
        if (row) {
            const config = this.store.read(f, row.file_id);
            return { config: { ...config, redirectUri: this.redirect(f) }, version: `managed:${row.version}`, family: f };
        }
        if (f === 'google') {
            const config = await this.options.googleFallback?.(c);
            if (config) {
                const adsVersion = await this.tx(c, async (db) => String((await db.query("select version from marketing_ops_private.ads_setup_publications where provider='google'")).rows[0]?.version ?? 'environment'));
                return { config: { ...config, redirectUri: this.redirect(f) }, version: `fallback:${hash(JSON.stringify(config))}`, family: f, adsVersion };
            }
        }
        return null;
    }
    private async fence(c: CommandContext, runtime: Runtime) {
        const current = await this.runtime(c, runtime.family);
        if (!current || current.version !== runtime.version)
            throw appError('workspace_connection_changed', 409, 'Installation application changed');
    }
    private async fenceDb(db: PoolClient, c: CommandContext, runtime: Runtime) {
        const managed = (await db.query('select version from marketing_ops_private.workspace_apps where tenant_id=$1 and family=$2', [c.actor.tenantId, runtime.family])).rows[0];
        if (runtime.version.startsWith('managed:')) {
            if (`managed:${managed?.version}` !== runtime.version)
                throw appError('workspace_connection_changed', 409, 'Application changed');
        }
        else {
            const ads = String((await db.query("select version from marketing_ops_private.ads_setup_publications where provider='google'")).rows[0]?.version ?? 'environment');
            if (managed || ads !== runtime.adsVersion)
                throw appError('workspace_connection_changed', 409, 'Application changed');
        }
    }
    private async row(db: PoolClient, c: CommandContext, s: WorkspaceService) {
        return (await db.query('select * from marketing_ops.workspace_connections where tenant_id=$1 and service=$2 for update', [c.actor.tenantId, s])).rows[0] as Row | undefined;
    }
    private async invalidate(db: PoolClient, c: CommandContext, s: WorkspaceService) {
        await db.query('update marketing_ops.workspace_oauth_states set consumed_at=now() where tenant_id=$1 and service=$2 and consumed_at is null', [c.actor.tenantId, s]);
    }
    private async receipt(db: PoolClient, c: CommandContext, operation: string, key: string, payload: unknown) {
        if (!key || key.length > 200)
            throw appError('idempotency_key_required', 400, 'Command key required');
        const h = hashCanonicalPayload(payload);
        const r = (await db.query('select * from marketing_ops.workspace_receipts where tenant_id=$1 and actor_id=$2 and operation=$3 and idempotency_key=$4', [c.actor.tenantId, c.actor.userId, operation, key])).rows[0];
        if (r && r.request_hash !== h)
            throw appError('idempotency_conflict', 409, 'Command key used with different payload');
        return { r, h };
    }
    private async saveReceipt(db: PoolClient, c: CommandContext, operation: string, key: string, h: string, response: unknown) {
        await db.query("insert into marketing_ops.workspace_receipts(tenant_id,actor_id,operation,idempotency_key,request_hash,status,response) values($1,$2,$3,$4,$5,'completed',$6::jsonb)", [c.actor.tenantId, c.actor.userId, operation, key, h, JSON.stringify(response)]);
    }
    async apps(c: CommandContext) {
        await this.actor(c);
        const output = [];
        for (const family of ['google', 'microsoft'] as const) {
            const runtime = await this.runtime(c, family);
            output.push({ family, configured: !!runtime, version: runtime?.version.startsWith('managed:') ? Number(runtime.version.split(':')[1]) : 0, clientId: runtime?.config.clientId ?? null, tenantId: runtime?.config.tenantId ?? null, redirectUri: this.options.publicOrigin ? this.redirect(family) : null, hasSecret: !!runtime?.config.clientSecret, source: runtime?.version.startsWith('fallback:') ? 'existing_google' : runtime ? 'managed' : 'unprepared' });
        }
        return output;
    }
    async setupApp(c: CommandContext, f: WorkspaceFamily, expected: number, input: unknown, key: string) {
        await this.actor(c, true);
        const v = WorkspaceSetupSchema.parse(input);
        const replay = await this.tx(c, async (db) => (await this.receipt(db, c, `setup:${f}`, key, input)).r);
        if (replay)
            return replay.response;
        const old = await this.runtime(c, f);
        if (old?.config.clientId !== v.clientId && old && !v.clientSecret)
            throw appError('workspace_secret_required', 422, 'A new client secret is required when changing client ID');
        const secret = v.clientSecret ?? old?.config.clientSecret;
        if (!secret)
            throw appError('workspace_secret_required', 422, 'Application secret is required');
        if (f === 'microsoft' && !v.tenantId)
            throw appError('workspace_tenant_required', 422, 'Company directory identifier required');
        const config = { clientId: v.clientId, clientSecret: secret, redirectUri: this.redirect(f), ...(v.tenantId ? { tenantId: v.tenantId } : {}) };
        return this.tx(c, async (db) => {
            await db.query('insert into marketing_ops_private.ads_setup_binding(singleton,tenant_id) values(true,$1) on conflict do nothing', [c.actor.tenantId]);
            const rec = await this.receipt(db, c, `setup:${f}`, key, input);
            if (rec.r)
                return rec.r.response;
            const row = (await db.query('select * from marketing_ops_private.workspace_apps where tenant_id=$1 and family=$2 for update', [c.actor.tenantId, f])).rows[0];
            checkVersion(row, expected);
            if (old && !v.confirmReplacement)
                throw appError('workspace_confirmation_required', 409, 'Confirm replacement of installation application');
            const file = this.store.write(f, config);
            const next = Number(row?.version ?? 0) + 1;
            await db.query('insert into marketing_ops_private.workspace_apps(tenant_id,family,version,file_id) values($1,$2,$3,$4) on conflict(tenant_id,family) do update set version=excluded.version,file_id=excluded.file_id', [c.actor.tenantId, f, next, file]);
            for (const s of workspaceServices.filter(s => workspaceFamily(s) === f)) {
                await this.invalidate(db, c, s);
                await db.query("update marketing_ops.workspace_connections set generation=generation+1,version=version+1,status='reconnect_required',tokens_cipher=null,selected_resource=null,resources='[]',safe_error='workspace_connection_changed' where tenant_id=$1 and service=$2", [c.actor.tenantId, s]);
            }
            const out = { family: f, configured: true, version: next, clientId: config.clientId, tenantId: config.tenantId ?? null, redirectUri: config.redirectUri, hasSecret: true, source: 'managed' };
            await writeAudit(db, c, 'workspace_app', c.actor.tenantId, 'workspace.app_prepared', { configured: !!old }, { family: f, version: next, configured: true });
            await this.saveReceipt(db, c, `setup:${f}`, key, rec.h, out);
            return out;
        });
    }
    async list(c: CommandContext) {
        const runtimes = await Promise.all(['google', 'microsoft'].map(f => this.runtime(c, f as WorkspaceFamily)));
        return this.tx(c, async (db) => {
            const rows = (await db.query('select * from marketing_ops.workspace_connections where tenant_id=$1', [c.actor.tenantId])).rows;
            return workspaceServices.map(s => {
                const r = rows.find(r => r.service === s);
                const runtime = runtimes[workspaceFamily(s) === 'google' ? 0 : 1];
                if (r && r.config_version !== runtime?.version)
                    return { ...view(s, r, !!runtime), status: 'reconnect_required', safeError: 'workspace_connection_changed' };
                return view(s, r, !!runtime);
            });
        });
    }
    async authorize(c: CommandContext, s: WorkspaceService, expected: number, input: unknown, key: string, session: string) {
        checkSession(session);
        const value = WorkspaceAuthorizeSchema.parse(input);
        const runtime = await this.runtime(c, workspaceFamily(s));
        if (!runtime)
            throw appError('workspace_unprepared', 409, 'Prepare installation application');
        const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
        const client = this.factory(s, runtime.config);
        await this.fence(c, runtime);
        return this.tx(c, async (db) => {
            await this.fenceDb(db, c, runtime);
            const rec = await this.receipt(db, c, `authorize:${s}`, key, input);
            if (rec.r)
                return rec.r.response;
            const row = await this.row(db, c, s);
            checkVersion(row, expected);
            if (row?.tokens_cipher && !value.confirmReplacement)
                throw appError('workspace_confirmation_required', 409, 'Confirm account replacement');
            await this.invalidate(db, c, s);
            const current = (await db.query("insert into marketing_ops.workspace_connections(tenant_id,service,owner_id,config_version) values($1,$2,$3,$4) on conflict(tenant_id,service) do update set owner_id=excluded.owner_id,config_version=excluded.config_version,generation=workspace_connections.generation+1,version=workspace_connections.version+1,status='prepared',tokens_cipher=null,identity=null,selected_resource=null,resources='[]',safe_error=null returning *", [c.actor.tenantId, s, c.actor.userId, runtime.version])).rows[0]!;
            await db.query('insert into marketing_ops.workspace_oauth_states(state_hash,tenant_id,actor_id,session_hash,service,generation,config_version,verifier_cipher) values($1,$2,$3,$4,$5,$6,$7,$8)', [hash(state), c.actor.tenantId, c.actor.userId, hash(session), s, current.generation, runtime.version, sealAdsSecret(this.options.key, binding(c, s, current.generation, 'verifier'), verifier)]);
            const out = { url: client.authorizationUrl(state, verifier) };
            await this.saveReceipt(db, c, `authorize:${s}`, key, rec.h, out);
            return out;
        });
    }
    async callback(c: CommandContext, f: WorkspaceFamily, session: string, input: {
        state: string;
        code?: string | undefined;
        error?: string | undefined;
    }) {
        checkSession(session);
        const runtime = await this.runtime(c, f);
        if (!runtime)
            throw appError('workspace_unprepared', 409, 'Prepare installation application');
        const reserved = await this.tx(c, async (db) => {
            const state = (await db.query('select * from marketing_ops.workspace_oauth_states where state_hash=$1 and tenant_id=$2 and actor_id=$3 and session_hash=$4 for update', [hash(input.state), c.actor.tenantId, c.actor.userId, hash(session)])).rows[0];
            const r = state ? await this.row(db, c, state.service) : undefined;
            if (!state || workspaceFamily(state.service) !== f || state.consumed_at || Date.parse(state.expires_at) <= Date.now() || state.generation !== r?.generation || state.config_version !== runtime.version)
                throw appError('oauth_state_invalid', 400, 'OAuth state invalid or consumed');
            await db.query('update marketing_ops.workspace_oauth_states set consumed_at=now() where state_hash=$1', [hash(input.state)]);
            return { service: state.service as WorkspaceService, generation: state.generation, verifier: openAdsSecret<string>(this.options.key, binding(c, state.service, state.generation, 'verifier'), state.verifier_cipher) };
        });
        try {
            if (input.error || !input.code)
                throw appError('workspace_permission_required', 403, 'Authorization was denied');
            const client = this.factory(reserved.service, runtime.config);
            const tokens = await client.exchange(input.code, reserved.verifier);
            const identity = await client.identity(tokens);
            const resources = await client.resources(tokens);
            await this.fence(c, runtime);
            await this.tx(c, async (db) => {
                await this.fenceDb(db, c, runtime);
                const row = await this.row(db, c, reserved.service);
                if (row?.generation !== reserved.generation)
                    throw appError('workspace_connection_changed', 409, 'Connection changed');
                await db.query("update marketing_ops.workspace_connections set tokens_cipher=$3,identity=$4::jsonb,resources=$5::jsonb,status='pending_resource',safe_error=null,version=version+1 where tenant_id=$1 and service=$2", [c.actor.tenantId, reserved.service, sealAdsSecret(this.options.key, binding(c, reserved.service, reserved.generation, 'tokens'), tokens), JSON.stringify(identity), JSON.stringify(resources.items)]);
            });
            return { service: reserved.service };
        }
        catch (e) {
            await this.failure(c, reserved.service, reserved.generation, e);
            throw appError(safe(e), (e as any)?.status ?? 502, 'Workspace authorization could not be completed');
        }
    }
    private async failure(c: CommandContext, s: WorkspaceService, g: unknown, e: unknown) {
        await this.tx(c, db => db.query("update marketing_ops.workspace_connections set safe_error=$4,status=case when $4='workspace_reconnect_required' then 'reconnect_required' else status end where tenant_id=$1 and service=$2 and generation=$3", [c.actor.tenantId, s, g, safe(e)])).catch(() => undefined);
    }
    private async access(c: CommandContext, s: WorkspaceService, selected = true) {
        await this.actor(c);
        // Session advisory lock spans only token refresh, not provider operations.
        // Every contender rereads the latest rotating refresh token under this lock.
        let guard: PoolClient | undefined;
        const lock = `workspace-refresh:${c.actor.tenantId}:${s}`;
        try {
            // Never occupy all pool connections while waiting for another refresh.
            // Contenders release their client immediately and wait outside the pool.
            for (let attempt = 0; attempt < 100 && !guard; attempt++) {
                const candidate = await this.pool.connect();
                try {
                    const acquired = (await candidate.query('select pg_try_advisory_lock(hashtextextended($1,0)) as acquired', [lock])).rows[0]?.acquired;
                    if (acquired)
                        guard = candidate;
                    else
                        candidate.release();
                }
                catch (e) {
                    candidate.release(e as Error);
                    throw e;
                }
                if (!guard)
                    await new Promise<void>(resolve => setTimeout(resolve, 50));
            }
            if (!guard)
                throw appError('workspace_rate_limited', 429, 'Authorization refresh is busy; retry shortly');
            const runtime = await this.runtime(c, workspaceFamily(s));
            if (!runtime)
                throw appError('workspace_unprepared', 409, 'Application unavailable');
            const row = await this.tx(c, db => this.row(db, c, s));
            if (!row?.tokens_cipher || row.config_version !== runtime.version)
                throw appError('workspace_reconnect_required', 409, 'Renew authorization');
            if (selected && !row.selected_resource)
                throw appError('workspace_resource_required', 409, 'Choose a resource');
            const client = this.factory(s, runtime.config);
            const old = openAdsSecret<WorkspaceTokens>(this.options.key, binding(c, s, row.generation, 'tokens'), row.tokens_cipher);
            let tokens: WorkspaceTokens;
            try {
                tokens = await client.refresh(old);
            }
            catch (e) {
                await this.failure(c, s, row.generation, e);
                throw appError(safe(e), (e as any)?.status ?? 502, 'Authorization could not be renewed');
            }
            const merged = { ...tokens, ...(tokens.refreshToken ?? old.refreshToken ? { refreshToken: tokens.refreshToken ?? old.refreshToken } : {}) };
            await this.fence(c, runtime);
            await this.tx(c, async (db) => {
                await this.fenceDb(db, c, runtime);
                const current = await this.row(db, c, s);
                if (current?.generation !== row.generation || current?.token_revision !== row.token_revision)
                    throw appError('workspace_connection_changed', 409, 'Authorization changed');
                if (JSON.stringify(merged) !== JSON.stringify(old))
                    await db.query('update marketing_ops.workspace_connections set tokens_cipher=$3,token_revision=token_revision+1 where tenant_id=$1 and service=$2', [c.actor.tenantId, s, sealAdsSecret(this.options.key, binding(c, s, row.generation, 'tokens'), merged)]);
            });
            return { runtime, row, client, tokens: merged };
        }
        finally {
            if (guard) {
                try {
                    await guard.query('select pg_advisory_unlock(hashtextextended($1,0))', [lock]);
                    guard.release();
                }
                catch (e) {
                    guard.release(e as Error);
                }
            }
        }
    }
    private async read<T>(c: CommandContext, s: WorkspaceService, fn: (a: Awaited<ReturnType<WorkspaceIntegrationService['access']>>) => Promise<T>, selected = true) {
        const a = await this.access(c, s, selected);
        try {
            const out = await fn(a);
            await this.fence(c, a.runtime);
            await this.tx(c, async (db) => {
                await this.fenceDb(db, c, a.runtime);
                const r = await this.row(db, c, s);
                if (r?.generation !== a.row.generation)
                    throw appError('workspace_connection_changed', 409, 'Connection changed');
            });
            return out;
        }
        catch (e) {
            await this.failure(c, s, a.row.generation, e);
            throw appError(safe(e), (e as any)?.status ?? 502, 'Provider operation could not be completed');
        }
    }
    async resources(c: CommandContext, s: WorkspaceService, query: unknown = {}) {
        const v = WorkspaceBrowseSchema.parse(query);
        return this.read(c, s, a => a.client.resources(a.tokens, Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined))), false);
    }
    async selectResource(c: CommandContext, s: WorkspaceService, expected: number, input: unknown, key: string) {
        const v = WorkspaceSelectSchema.parse(input);
        const replay = await this.tx(c, async (db) => (await this.receipt(db, c, `select:${s}`, key, input)).r);
        if (replay)
            return replay.response;
        const a = await this.access(c, s, false);
        checkVersion(a.row, expected);
        if (a.row.selected_resource?.id !== v.resourceId && a.row.selected_resource && !v.confirmReplacement)
            throw appError('workspace_confirmation_required', 409, 'Confirm resource replacement');
        const resource = await a.client.resource(a.tokens, v.resourceId);
        const kinds: Record<WorkspaceService, string[]> = { google_drive: ['folder'], google_gmail: ['mailbox'], google_calendar: ['calendar'], google_sheets: ['spreadsheet'], google_search_console: ['site'], microsoft_files: ['folder', 'site'], microsoft_mail: ['mailbox'], microsoft_calendar: ['calendar'] };
        const sheetsLibrary = s === 'google_sheets' && resource.id === 'root' && resource.kind === 'folder';
        if (!kinds[s].includes(resource.kind) && !sheetsLibrary)
            throw appError('workspace_resource_unavailable', 422, 'Choose a resource matching this service');
        await this.fence(c, a.runtime);
        return this.tx(c, async (db) => {
            await this.fenceDb(db, c, a.runtime);
            const rec = await this.receipt(db, c, `select:${s}`, key, input);
            if (rec.r)
                return rec.r.response;
            const row = await this.row(db, c, s);
            checkVersion(row, expected);
            if (row?.generation !== a.row.generation)
                throw appError('workspace_connection_changed', 409, 'Connection changed');
            const g = Number(row!.generation) + 1;
            await this.invalidate(db, c, s);
            const outrow = (await db.query("update marketing_ops.workspace_connections set generation=$3,version=version+1,selected_resource=$4::jsonb,tokens_cipher=$5,status='connected',safe_error=null,last_sync_at=null where tenant_id=$1 and service=$2 returning *", [c.actor.tenantId, s, g, JSON.stringify(resource), sealAdsSecret(this.options.key, binding(c, s, g, 'tokens'), a.tokens)])).rows[0];
            const out = view(s, outrow, true);
            await writeAudit(db, c, 'workspace_connection', c.actor.tenantId, 'workspace.resource_selected', view(s, row, true), out);
            await this.saveReceipt(db, c, `select:${s}`, key, rec.h, out);
            return out;
        });
    }
    async disconnect(c: CommandContext, s: WorkspaceService, expected: number, key: string) {
        return this.tx(c, async (db) => {
            const rec = await this.receipt(db, c, `disconnect:${s}`, key, {});
            if (rec.r)
                return rec.r.response;
            const row = await this.row(db, c, s);
            checkVersion(row, expected);
            await this.invalidate(db, c, s);
            const outrow = (await db.query("update marketing_ops.workspace_connections set generation=generation+1,version=version+1,tokens_cipher=null,selected_resource=null,resources='[]',status='disconnected',safe_error=null where tenant_id=$1 and service=$2 returning *", [c.actor.tenantId, s])).rows[0];
            const out = view(s, outrow, true);
            await writeAudit(db, c, 'workspace_connection', c.actor.tenantId, 'workspace.disconnected', view(s, row, true), out);
            await this.saveReceipt(db, c, `disconnect:${s}`, key, rec.h, out);
            return out;
        });
    }
    async files(c: CommandContext, s: WorkspaceService, query: unknown = {}) {
        if (!['google_drive', 'microsoft_files'].includes(s))
            throw appError('workspace_capability_unavailable', 422, 'Files unavailable');
        const v = WorkspaceBrowseSchema.parse(query);
        return this.read(c, s, a => a.client.resources(a.tokens, { ...Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined)), parentId: v.parentId ?? a.row.selected_resource.id }));
    }
    async messages(c: CommandContext, s: WorkspaceService) {
        return this.read(c, s, a => {
            if (!a.client.messages)
                throw appError('workspace_capability_unavailable', 422, 'Mail unavailable');
            return a.client.messages(a.tokens, a.row.selected_resource.id);
        });
    }
    async message(c: CommandContext, s: WorkspaceService, id: string) {
        return this.read(c, s, a => {
            if (!a.client.message)
                throw appError('workspace_capability_unavailable', 422, 'Mail unavailable');
            return a.client.message(a.tokens, id);
        });
    }
    private async campaign(db: PoolClient, c: CommandContext, id?: string, actionId?: string) {
        if (id && !((await db.query('select id from marketing_ops.campaigns where tenant_id=$1 and id=$2 and marketing_ops_private.can_access_campaign(id)', [c.actor.tenantId, id])).rows[0]))
            throw appError('not_found', 404, 'Campaign unavailable');
        if (actionId) {
            const r = (await db.query('select id,campaign_id from marketing_ops.campaign_items where tenant_id=$1 and id=$2', [c.actor.tenantId, actionId])).rows[0];
            if (!r || (id && r.campaign_id !== id))
                throw appError('not_found', 404, 'Action unavailable');
        }
    }
    private async external<T>(c: CommandContext, s: WorkspaceService, expected: number, operation: string, key: string, input: unknown, work: (a: Awaited<ReturnType<WorkspaceIntegrationService['access']>>, dbCheck: () => Promise<void>) => Promise<T>, prepare?: (db: PoolClient, a: Row) => Promise<void>) {
        if (c.origin !== 'rest' || c.operatorOrigin === 'hermes')
            throw appError('workspace_confirmation_required', 403, 'External writes require a human application action');
        const existing = await this.tx(c, async (db) => (await this.receipt(db, c, operation, key, input)).r);
        if (existing)
            return existing.response ?? { status: 'uncertain', id: key };
        const a = await this.access(c, s);
        checkVersion(a.row, expected);
        await this.fence(c, a.runtime);
        const reserved = await this.tx(c, async (db) => {
            await this.fenceDb(db, c, a.runtime);
            const rec = await this.receipt(db, c, operation, key, input);
            if (rec.r)
                return { existing: rec.r };
            const r = await this.row(db, c, s);
            checkVersion(r, expected);
            if (r?.generation !== a.row.generation)
                throw appError('workspace_connection_changed', 409, 'Connection changed');
            await prepare?.(db, r!);
            await db.query("insert into marketing_ops.workspace_receipts(tenant_id,actor_id,operation,idempotency_key,request_hash,status,generation) values($1,$2,$3,$4,$5,'reserved',$6)", [c.actor.tenantId, c.actor.userId, operation, key, rec.h, r!.generation]);
            await writeAudit(db, c, 'workspace_operation', c.actor.tenantId, 'workspace.operation_reserved', null, { operation, status: 'reserved', generation: Number(r!.generation) });
            return { existing: null };
        });
        if (reserved.existing)
            return reserved.existing.response ?? { status: 'uncertain', id: key };
        try {
            const out = await work(a, async () => {
                await this.fence(c, a.runtime);
                await this.tx(c, async (db) => {
                    await this.fenceDb(db, c, a.runtime);
                    const r = await this.row(db, c, s);
                    if (r?.generation !== a.row.generation)
                        throw appError('workspace_connection_changed', 409, 'Connection changed');
                });
            });
            await this.fence(c, a.runtime);
            await this.tx(c, async (db) => {
                await this.fenceDb(db, c, a.runtime);
                const r = await this.row(db, c, s);
                if (r?.generation !== a.row.generation)
                    throw appError('workspace_connection_changed', 409, 'Connection changed');
                await db.query("update marketing_ops.workspace_receipts set status='completed',response=$5::jsonb where tenant_id=$1 and actor_id=$2 and operation=$3 and idempotency_key=$4", [c.actor.tenantId, c.actor.userId, operation, key, JSON.stringify(out)]);
                await writeAudit(db, c, 'workspace_operation', c.actor.tenantId, 'workspace.operation_completed', { status: 'reserved' }, { operation, status: 'completed' });
            });
            return out;
        }
        catch (e) {
            const status = ['workspace_draft_changed', 'workspace_send_blocked'].includes(safe(e)) ? 'blocked' : 'uncertain';
            const out = { status, id: key, safeError: safe(e) };
            await this.tx(c, db => db.query("update marketing_ops.workspace_receipts set status=$5,response=$6::jsonb where tenant_id=$1 and actor_id=$2 and operation=$3 and idempotency_key=$4", [c.actor.tenantId, c.actor.userId, operation, key, status, JSON.stringify(out)])).catch(() => undefined);
            return out;
        }
    }
    async createDraft(c: CommandContext, s: WorkspaceService, expected: number, input: unknown, key: string) {
        const v = WorkspaceMailSchema.parse(input);
        if (!['google_gmail', 'microsoft_mail'].includes(s))
            throw appError('workspace_capability_unavailable', 422, 'Mail unavailable');
        return this.external(c, s, expected, `draft:${s}`, key, input, async (a, check) => {
            if (!a.client.createDraft)
                throw appError('workspace_capability_unavailable', 422, 'Mail unavailable');
            await check();
            const draft = await a.client.createDraft(a.tokens, v);
            await check();
            return this.tx(c, async (db) => {
                await this.fenceDb(db, c, a.runtime);
                const current = await this.row(db, c, s);
                if (current?.generation !== a.row.generation)
                    throw appError('workspace_connection_changed', 409, 'Connection changed');
                const id = randomUUID();
                await db.query('insert into marketing_ops.workspace_drafts(id,tenant_id,actor_id,service,generation,provider_id,campaign_id,content) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [id, c.actor.tenantId, c.actor.userId, s, a.row.generation, draft.id, v.campaignId ?? null, JSON.stringify(draft)]);
                return { ...draft, id, status: 'drafted', version: expected };
            });
        }, (db) => this.campaign(db, c, v.campaignId));
    }
    async sendDraft(c: CommandContext, s: WorkspaceService, expected: number, id: string, input: unknown, key: string) {
        const v = WorkspaceSendSchema.parse(input);
        if (!['google_gmail', 'microsoft_mail'].includes(s))
            throw appError('workspace_capability_unavailable', 422, 'Mail unavailable');
        let draft: Row;
        return this.external(c, s, expected, `send:${s}:${id}`, key, input, async (a, check) => {
            try {
                if (!a.client.getDraft || !a.client.sendDraft)
                    throw appError('workspace_send_blocked', 409, 'Draft review is unavailable');
                const current = await a.client.getDraft(a.tokens, draft!.provider_id);
                const addresses = (to: string[]) => JSON.stringify([...new Set(to.map(v => v.toLowerCase()))].sort());
                const text = (value: string) => value.replace(/\r\n/g, '\n');
                if (current.subject !== draft!.content.subject || text(current.text) !== text(draft!.content.text) || addresses(current.to) !== addresses(draft!.content.to)||(draft!.content.revision!==undefined&&current.revision!==draft!.content.revision))
                    throw appError('workspace_draft_changed', 409, 'Draft changed since human review');
                await check();
            }
            catch (e) {
                await this.tx(c, db => db.query("update marketing_ops.workspace_drafts set send_status='blocked' where tenant_id=$1 and id=$2", [c.actor.tenantId, id]));
                await this.failure(c, s, a.row.generation, e);
                if (safe(e) === 'workspace_draft_changed')
                    throw e;
                throw appError('workspace_send_blocked', 409, 'Draft could not be verified before sending');
            }
            try {
                const result = await a.client.sendDraft!(a.tokens, draft!.provider_id, {
                    to: draft!.content.to, subject: draft!.content.subject, text: draft!.content.text
                });
                await this.tx(c, db => db.query("update marketing_ops.workspace_drafts set send_status='sent',sent_at=now() where tenant_id=$1 and id=$2", [c.actor.tenantId, id]));
                return { status: 'completed', id: key, providerId: result.id };
            }
            catch (e) {
                await this.tx(c, db => db.query("update marketing_ops.workspace_drafts set send_status='uncertain' where tenant_id=$1 and id=$2", [c.actor.tenantId, id]));
                throw e;
            }
        }, async (db, row) => {
            await this.campaign(db, c, v.campaignId);
            draft = (await db.query('select * from marketing_ops.workspace_drafts where tenant_id=$1 and id=$2 and actor_id=$3 and service=$4 for update', [c.actor.tenantId, id, c.actor.userId, s])).rows[0];
            if (!draft || draft.generation !== row.generation || draft.campaign_id !== (v.campaignId ?? null))
                throw appError('workspace_draft_unavailable', 409, 'Draft unavailable for this account');
            if (draft.send_status !== 'drafted')
                throw appError('workspace_send_already_reserved', 409, 'Draft already sent or requires verification at provider');
            await db.query("update marketing_ops.workspace_drafts set send_status='reserved' where tenant_id=$1 and id=$2", [c.actor.tenantId, id]);
        });
    }
    async events(c: CommandContext, s: WorkspaceService, input: unknown) {
        const p = workspacePeriod(input);
        return this.read(c, s, a => {
            if (!a.client.events)
                throw appError('workspace_capability_unavailable', 422, 'Calendar unavailable');
            return a.client.events(a.tokens, a.row.selected_resource.id, p.from, p.to);
        });
    }
    async publishEvent(c: CommandContext, s: WorkspaceService, expected: number, input: unknown, key: string) {
        const v = WorkspaceEventSchema.parse(input);
        if (!['google_calendar', 'microsoft_calendar'].includes(s))
            throw appError('workspace_capability_unavailable', 422, 'Calendar unavailable');
        return this.external(c, s, expected, `event:${s}`, key, input, async (a, check) => {
            if (!a.client.publishEvent)
                throw appError('workspace_capability_unavailable', 422, 'Calendar unavailable');
            await check();
            const event = await a.client.publishEvent(a.tokens, a.row.selected_resource.id, { ...v, externalKey: hash(`${c.actor.tenantId}:${s}:${key}`) });
            return { status: 'completed', id: key, event };
        }, async (db, row) => {
            await this.campaign(db, c, v.campaignId, v.actionId);
            if (row.selected_resource?.writable === false)
                throw appError('workspace_permission_required', 403, 'Selected calendar is read only');
        });
    }
    async sheet(c: CommandContext, input: unknown = {}) {
        const v = WorkspaceSheetSchema.parse(input);
        return this.read(c, 'google_sheets', async a => {
            if (!a.client.sheet)
                throw appError('workspace_capability_unavailable', 422, 'Sheets unavailable');
            const id = v.resourceId ?? a.row.selected_resource.id;
            if (id === 'root')
                throw appError('workspace_resource_required', 422, 'Choose a spreadsheet from the library');
            const resource = await a.client.resource(a.tokens, id);
            if (resource.kind !== 'spreadsheet')
                throw appError('workspace_resource_unavailable', 422, 'Choose a spreadsheet');
            return a.client.sheet(a.tokens, resource.id);
        });
    }
    async report(c: CommandContext, input: unknown, refresh = false, key?: string, expected?: number) {
        const p = workspacePeriod(input);
        if (!refresh)
            return this.tx(c, async (db) => {
                const row = await this.row(db, c, 'google_search_console');
                const snap = (await db.query('select payload,observed_at from marketing_ops.workspace_search_snapshots where tenant_id=$1 and resource_id=$2 and period_from=$3 and period_to=$4 order by observed_at desc limit 1', [c.actor.tenantId, row?.selected_resource?.id ?? '', p.from, p.to])).rows[0];
                return snap ? { ...snap.payload, lastSyncAt: new Date(snap.observed_at).toISOString() } : { ...p, totals: null, daily: [], pages: [], queries: [], truncated: false, lastSyncAt: null };
            });
        const s = 'google_search_console';
        const old = await this.tx(c, async (db) => (await this.receipt(db, c, `report:${s}`, key!, p)).r);
        if (old)
            return old.response;
        const a = await this.access(c, s);
        checkVersion(a.row, expected!);
        if (!a.client.searchReport)
            throw appError('workspace_capability_unavailable', 422, 'Search unavailable');
        try {
            const result = await a.client.searchReport(a.tokens, a.row.selected_resource.id, p.from, p.to);
            await this.fence(c, a.runtime);
            return this.tx(c, async (db) => {
                await this.fenceDb(db, c, a.runtime);
                const rec = await this.receipt(db, c, `report:${s}`, key!, p);
                if (rec.r)
                    return rec.r.response;
                const row = await this.row(db, c, s);
                if (row?.generation !== a.row.generation)
                    throw appError('workspace_connection_changed', 409, 'Connection changed');
                await db.query('insert into marketing_ops.workspace_search_snapshots(tenant_id,resource_id,generation,period_from,period_to,payload) values($1,$2,$3,$4,$5,$6::jsonb)', [c.actor.tenantId, row!.selected_resource.id, row!.generation, p.from, p.to, JSON.stringify(result)]);
                await db.query('update marketing_ops.workspace_connections set last_sync_at=now(),safe_error=null where tenant_id=$1 and service=$2', [c.actor.tenantId, s]);
                const out = { ...result, lastSyncAt: new Date().toISOString() };
                await this.saveReceipt(db, c, `report:${s}`, key!, rec.h, out);
                return out;
            });
        }
        catch (e) {
            await this.failure(c, s, a.row.generation, e);
            throw appError(safe(e), (e as any)?.status ?? 502, 'Search data preserved; provider read failed');
        }
    }
    async listLinks(c: CommandContext, id: string) {
        const connections = await this.list(c);
        return this.tx(c, async (db) => {
            await this.campaign(db, c, id);
            return (await db.query('select id,service,kind,resource_id as "resourceId",name,url,active,version,generation,identity_id as "identityId",created_at as "createdAt" from marketing_ops.workspace_links where tenant_id=$1 and campaign_id=$2 order by created_at', [c.actor.tenantId, id])).rows.map(r => ({ ...r, createdAt: new Date(r.createdAt).toISOString(), available: !!r.active && connections.some(conn => conn.service === r.service && conn.status === 'connected' && conn.generation === Number(r.generation) && conn.identity?.id === r.identityId) }));
        });
    }
    async linkedMessage(c: CommandContext, campaignId: string, linkId: string) {
        const link = await this.tx(c, async (db) => {
            await this.campaign(db, c, campaignId);
            const r = (await db.query('select * from marketing_ops.workspace_links where tenant_id=$1 and campaign_id=$2 and id=$3 and active', [c.actor.tenantId, campaignId, linkId])).rows[0];
            if (!r || r.kind !== 'message' || !['google_gmail', 'microsoft_mail'].includes(r.service))
                throw appError('workspace_resource_unavailable', 404, 'Linked conversation unavailable');
            return r;
        });
        return this.read(c, link.service, async (a) => {
            if (a.row.generation !== link.generation || a.row.identity?.id !== link.identity_id)
                throw appError('workspace_connection_changed', 409, 'Conversation belongs to another authorization');
            if (!a.client.message)
                throw appError('workspace_capability_unavailable', 422, 'Mail unavailable');
            const message = await a.client.message(a.tokens, link.resource_id);
            await this.tx(c, async (db) => {
                await this.campaign(db, c, campaignId);
                const current = (await db.query('select active from marketing_ops.workspace_links where tenant_id=$1 and campaign_id=$2 and id=$3', [c.actor.tenantId, campaignId, linkId])).rows[0];
                if (!current?.active)
                    throw appError('workspace_resource_unavailable', 404, 'Conversation link was disabled');
            });
            return message;
        });
    }
    async createLink(c: CommandContext, id: string, input: unknown, key: string,expected?:number) {
        const v = WorkspaceLinkSchema.parse(input);
        const replay = await this.tx(c, async (db) => {
            await this.campaign(db, c, id);
            return (await this.receipt(db, c, `link:${id}`, key, input)).r;
        });
        if (replay)
            return replay.response;
        await this.tx(c, db => this.campaign(db, c, id));
        const a = await this.access(c, v.service);
        if(expected!==undefined)checkVersion(a.row,expected);
        let resource: WorkspaceResource;
        if (v.kind === 'message') {
            if (!a.client.message)
                throw appError('workspace_capability_unavailable', 422, 'Mail unavailable');
            const m = await a.client.message(a.tokens, v.resourceId);
            resource = { id: m.id, name: m.subject, kind: 'file', url: null };
        }
        else {
            if (!['google_drive', 'microsoft_files', 'google_sheets'].includes(v.service))
                throw appError('workspace_capability_unavailable', 422, 'Files unavailable');
            resource = await a.client.resource(a.tokens, v.resourceId);
        }
        await this.fence(c, a.runtime);
        return this.tx(c, async (db) => {
            await this.fenceDb(db, c, a.runtime);
            await this.campaign(db, c, id);
            const rec = await this.receipt(db, c, `link:${id}`, key, input);
            if (rec.r)
                return rec.r.response;
            const row = await this.row(db, c, v.service);
            if(expected!==undefined)checkVersion(row,expected);
            if (row?.generation !== a.row.generation)
                throw appError('workspace_connection_changed', 409, 'Connection changed');
            const result = (await db.query('insert into marketing_ops.workspace_links(tenant_id,campaign_id,service,kind,resource_id,name,url,created_by,generation,identity_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,service,kind,resource_id as "resourceId",name,url,active,version,created_at as "createdAt"', [c.actor.tenantId, id, v.service, v.kind, resource.id, resource.name, resource.url, c.actor.userId, a.row.generation, a.row.identity.id])).rows[0];
            const out = { ...result, createdAt: new Date(result.createdAt).toISOString(), available: true };
            await this.saveReceipt(db, c, `link:${id}`, key, rec.h, out);
            return out;
        });
    }
    async disableLink(c: CommandContext, id: string, linkId: string, expected: number, key: string) {
        return this.tx(c, async (db) => {
            await this.campaign(db, c, id);
            const rec = await this.receipt(db, c, `disable:${id}:${linkId}`, key, {});
            if (rec.r)
                return rec.r.response;
            const r = (await db.query('select * from marketing_ops.workspace_links where tenant_id=$1 and campaign_id=$2 and id=$3 for update', [c.actor.tenantId, id, linkId])).rows[0];
            if (!r)
                throw appError('not_found', 404, 'Link unavailable');
            checkVersion(r, expected);
            const result = (await db.query('update marketing_ops.workspace_links set active=false,version=version+1 where tenant_id=$1 and id=$2 returning id,service,kind,resource_id as "resourceId",name,url,active,version,created_at as "createdAt"', [c.actor.tenantId, linkId])).rows[0];
            const out = { ...result, createdAt: new Date(result.createdAt).toISOString(), available: false };
            await this.saveReceipt(db, c, `disable:${id}:${linkId}`, key, rec.h, out);
            return out;
        });
    }
}
