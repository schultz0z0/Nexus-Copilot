import { describe, expect, it, vi } from 'vitest';
import { createAdsProviderClient } from './providers.js';
import type { AdsProviderConfig } from './types.js';
import { createLogger } from '../../observability/logger.js';
const config: AdsProviderConfig = { clientId: 'local-client', clientSecret: 'local-secret', redirectUri: 'http://127.0.0.1:8088/api/ads/oauth/google/callback', apiVersion: 'v25', scopes: ['https://www.googleapis.com/auth/adwords'] };
const tokens = { accessToken: 'local-access', refreshToken: 'local-refresh', scopes: config.scopes };
describe('official Ads HTTP clients', () => {
  it('retains the fixed Google denial code through the real redacting logger', async () => {
    const entries: Record<string, unknown>[] = [];
    const http = vi.fn(async () => Response.json({ error: { message: 'private-token', details: [{ errors: [{ errorCode: { authenticationError: 'NOT_ADS_USER' }, message: 'private-id' }] }] } }, { status: 403 }));
    await expect(createAdsProviderClient('google', config, http, createLogger(entry => entries.push(entry))).accounts(tokens)).rejects.toMatchObject({ code: 'ads_permission_required' });
    expect(entries[0]!.data).toMatchObject({ accessCode: 'NOT_ADS_USER' });
    expect(JSON.stringify(entries)).not.toContain('private');
  });
  it('logs the specific allowlisted Google access denial without exposing provider data', async () => {
    const warn = vi.fn();
    const http = vi.fn(async () => Response.json({ error: { message: 'private-token private-account', details: [{ errors: [{ errorCode: { authenticationError: 'NOT_ADS_USER' }, message: 'private-message', trigger: { stringValue: 'private-id' } }], requestId: 'private-request' }] } }, { status: 403 }));
    await expect(createAdsProviderClient('google', config, http, { warn }).accounts(tokens)).rejects.toMatchObject({ code: 'ads_permission_required' });
    expect(warn).toHaveBeenCalledWith('Ads provider request failed', { provider: 'google', operation: 'account_discovery', httpStatus: 403, accessCode: 'NOT_ADS_USER' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  });
  it('does not log arbitrary Google error codes or metadata from an access denial', async () => {
    const warn = vi.fn();
    const http = vi.fn(async () => Response.json({ error: { message: 'private-token', details: [{ reason: 'private-reason', metadata: { accessToken: 'private-token' }, errors: [{ errorCode: { authorizationError: 'private-reason' } }] }] } }, { status: 403 }));
    await expect(createAdsProviderClient('google', config, http, { warn }).accounts(tokens)).rejects.toMatchObject({ code: 'ads_permission_required' });
    expect(warn).toHaveBeenCalledWith('Ads provider request failed', { provider: 'google', operation: 'account_discovery', httpStatus: 403, accessCode: 'UNCLASSIFIED' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  });
  it('recognizes Google Cloud API access failures separately from user access failures', async () => {
    const warn = vi.fn();
    const http = vi.fn(async () => Response.json({ error: { details: [{ errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' } }] }] } }, { status: 403 }));
    await expect(createAdsProviderClient('google', config, http, { warn }).accounts(tokens)).rejects.toMatchObject({ code: 'ads_permission_required' });
    expect(warn.mock.calls[0]![1]).toMatchObject({ accessCode: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' });
  });
  it('addresses Google account discovery through the versioned HTTPS API despite the method colon', async () => {
    const http = vi.fn(async (_input: string | URL, _init?: RequestInit) => Response.json({ resourceNames: [] }));
    const accounts = await createAdsProviderClient('google', config, http).accounts(tokens);
    expect(accounts).toEqual([]);
    expect(String(http.mock.calls[0]![0])).toBe('https://googleads.googleapis.com/v25/customers:listAccessibleCustomers');
    expect(new Headers(http.mock.calls[0]![1]?.headers).get('authorization')).toBe('Bearer local-access');
  });
  it('includes the final millisecond of a LinkedIn lead window and excludes the next day', async () => {
    const li = { ...config, apiVersion: '202608', scopes: ['r_marketing_leadgen_automation'] };
    const http = vi.fn(async (input: string | URL) => {
      const url = new URL(input);
      if (url.pathname.includes('/leadForms/')) return Response.json({ versionId: 1, content: { questions: [{ questionId: 1, predefinedField: 'EMAIL' }] } });
      const end = Number(url.searchParams.get('submittedAt')?.match(/end:(\d+)/)?.[1]);
      const rows = ['2026-09-28T23:59:59.999Z', '2026-09-29T00:00:00.000Z'].filter(stamp => Date.parse(stamp) <= end).map((stamp, index) => ({ id: `boundary-${index}`, owner: { sponsoredAccount: 'urn:li:sponsoredAccount:42' }, leadMetadata: { sponsoredLeadMetadata: { campaign: 'urn:li:sponsoredCampaign:99' } }, submittedAt: Date.parse(stamp), versionedLeadGenFormUrn: 'urn:li:versionedLeadGenForm:(urn:li:leadGenForm:123,1)', formResponse: { answers: [{ questionId: 1, answerDetails: { textQuestionAnswer: { answer: `boundary${index}@example.test` } } }] } }));
      return Response.json({ elements: rows });
    });
    const rows = await createAdsProviderClient('linkedin', li, http).leads({ ...tokens, scopes: li.scopes }, { id: '42', name: 'Company', currency: 'BRL', timeZone: 'UTC' }, '99', '2026-09-28', '2026-09-28');
    expect(rows.map(row => row.occurredAt)).toEqual(['2026-09-28T23:59:59.999Z']);
  });
  it('uses Google PKCE, offline consent and secrets only in the token POST', async () => {
    const http = vi.fn(async (_url: string | URL, _init?: RequestInit) => Response.json({ access_token: 'accepted-token', expires_in: 3600, refresh_token: 'refresh', scope: config.scopes[0] }));
    const client = createAdsProviderClient('google', config, http);
    const url = new URL(client.authorizationUrl('opaque-state', 'v'.repeat(64)));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.toString()).not.toContain('local-secret');
    await client.exchange('code', 'v'.repeat(64));
    expect(http.mock.calls[0]![0]).toBe('https://oauth2.googleapis.com/token');
    expect(http.mock.calls[0]![1]?.method).toBe('POST');
    expect(String(http.mock.calls[0]![1]?.body)).toContain('code_verifier=');
  });
  it('keeps provider conversions separate from sales and converts micros once', async () => {
    const http = vi.fn(async () => Response.json([{ results: [{ segments: { date: '2026-09-28' }, metrics: { costMicros: '1500500', impressions: '20', clicks: '3', conversions: 1.25 } }] }]));
    const rows = await createAdsProviderClient('google', config, http).dailyMetrics(tokens, { id: '1234567890', name: 'Account', currency: 'BRL', timeZone: 'America/Sao_Paulo' }, '42', '2026-09-28', '2026-09-28');
    expect(rows).toEqual([{ date: '2026-09-28', currency: 'BRL', timeZone: 'America/Sao_Paulo', spend: 1.5, impressions: 20, clicks: 3, conversions: 1.25 }]);
    expect(rows[0]).not.toHaveProperty('sales');
  });
  it('does not follow foreign pagination URLs or expose raw provider errors', async () => {
    const meta = { ...config, apiVersion: 'v24.0', scopes: ['ads_read'] };
    const http = vi.fn(async () => Response.json({ data: [], paging: { next: 'https://attacker.example/?access_token=local-access' } }));
    await expect(createAdsProviderClient('meta', meta, http).accounts(tokens)).rejects.toMatchObject({ code: 'ads_invalid_response' });
    expect(http).toHaveBeenCalledTimes(1);
    const fail = vi.fn(async () => Response.json({ error: { message: 'local-access secret payload' } }, { status: 401 }));
    await expect(createAdsProviderClient('google', config, fail).accounts(tokens)).rejects.toMatchObject({ code: 'ads_reconnect_required', message: 'A autorização do provedor precisa ser renovada.' });
  });
  it('preserves the existing refresh token when Google omits it on rotation', async () => {
    const http = vi.fn(async () => Response.json({ access_token: 'new', expires_in: 3600 }));
    expect((await createAdsProviderClient('google', config, http).refresh(tokens)).refreshToken).toBe('local-refresh');
  });
  it('turns revoked OAuth grants and Meta token errors into reconnect states without exposing secrets', async () => {
    for (const body of [{ error: 'invalid_grant', error_description: 'private-code' }, { error: { code: 190, message: 'private-access' } }]) {
      const http = vi.fn(async () => Response.json(body, { status: 400 }));
      await expect(createAdsProviderClient('google', config, http).refresh(tokens)).rejects.toMatchObject({ code: 'ads_reconnect_required' });
    }
  });
  it('reads LinkedIn leads over offset pages even when next links are omitted', async () => {
    const li = { ...config, apiVersion: '202608', scopes: ['r_ads', 'r_ads_reporting', 'r_marketing_leadgen_automation'] };
    const calls: URL[] = [];
    const http = vi.fn(async (input: string | URL) => {
      const url = new URL(input); calls.push(url);
      if (url.pathname.includes('/leadForms/')) return Response.json({ versionId: 1, content: { questions: [{ questionId: 1, predefinedField: 'EMAIL' }] } });
      const start = Number(url.searchParams.get('start') || 0);
      return Response.json({ elements: [{ id: `lead-${start}`, owner: { sponsoredAccount: 'urn:li:sponsoredAccount:42' }, leadMetadata: { sponsoredLeadMetadata: { campaign: 'urn:li:sponsoredCampaign:99' } }, submittedAt: Date.parse('2026-09-28T12:00:00Z'), versionedLeadGenFormUrn: 'urn:li:versionedLeadGenForm:(urn:li:leadGenForm:6755260984438374400,1)', formResponse: { answers: [{ questionId: 1, answerDetails: { textQuestionAnswer: { answer: `person${start}@example.test` } } }] } }], paging: { start, count: 1, total: 2, links: [] } });
    });
    const rows = await createAdsProviderClient('linkedin', li, http).leads({ ...tokens, scopes: li.scopes }, { id: '42', name: 'Company', currency: 'BRL', timeZone: 'UTC' }, '99', '2026-09-28', '2026-09-28');
    expect(rows.map(row => row.externalId)).toEqual(['lead-0', 'lead-1']);
    expect(calls.filter(url => url.pathname.includes('/leadForms/'))).toHaveLength(1);
    expect(calls.find(url => url.pathname.includes('/leadForms/'))?.pathname).toContain('6755260984438374400');
  });
  it('reads Meta daily spend without inventing conversions and signs server requests', async () => {
    const meta = { ...config, apiVersion: 'v26.0', scopes: ['ads_read'], loginConfigId: '123' };
    const http = vi.fn(async (_url: string | URL, _init?: RequestInit) => Response.json({ data: [{ date_start: '2026-09-28', spend: '35.47', impressions: '1000', clicks: '21', account_currency: 'BRL' }] }));
    const rows = await createAdsProviderClient('meta', meta, http).dailyMetrics(tokens, { id: '42', name: 'Company', currency: 'BRL', timeZone: 'America/Sao_Paulo' }, '99', '2026-09-28', '2026-09-28');
    expect(rows[0]).toMatchObject({ spend: 35.47, impressions: 1000, clicks: 21, conversions: null });
    const url = new URL(http.mock.calls[0]![0]);
    expect(url.searchParams.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.has('access_token')).toBe(false);
  });
  it('reads LinkedIn reports in their currency and UTC without turning conversions into sales', async () => {
    const li = { ...config, apiVersion: '202608', scopes: ['r_ads', 'r_ads_reporting'] };
    const http = vi.fn(async (_url: string | URL, _init?: RequestInit) => Response.json({ elements: [{ dateRange: { start: { year: 2026, month: 9, day: 28 } }, costInLocalCurrency: '10.23', impressions: 42, clicks: 3, externalWebsiteConversions: 2 }] }));
    const rows = await createAdsProviderClient('linkedin', li, http).dailyMetrics(tokens, { id: '42', name: 'Company', currency: 'USD', timeZone: 'UTC' }, '99', '2026-09-28', '2026-09-28');
    expect(rows[0]).toMatchObject({ currency: 'USD', timeZone: 'UTC', spend: 10.23, conversions: 2 });
    const url = new URL(http.mock.calls[0]![0]);
    expect(url.searchParams.get('campaigns')).toBe('List(urn:li:sponsoredCampaign:99)');
    expect(new Headers(http.mock.calls[0]![1]?.headers).get('LinkedIn-Version')).toBe('202608');
  });
  it('finds usable Google child accounts and retains their manager authorization path', async () => {
    const http = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname.endsWith('listAccessibleCustomers')) return Response.json({ resourceNames: ['customers/1234567890'] });
      const query = JSON.parse(String(init?.body)).query;
      return Response.json([{ results: query.includes('FROM customer_client')
        ? [{ customerClient: { clientCustomer: 'customers/9876543210', descriptiveName: 'Company', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', manager: false } }]
        : [{ customer: { descriptiveName: 'Manager', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', manager: true } }] }]);
    });
    const accounts = await createAdsProviderClient('google', config, http).accounts(tokens);
    expect(http.mock.calls.map(([input]) => String(input))).toEqual([
      'https://googleads.googleapis.com/v25/customers:listAccessibleCustomers',
      'https://googleads.googleapis.com/v25/customers/1234567890/googleAds:searchStream',
      'https://googleads.googleapis.com/v25/customers/1234567890/googleAds:searchStream',
    ]);
    expect(accounts.find(row => row.id === '9876543210')).toMatchObject({ name: 'Company', manager: false, loginCustomerId: '1234567890' });
    expect(new Headers(http.mock.calls[2]![1]?.headers).get('login-customer-id')).toBe('1234567890');
  });
});
