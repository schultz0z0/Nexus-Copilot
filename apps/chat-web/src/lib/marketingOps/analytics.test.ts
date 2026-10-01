import { describe, expect, it, vi } from 'vitest';
import { createAnalyticsClient, analyticsCallbackMessage, validAnalyticsPeriod } from './analytics';

describe('Native web analytics client', () => {
  it('uses BFF credentials, version and idempotency without adding token to any URL', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: {} }));
    await createAnalyticsClient({ fetch }).connectClarity({ token: 'private-project-token', projectId: 'project1', projectName: 'Site' }, 4, 'proposal');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/marketing/web-analytics/clarity/connect');
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('If-Match')).toBe('"4"');
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('proposal');
    expect(url).not.toContain('private');
  });
  it('turns raw external errors into a useful safe message', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: 'analytics_permission_required', message: 'private OAuth token' } }, { status: 403 }));
    await expect(createAnalyticsClient({ fetch }).resources()).rejects.toMatchObject({ code: 'analytics_permission_required', status: 403 });
    await expect(createAnalyticsClient({ fetch }).resources()).rejects.not.toThrow('private OAuth token');
  });
  it('does not claim an authorized property is connected before selection', () => {
    expect(analyticsCallbackMessage('ga4', 'connected')).toMatch(/Escolha.*propriedade/);
    expect(analyticsCallbackMessage('meta', 'connected')).toBeNull();
    expect(analyticsCallbackMessage('ga4', 'attacker')).toBeNull();
  });
  it('validates complete bounded days in the property timezone', () => {
    const now = Date.parse('2026-10-01T02:00:00Z');
    expect(validAnalyticsPeriod({ from: '2026-09-01', to: '2026-09-30' }, 'UTC', now)).toBe(true);
    expect(validAnalyticsPeriod({ from: '2026-09-01', to: '2026-09-30' }, 'America/Sao_Paulo', now)).toBe(false);
    expect(validAnalyticsPeriod({ from: '2026-09-31', to: '2026-10-01' }, 'UTC', now)).toBe(false);
    expect(validAnalyticsPeriod({ from: '2026-08-01', to: '2026-09-30' }, 'UTC', now)).toBe(false);
  });
});
