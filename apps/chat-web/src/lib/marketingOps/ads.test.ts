import { describe, expect, it, vi } from 'vitest';
import { createAdsClient, safeAuthorizationUrl, callbackMessage, defaultAdsPeriod, validAdsPeriod, compatibleSources, adsMessages } from './ads';
import type { LeadSource } from './leads';

describe('Ads BFF contract', () => {
  it('explains a provider access denial instead of suggesting a transient provider outage', () => {
    expect(adsMessages.ads_permission_required).toBe('O provedor recusou o acesso. Confira se sua conta de anúncios está configurada e se o usuário autorizado tem acesso a ela.');
  });
  it('reads setup metadata and saves credentials with an observed version and stable proposal key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: { provider: 'meta', hasClientSecret: true } }));
    const client = createAdsClient({ fetch });
    await client.setup('meta');
    const input = { clientId: '123', clientSecret: 'entered-secret', apiVersion: 'v23.0', scopes: ['ads_read'], metaLoginConfigId: '456' };
    await client.saveSetup('meta', input, 1, 'proposal');
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe('/api/marketing/ads-integrations/meta/setup');
    expect(new Headers(init?.headers).get('If-Match')).toBe('"1"');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('proposal');
    expect(init?.credentials).toBe('same-origin');
    expect(JSON.parse(init?.body as string)).toEqual(input);
  });
  it.each(['forbidden', 'version_conflict', 'idempotency_conflict', 'ads_setup_confirmation_required', 'ads_setup_secret_required', 'ads_setup_storage_unavailable', 'ads_setup_origin_required', 'connection_changed', 'oauth_state_invalid'])('maps %s to safe guidance without exposing provider details', async code => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ error: { code, message: 'provider-secret-detail' } }, { status: 409 }));
    await expect(createAdsClient({ fetch }).saveSetup('google', { clientId: 'client', apiVersion: 'v25', scopes: ['https://www.googleapis.com/auth/adwords'] }, 1, 'proposal')).rejects.toMatchObject({ code, message: expect.not.stringContaining('provider-secret-detail') });
  });
  it('uses the session and observed version without adding tenant authority', async () => {
    const fetch = vi.fn(async () => Response.json({ data: { version: 3 } }));
    await createAdsClient({ fetch }).selectAccount('google', 'account', 2);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/marketing/ads-integrations/google/account');
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('If-Match')).toBe('"2"');
    expect(new Headers(init.headers).get('x-tenant-id')).toBeNull();
    expect(JSON.parse(init.body as string)).toEqual({ accountId: 'account' });
  });
  it('retains a supplied proposal key when retrying synchronization', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({ error: { code: 'ads_rate_limited', message: 'token secret' } }, { status: 429 })).mockResolvedValueOnce(Response.json({ data: { days: 2 } }));
    const client = createAdsClient({ fetch }); const period = { from: '2026-09-01', to: '2026-09-02' };
    await expect(client.sync('campaign', 'link', period, 'proposal')).rejects.toMatchObject({ code: 'ads_rate_limited', message: expect.not.stringContaining('secret') });
    await client.sync('campaign', 'link', period, 'proposal');
    expect(fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'))).toEqual(['proposal', 'proposal']);
  });
  it('accepts only the requested provider HTTPS authorization endpoint', () => {
    expect(safeAuthorizationUrl('google', 'https://accounts.google.com/o/oauth2/v2/auth?state=s')).toContain('accounts.google.com');
    expect(safeAuthorizationUrl('meta', 'https://www.facebook.com/v23.0/dialog/oauth')).toContain('facebook.com');
    expect(safeAuthorizationUrl('linkedin', 'https://www.linkedin.com/oauth/v2/authorization')).toContain('linkedin.com');
    for (const url of ['http://accounts.google.com/o/oauth2/v2/auth', 'https://accounts.google.com.evil.test/o/oauth2/v2/auth', 'https://accounts.google.com/other', 'https://u:p@accounts.google.com/o/oauth2/v2/auth', 'https://accounts.google.com:444/o/oauth2/v2/auth', 'https://www.linkedin.com/oauth/v2/authorization']) expect(() => safeAuthorizationUrl('google', url)).toThrow();
  });
  it('never calls a received OAuth callback a connected advertising account', () => {
    expect(callbackMessage('meta', 'connected')).toBe('Autorização recebida. Escolha sua conta.');
    expect(callbackMessage('unknown', 'connected')).toBeNull();
    expect(callbackMessage('meta', 'unknown')).toBeNull();
  });
  it('defaults to seven closed days in the account timezone and rejects oversized or future periods', () => {
    const now = Date.parse('2026-10-01T01:00:00Z');
    expect(defaultAdsPeriod('America/Sao_Paulo', now)).toEqual({ from: '2026-09-23', to: '2026-09-29' });
    expect(validAdsPeriod({ from: '2026-09-01', to: '2026-09-30' }, now)).toBe(true);
    expect(validAdsPeriod({ from: '2026-08-31', to: '2026-09-30' }, now)).toBe(false);
    expect(validAdsPeriod({ from: '2026-10-02', to: '2026-10-02' }, now)).toBe(false);
    expect(validAdsPeriod({ from: '2026-02-30', to: '2026-03-01' }, now)).toBe(false);
  });
  it('offers only enabled lead sources matching provider, explicit account, campaign and destination', () => {
    const source = { id: 'good', enabled: true, classification: 'lead', channel: 'meta_ads', kind: 'manual' } as LeadSource;
    const rows = [source, { ...source, id: 'cold', classification: 'cold' }, { ...source, id: 'disabled', enabled: false }, { ...source, id: 'account', externalAccountId: 'different' }, { ...source, id: 'campaign', externalCampaignId: 'other' }, { ...source, id: 'landing', kind: 'landing_page' } ] as LeadSource[];
    expect(compatibleSources(rows, 'meta', 'selected', 'external', 'native_form').map(row => row.id)).toEqual(['good']);
  });
});
