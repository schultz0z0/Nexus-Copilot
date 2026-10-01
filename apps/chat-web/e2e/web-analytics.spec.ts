import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { enabled, installHermesOperatorFakeStack } from './helpers/hermesOperatorFake';
import { USER, CAMPAIGN } from './helpers/hermesOperatorFixtures';
import { defaultAnalyticsPeriod, type AnalyticsConnection, type AnalyticsResults } from '../src/lib/marketingOps/analytics';

test.skip(!enabled, 'Uses a simulated provider/BFF stack, never real OAuth credentials.');
const resource = { id: 'properties/123', name: 'Site Prometeus', timeZone: 'America/Sao_Paulo', currency: 'BRL' };
async function installAnalytics(page: Page, options: { connected?: boolean; admin?: boolean } = {}) {
  await installHermesOperatorFakeStack(page);
  if (options.admin) await page.route('**/api/auth/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { id: USER, email: 'admin@example.test', full_name: 'Administrador', tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'admin' } }) }));
  let ga4: AnalyticsConnection = { provider: 'ga4', status: options.connected ? 'connected' : 'prepared', version: 2, resources: [resource], selectedResourceId: options.connected ? resource.id : null, lastSyncAt: null, safeError: null };
  let clarity: AnalyticsConnection = { ...ga4, provider: 'clarity', status: 'unprepared', version: 0, resources: [], selectedResourceId: null };
  const period = defaultAnalyticsPeriod(resource.timeZone);
  const measured: AnalyticsResults = { provider: 'ga4', resource, ...period, totals: { sessions: 1240, engagedSessions: 744, pageViews: 2310, keyEvents: 28, rageClicks: null, deadClicks: null, scrollDepth: null }, daily: [{ date: period.from, sessions: 440, engagedSessions: 264, pageViews: 810, keyEvents: 10 }, { date: period.to, sessions: 800, engagedSessions: 480, pageViews: 1500, keyEvents: 18 }], channels: [{ source: 'google', medium: 'cpc', sessions: 760 }, { source: 'instagram', medium: 'social', sessions: 480 }], campaigns: [{ utmCampaign: 'oferta_outubro', sessions: 1240 }], lastSyncAt: new Date().toISOString(), warnings: [], window: null, stale: false };
  let authorizations = 0; let tokenWrites = 0;
  await page.route('**/api/marketing/web-analytics/**', route => {
    const path = new URL(route.request().url()).pathname;
    const reply = (data: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
    if (path.endsWith('/connections')) return reply([ga4, clarity]);
    if (path.endsWith('/authorize')) { authorizations++; ga4 = { ...ga4, status: 'pending_resource', selectedResourceId: null, version: ga4.version + 1 }; return reply({ authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=simulated' }); }
    if (path.endsWith('/resources')) return reply([resource]);
    if (path.endsWith('/resource')) { expect(route.request().headers()['if-match']).toBe(`"${ga4.version}"`); expect(route.request().postDataJSON()).toEqual({ resourceId: resource.id }); ga4 = { ...ga4, status: 'connected', selectedResourceId: resource.id, version: ga4.version + 1 }; return reply(ga4); }
    if (path.endsWith('/clarity/connect')) { expect(route.request().headers()['if-match']).toBe(`"${clarity.version}"`); expect(route.request().headers()['idempotency-key']).toBeTruthy(); tokenWrites++; const input = route.request().postDataJSON(); expect(input.token).toBe('simulated-export-token'); clarity = { ...clarity, status: 'connected', resources: [{ id: input.projectId, name: input.projectName, timeZone: 'UTC' }], selectedResourceId: input.projectId, version: clarity.version + 1 }; return reply(clarity); }
    if (path.endsWith('/sync')) return reply({ id: 'receipt', status: 'completed', completedAt: new Date().toISOString(), warnings: [] });
    if (path.endsWith('/results')) return reply(measured);
    return reply({});
  });
  await page.route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Consentimento simulado</h1>' }));
  await page.route(`**/api/marketing/campaigns/${CAMPAIGN}/web-analytics-links**`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  return { authorizations: () => authorizations, tokenWrites: () => tokenWrites };
}

test('GA4 connects with one authorization and explicit property selection, then renders useful results', async ({ page }) => {
  const state = await installAnalytics(page);
  await page.goto('/settings/integrations?tab=analytics');
  await page.getByRole('button', { name: 'Conectar Google Analytics', exact: true }).click();
  await expect(page).toHaveURL(/accounts\.google\.com/); expect(state.authorizations()).toBe(1);
  await page.goto('/settings/integrations?provider=ga4&result=connected');
  await expect(page.getByRole('status').filter({ hasText: 'Escolha sua propriedade GA4' })).toBeVisible();
  await page.getByRole('button', { name: 'Escolher propriedade', exact: true }).click();
  await page.getByRole('radio', { name: /Site Prometeus/ }).check();
  await page.getByRole('button', { name: 'Confirmar propriedade' }).click();
  await expect(page.getByText('Propriedade selecionada.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Ver resultados do site' }).click();
  await expect(page.getByRole('heading', { name: 'Análise do site', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Atualizar resultados' }).click();
  await expect(page.getByText('Resultados atualizados.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Eventos-chave' })).toBeVisible();
  await page.getByText('Ver valores por dia', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Sessões por dia' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evolução das sessões' })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('Clarity validates a private project token and restores focus without redisplaying the secret', async ({ page }) => {
  const state = await installAnalytics(page, { admin: true });
  await page.goto('/settings/integrations?tab=analytics');
  const trigger = page.getByRole('button', { name: 'Conectar Microsoft Clarity', exact: true });
  await trigger.click();
  await page.getByLabel('ID do projeto', { exact: true }).fill('exampleproject');
  await page.getByLabel('Nome do projeto', { exact: true }).fill('Site Prometeus');
  await page.getByLabel('Token de exportação', { exact: true }).fill('simulated-export-token');
  expect(state.tokenWrites()).toBe(0);
  await page.getByRole('button', { name: 'Validar e conectar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Clarity conectado. A leitura do projeto foi validada.', { exact: true })).toBeVisible();
  expect(state.tokenWrites()).toBe(1);
  await page.getByRole('button', { name: 'Trocar projeto ou token' }).click();
  await expect(page.getByLabel('Token de exportação', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Validar e conectar' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Trocar projeto ou token' })).toBeFocused();
});

test('site analytics remains readable at 320px, keyboard accessible and respects reduced motion @mobile', async ({ page }) => {
  await installAnalytics(page, { connected: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/marketing-ops/analytics?provider=ga4');
  await expect(page.getByRole('heading', { name: 'Eventos-chave' })).toBeVisible();
  const refresh = page.getByRole('button', { name: 'Atualizar resultados' });
  const box = await refresh.boundingBox(); expect(box && Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText('Ver valores por origem', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table', { name: 'Sessões por origem' })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '../../tmp/web-analytics-mobile.png', fullPage: true });
});
