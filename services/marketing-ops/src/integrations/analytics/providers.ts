import { createHash } from 'node:crypto';
import { appError } from '../../errors.js';
import type { AdsProviderConfig, AdsTokens } from '../ads/types.js';
import type { AnalyticsBatch, AnalyticsResource, AnalyticsTotals, Ga4ProviderClient, ClarityProviderClient } from './types.js';
const scope = 'https://www.googleapis.com/auth/analytics.readonly';
const invalid = () => appError('analytics_invalid_response', 502, 'Analytics returned an invalid response');
const totals = (sessions = 0): AnalyticsTotals => ({ sessions, engagedSessions: null, pageViews: null, keyEvents: null, rageClicks: null, deadClicks: null, scrollDepth: null });
const number = (value: unknown): number => {
    if ((typeof value !== 'number' && typeof value !== 'string') || typeof value === 'string' && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
        throw invalid();
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER)
        throw invalid();
    return n;
};
async function boundedText(response: Response, maximum: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader)
        return '';
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done)
                break;
            bytes += part.value.byteLength;
            if (bytes > maximum) {
                await reader.cancel();
                throw invalid();
            }
            chunks.push(part.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
}
async function json(fetcher: typeof fetch, url: URL | string, init: RequestInit = {}): Promise<any> {
    try {
        const signal=init.signal??AbortSignal.timeout(30000);
        signal.throwIfAborted();
        const response = await fetcher(url, { ...init, redirect: 'error', signal });
        if (!response.ok) {
            // Only fixed protocol codes are inspected; provider prose and
            // request metadata never leave this transport boundary.
            let failure: any;
            try {
                failure = JSON.parse(await boundedText(response, 8192));
            }
            catch {
            }
            if (response.status === 400 && failure?.error === 'invalid_grant')
                throw appError('analytics_reconnect_required', 401, 'Analytics authorization must be renewed');
            if (response.status === 403 && Array.isArray(failure?.error?.details) && failure.error.details.some((entry: any) => entry?.reason === 'SERVICE_DISABLED'))
                throw appError('analytics_api_disabled', 403, 'Enable the Google Analytics Admin and Data APIs');
            if (response.status === 401)
                throw appError('analytics_reconnect_required', 401, 'Analytics authorization must be renewed');
            if (response.status === 403)
                throw appError('analytics_permission_required', 403, 'Analytics permission is required');
            if (response.status === 429)
                throw appError('analytics_rate_limited', 429, 'Analytics request quota is exhausted');
            throw appError('analytics_provider_unavailable', 502, 'Analytics provider is unavailable');
        }
        const text = await boundedText(response, 8000000);
        try {
            return JSON.parse(text);
        }
        catch {
            throw invalid();
        }
    }
    catch (error) {
        const code=(error as {code?:unknown}).code;
        if (typeof code==='string'&&code.startsWith('analytics_'))
            throw error;
        throw appError('analytics_provider_unavailable', 502, 'Analytics provider is unavailable');
    }
}
export class Ga4Client implements Ga4ProviderClient {
    constructor(private config: AdsProviderConfig, private fetcher: typeof fetch = fetch) {
    }
    authorizationUrl(state: string, verifier: string): string {
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code', scope, state, access_type: 'offline', prompt: 'consent', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
        return url.toString();
    }
    private async token(form: Record<string, string>, previous?: AdsTokens,parent?:AbortSignal): Promise<AdsTokens> {
        const signal=parent?AbortSignal.any([parent,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
        const body = await json(this.fetcher, 'https://oauth2.googleapis.com/token', {signal, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, client_id: this.config.clientId, client_secret: this.config.clientSecret }) });
        if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(Number(body.expires_in)))
            throw invalid();
        const scopes = typeof body.scope === 'string' ? body.scope.split(' ') : previous?.scopes ?? [];
        if (!scopes.includes(scope))
            throw appError('analytics_permission_required', 403, 'Analytics permission is required');
        return { accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : previous?.refreshToken, expiresAt: new Date(Date.now() + Number(body.expires_in) * 1000).toISOString(), scopes };
    }
    exchange(code: string, verifier: string,signal?:AbortSignal): Promise<AdsTokens> {
        return this.token({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri, code_verifier: verifier },undefined,signal);
    }
    async refresh(tokens: AdsTokens,signal?:AbortSignal): Promise<AdsTokens> {
        if (tokens.expiresAt && new Date(tokens.expiresAt).getTime() > Date.now() + 60000)
            return tokens;
        if (!tokens.refreshToken)
            throw appError('analytics_reconnect_required', 401, 'Analytics authorization must be renewed');
        return this.token({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, tokens,signal);
    }
    async resources(tokens: AdsTokens,parent?:AbortSignal): Promise<AnalyticsResource[]> {
        const controller=new AbortController();
        const signal=AbortSignal.any([AbortSignal.timeout(90000),controller.signal,...(parent?[parent]:[])]);
        const ids = new Set<string>();
        let next = '';
        const seen = new Set<string>();
        for (let page = 0; page < 50; page++) {
            const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
            url.searchParams.set('pageSize', '200');
            if (next)
                url.searchParams.set('pageToken', next);
            const body = await json(this.fetcher, url, { signal,headers: { Authorization: `Bearer ${tokens.accessToken}` } });
            if (!Array.isArray(body.accountSummaries ?? []))
                throw invalid();
            for (const account of body.accountSummaries ?? []) {
                if (!Array.isArray(account.propertySummaries ?? []))
                    throw invalid();
                for (const prop of account.propertySummaries ?? []) {
                    if (typeof prop.property !== 'string' || !/^properties\/[0-9]+$/.test(prop.property))
                        throw invalid();
                    ids.add(prop.property.slice(11));
                    if (ids.size > 500)
                        throw appError('analytics_page_limit', 502, 'Analytics resource limit exceeded');
                }
            }
            next = body.nextPageToken ?? '';
            if (typeof next !== 'string' || seen.has(next) && next)
                throw invalid();
            if (!next)
                break;
            seen.add(next);
            if (page === 49)
                throw appError('analytics_page_limit', 502, 'Analytics resource limit exceeded');
        }
        const resources: AnalyticsResource[] = [];
        const properties=[...ids];let nextProperty=0;
        const worker=async()=>{while(nextProperty<properties.length){const index=nextProperty++;const id=properties[index]!;
            const prop = await json(this.fetcher, `https://analyticsadmin.googleapis.com/v1beta/properties/${id}`, { signal,headers: { Authorization: `Bearer ${tokens.accessToken}` } });
            if (prop.name !== `properties/${id}` || typeof prop.displayName !== 'string' || typeof prop.timeZone !== 'string')
                throw invalid();
            try {
                new Intl.DateTimeFormat('en', { timeZone: prop.timeZone });
            }
            catch {
                throw invalid();
            }
            resources[index]={ id, name: prop.displayName, timeZone: prop.timeZone, ...(typeof prop.currencyCode === 'string' && /^[A-Z]{3}$/.test(prop.currencyCode) ? { currency: prop.currencyCode } : {}) };
        }};
        try{await Promise.all(Array.from({length:Math.min(5,properties.length)},()=>worker()));}catch(error){controller.abort();throw error;}
        return resources;
    }
    private async rows(tokens: AdsTokens, id: string, from: string, to: string, dimensions: string[], warnings: Set<string>,signal:AbortSignal): Promise<{
        d: string[];
        m: number[];
    }[]> {
        if (!/^[0-9]+$/.test(id))
            throw invalid();
        const metrics = ['sessions', 'engagedSessions', 'screenPageViews', 'keyEvents'];
        const rows: {
            d: string[];
            m: number[];
        }[] = [];
        let offset = 0;
        let count: number | undefined;
        for (let page = 0; page < 50; page++) {
            const body = await json(this.fetcher, `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, { signal,method: 'POST', headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ dimensions: dimensions.map(name => ({ name })), metrics: metrics.map(name => ({ name })), dateRanges: [{ startDate: from, endDate: to }], limit: '10000', offset: String(offset), orderBys: dimensions.map(dimensionName => ({ dimension: { dimensionName } })), returnPropertyQuota: true }) });
            if (!Array.isArray(body.dimensionHeaders) || body.dimensionHeaders.map((h: any) => h.name).join('|') !== dimensions.join('|') || !Array.isArray(body.metricHeaders) || body.metricHeaders.map((h: any) => h.name).join('|') !== metrics.join('|') || !Array.isArray(body.rows ?? []))
                throw invalid();
            const declared = number(body.rowCount ?? 0);
            if (!Number.isInteger(declared) || count !== undefined && declared !== count)
                throw invalid();
            count = declared;
            if (body.metadata?.subjectToThresholding)
                warnings.add('analytics_thresholded');
            if (body.metadata?.samplingMetadatas?.length)
                warnings.add('analytics_sampled');
            if (body.metadata?.dataLossFromOtherRow)
                warnings.add('analytics_other_row');
            for (const row of body.rows ?? []) {
                if (!Array.isArray(row.dimensionValues) || row.dimensionValues.length !== dimensions.length || !Array.isArray(row.metricValues) || row.metricValues.length !== 4)
                    throw invalid();
                const d = row.dimensionValues.map((v: any) => {
                    if (typeof v.value !== 'string' || v.value.length > 1000)
                        throw invalid();
                    return v.value;
                });
                if (!/^\d{8}$/.test(d[0]))
                    throw invalid();
                rows.push({ d, m: row.metricValues.map((v: any) => number(v.value)) });
            }
            offset = rows.length;
            if (offset === count)
                return rows;
            if (!body.rows?.length || offset > count)
                throw invalid();
        }
        throw appError('analytics_page_limit', 502, 'Analytics report limit exceeded');
    }
    async report(tokens: AdsTokens, id: string, from: string, to: string,parent?:AbortSignal): Promise<AnalyticsBatch> {
        const signal=parent?AbortSignal.any([parent,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
        const warnings = new Set<string>();
        const global = await this.rows(tokens, id, from, to, ['date'], warnings,signal);
        const channels = await this.rows(tokens, id, from, to, ['date', 'sessionSource', 'sessionMedium'], warnings,signal);
        const campaigns = await this.rows(tokens, id, from, to, ['date', 'sessionManualCampaignName'], warnings,signal);
        const campaignChannels = await this.rows(tokens, id, from, to, ['date', 'sessionManualCampaignName', 'sessionSource', 'sessionMedium'], warnings,signal);
        const date = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        const daily = global.map(r => ({ date: date(r.d[0]!), sessions: r.m[0]!, engagedSessions: r.m[1]!, pageViews: r.m[2]!, keyEvents: r.m[3]! }));
        if (daily.some(d => d.date < from || d.date > to) || new Set(daily.map(d => d.date)).size !== daily.length)
            throw invalid();
        const aggregate = { ...totals(), engagedSessions: 0, pageViews: 0, keyEvents: 0 };
        for (const d of daily) {
            aggregate.sessions += d.sessions;
            aggregate.engagedSessions += d.engagedSessions;
            aggregate.pageViews += d.pageViews;
            aggregate.keyEvents += d.keyEvents;
        }
        return { totals: aggregate, daily, channels: channels.map(r => ({ date: date(r.d[0]!), source: r.d[1]!, medium: r.d[2]!, sessions: r.m[0]! })), campaigns: campaigns.map(r => ({ date: date(r.d[0]!), utmCampaign: r.d[1]!, sessions: r.m[0]!, engagedSessions: r.m[1]!, pageViews: r.m[2]!, keyEvents: r.m[3]! })), campaignChannels: campaignChannels.map(r => ({ date: date(r.d[0]!), utmCampaign: r.d[1]!, source: r.d[2]!, medium: r.d[3]!, sessions: r.m[0]! })), warnings: [...warnings], window: null };
    }
}
export class ClarityClient implements ClarityProviderClient {
    constructor(private fetcher: typeof fetch = fetch) {
    }
    async report(token: string, reserve?: (calls: number) => Promise<void>): Promise<AnalyticsBatch> {
        const end = new Date();
        const start = new Date(end.getTime() - 86400000);
        const warnings = new Set<string>(['analytics_clarity_rolling_window', 'analytics_clarity_project_label_unverified']);
        const call = async (segmented: boolean) => {
            await reserve?.(1);
            const url = new URL('https://www.clarity.ms/export-data/api/v1/project-live-insights');
            url.searchParams.set('numOfDays', '1');
            if (segmented) {
                url.searchParams.set('dimension1', 'Campaign');
                url.searchParams.set('dimension2', 'Source');
                url.searchParams.set('dimension3', 'Medium');
            }
            const body = await json(this.fetcher, url, { headers: { Authorization: `Bearer ${token}` } });
            if (!Array.isArray(body) || body.length > 100)
                throw invalid();
            for (const metric of body) {
                if (typeof metric.metricName !== 'string' || !Array.isArray(metric.information) || metric.information.length > 1000)
                    throw invalid();
                if (metric.information.length === 1000)
                    warnings.add('analytics_clarity_row_limit');
            }
            return body as {
                metricName: string;
                information: Record<string, unknown>[];
            }[];
        };
        const global = await call(false);
        const traffic = global.find(m => m.metricName === 'Traffic');
        if (!traffic || traffic.information.length !== 1)
            throw invalid();
        const aggregate = totals(number(traffic.information[0]!.totalSessionCount));
        const bots = traffic.information[0]!.totalBotSessionCount;
        aggregate.botSessions = bots === undefined ? null : number(bots);
        // The documented export does not define friction field units. Never present
        // affected-session counts as click counts or infer unknown metrics as zero.
        warnings.add('analytics_clarity_friction_unavailable');
        const segmented = await call(true);
        const segments = segmented.find(m => m.metricName === 'Traffic');
        if (!segments)
            throw invalid();
        const channels: {
            source: string;
            medium: string;
            sessions: number;
            utmCampaign: string;
        }[] = [];
        const campaigns = new Map<string, number>();
        for (const row of segments.information) {
            // Clarity sends explicit null dimensions for unattributed visits.
            // Missing fields and other types still indicate malformed data.
            if (![row.Campaign, row.Source, row.Medium].every(value => value === null || typeof value === 'string'))
                throw invalid();
            const sessions = number(row.totalSessionCount);
            const utmCampaign = row.Campaign === null ? '' : row.Campaign as string;
            channels.push({ utmCampaign, source: row.Source === null ? '(not set)' : row.Source as string, medium: row.Medium === null ? '(not set)' : row.Medium as string, sessions });
            if (utmCampaign)
                campaigns.set(utmCampaign, (campaigns.get(utmCampaign) ?? 0) + sessions);
        }
        return { totals: aggregate, daily: [], channels, campaigns: [...campaigns].map(([utmCampaign, sessions]) => ({ utmCampaign, sessions })), campaignChannels: [], warnings: [...warnings], window: { from: start.toISOString(), to: end.toISOString() } };
    }
}
