import { describe, it, expect, vi } from 'vitest';
import { Ga4Client, ClarityClient } from './providers.js';
const config = { clientId: 'example', clientSecret: 'private', redirectUri: 'http://127.0.0.1:8088/api/ads/oauth/google/callback', apiVersion: 'v25', scopes: [] };
const tokens = { accessToken: 'private-token', refreshToken: 'refresh', scopes: ['https://www.googleapis.com/auth/analytics.readonly'] };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
describe('analytics provider boundary', () => {
    it('limits resource metadata fetches to five concurrent requests under one overall deadline',async()=>{
        let active=0,maximum=0;const signals:AbortSignal[]=[];
        const fetcher=vi.fn(async(url:unknown,init:any)=>{
            signals.push(init.signal);
            if(String(url).includes('accountSummaries'))return response({accountSummaries:[{propertySummaries:Array.from({length:12},(_,i)=>({property:`properties/${i+1}`}))}]});
            active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,5));active--;
            const id=String(url).split('/').at(-1);return response({name:`properties/${id}`,displayName:`Site ${id}`,timeZone:'UTC'});
        });
        expect(await new Ga4Client(config,fetcher).resources(tokens)).toHaveLength(12);
        expect(maximum).toBe(5);expect(new Set(signals).size).toBe(1);
    });
    it('stops the remaining GA4 datasets when the parent deadline aborts after the first report',async()=>{
        const controller=new AbortController();const fetcher=vi.fn(async(_url:unknown,init:any)=>{const body=JSON.parse(init.body);controller.abort();return response({dimensionHeaders:body.dimensions,metricHeaders:body.metrics,rowCount:0,rows:[]});});
        await expect(new Ga4Client(config,fetcher).report(tokens,'123','2026-09-01','2026-09-01',controller.signal)).rejects.toMatchObject({code:'analytics_provider_unavailable'});
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('shares one overall deadline across all GA4 reports',async()=>{
        const signals:AbortSignal[]=[];
        const fetcher=vi.fn(async(_url:unknown,init:any)=>{signals.push(init.signal);const body=JSON.parse(init.body);return response({dimensionHeaders:body.dimensions,metricHeaders:body.metrics,rowCount:0,rows:[]});});
        await new Ga4Client(config,fetcher).report(tokens,'123','2026-09-01','2026-09-01');
        expect(new Set(signals).size).toBe(1);
    });
    it('honors an aborted parent deadline before issuing another resource request',async()=>{
        const controller=new AbortController();controller.abort();const fetcher=vi.fn();
        await expect(new Ga4Client(config,fetcher).resources(tokens,controller.signal)).rejects.toMatchObject({code:'analytics_provider_unavailable'});
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('distinguishes a disabled Google API and invalid grant without returning raw messages', async () => {
        const disabled = new Ga4Client(config, vi.fn().mockResolvedValue(response({ error: { details: [{ reason: 'SERVICE_DISABLED' }], message: 'secret' } }, 403)));
        await expect(disabled.resources(tokens)).rejects.toMatchObject({ code: 'analytics_api_disabled' });
        const expired = new Ga4Client(config, vi.fn().mockResolvedValue(response({ error: 'invalid_grant', error_description: 'secret' }, 400)));
        await expect(expired.refresh({ ...tokens, expiresAt: '2020-01-01T00:00:00Z' })).rejects.toMatchObject({ code: 'analytics_reconnect_required' });
    });
    it('Clarity keeps the documented bot count separate from all sessions', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(response([{ metricName: 'Traffic', information: [{ totalSessionCount: '20', totalBotSessionCount: '4' }] }])).mockResolvedValueOnce(response([{ metricName: 'Traffic', information: [] }]));
        const result = await new ClarityClient(fetcher).report('private-token');
        expect(result.totals).toMatchObject({ sessions: 20, botSessions: 4 });
    });
    it('rejects whitespace and non-decimal provider numbers instead of interpreting missing values as zero', async () => {
        for (const totalSessionCount of ['   ', '0x10', 'NaN', '-1']) {
            const fetcher = vi.fn().mockResolvedValueOnce(response([{ metricName: 'Traffic', information: [{ totalSessionCount }] }]));
            await expect(new ClarityClient(fetcher).report('token')).rejects.toMatchObject({ code: 'analytics_invalid_response' });
        }
    });
    it('validates each fetched property identity against the authorized account summary', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(response({ accountSummaries: [{ propertySummaries: [{ property: 'properties/123' }] }] })).mockResolvedValueOnce(response({ name: 'properties/999', displayName: 'Unexpected', timeZone: 'UTC' }));
        await expect(new Ga4Client(config, fetcher).resources(tokens)).rejects.toMatchObject({ code: 'analytics_invalid_response' });
    });
    it('uses read-only offline PKCE OAuth and the installed callback', () => {
        const url = new URL(new Ga4Client(config).authorizationUrl('state', 'verifier'));
        expect(url.origin).toBe('https://accounts.google.com');
        expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/analytics.readonly');
        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    });
    it('paginates account summaries and reads timezone from each property', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(response({ accountSummaries: [{ propertySummaries: [{ property: 'properties/123', displayName: 'Site' }] }], nextPageToken: 'next' })).mockResolvedValueOnce(response({ accountSummaries: [] })).mockResolvedValueOnce(response({ name: 'properties/123', displayName: 'Site', timeZone: 'America/Sao_Paulo', currencyCode: 'BRL' }));
        expect(await new Ga4Client(config, fetcher).resources(tokens)).toEqual([{ id: '123', name: 'Site', timeZone: 'America/Sao_Paulo', currency: 'BRL' }]);
        expect(String(fetcher.mock.calls[1]![0])).toContain('pageToken=next');
    });
    it('rejects malformed responses and does not leak provider errors', async () => {
        const client = new Ga4Client(config, vi.fn().mockResolvedValue(response({ error: { message: 'private-token' } }, 403)));
        await expect(client.resources(tokens)).rejects.toMatchObject({ code: 'analytics_permission_required', message: 'Analytics permission is required' });
    });
    it('reports date totals and exact manual campaign attribution with independent totals', async () => {
        const fetcher = vi.fn(async (_url: unknown, init: any) => {
            const body = JSON.parse(init.body);
            const dims = body.dimensions.map((d: any) => d.name);
            return response({ dimensionHeaders: dims.map((name: string) => ({ name })), metricHeaders: ['sessions', 'engagedSessions', 'screenPageViews', 'keyEvents'].map(name => ({ name })), rowCount: 1, rows: [{ dimensionValues: dims.map((name: string) => ({ value: name === 'date' ? '20260929' : name === 'sessionManualCampaignName' ? 'launch' : name === 'sessionSource' ? 'google' : 'cpc' })), metricValues: ['10', '6', '20', '1'].map(value => ({ value })) }], metadata: { subjectToThresholding: true } });
        });
        const result = await new Ga4Client(config, fetcher).report(tokens, '123', '2026-09-29', '2026-09-29');
        expect(result.daily[0]).toMatchObject({ date: '2026-09-29', sessions: 10, pageViews: 20 });
        expect(result.campaigns[0]).toMatchObject({ utmCampaign: 'launch', sessions: 10 });
        expect(result.warnings).toContain('analytics_thresholded');
        expect(fetcher).toHaveBeenCalledTimes(4);
    });
    it('rejects incomplete pagination instead of replacing known data with zero', async () => {
        const headers = { dimensionHeaders: [{ name: 'date' }], metricHeaders: ['sessions', 'engagedSessions', 'screenPageViews', 'keyEvents'].map(name => ({ name })) };
        const fetcher = vi.fn().mockResolvedValue(response({ ...headers, rowCount: 2, rows: [] }));
        await expect(new Ga4Client(config, fetcher).report(tokens, '123', '2026-09-29', '2026-09-29')).rejects.toMatchObject({ code: 'analytics_invalid_response' });
    });
    it('Clarity requests a 24h window and preserves unknown fields as null', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(response([{ metricName: 'Traffic', information: [{ totalSessionCount: '9' }] }])).mockResolvedValueOnce(response([{ metricName: 'Traffic', information: [] }]));
        const result = await new ClarityClient(fetcher).report('private-token');
        expect(result.totals.sessions).toBe(9);
        expect(result.totals.rageClicks).toBeNull();
        expect(result.daily).toEqual([]);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(String(fetcher.mock.calls[0]![0])).toContain('numOfDays=1');
        expect(String(fetcher.mock.calls[1]![0])).toContain('dimension1=Campaign');
    });
    it('Clarity rejects absent traffic and warns at its unpageable row limit', async () => {
        await expect(new ClarityClient(vi.fn().mockResolvedValue(response([]))).report('token')).rejects.toMatchObject({ code: 'analytics_invalid_response' });
        const rows = Array.from({ length: 1000 }, () => ({ Campaign: 'x', Source: 's', Medium: 'm', totalSessionCount: '1' }));
        const fetcher = vi.fn().mockResolvedValueOnce(response([{ metricName: 'Traffic', information: [{ totalSessionCount: '1000' }] }])).mockResolvedValueOnce(response([{ metricName: 'Traffic', information: rows }]));
        expect((await new ClarityClient(fetcher).report('token')).warnings).toContain('analytics_clarity_row_limit');
    });
});
