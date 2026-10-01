import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { enabled, installHermesOperatorFakeStack } from './helpers/hermesOperatorFake';
import { CAMPAIGN, campaign, USER } from './helpers/hermesOperatorFixtures';
import type { AdsProvider, AdsSetup, AdsSetupInput } from '../src/lib/marketingOps/ads';
test.skip(!enabled, 'Requires the local fake HTTP stack; no external OAuth accounts are exercised.');

async function assertTouchTarget(control: Locator) {
  await expect.poll(async () => { const box = await control.boundingBox(); return box ? Math.min(box.width, box.height) : 0; }).toBeGreaterThanOrEqual(44);
}

async function installAds(page: Page, member = false, options: { accountConflict?: boolean; expiredPreview?: boolean } = {}) {
  await installHermesOperatorFakeStack(page);
  await page.route(`**/api/marketing/campaigns/${CAMPAIGN}`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: campaign }) }));
  const account = { id: 'account', name: 'Prometeus Comércio', currency: 'BRL', timeZone: 'America/Sao_Paulo' };
  let meta = { provider: 'meta', status: 'pending_account', version: 2, accounts: [account], selectedAccountId: null as string | null, capabilities: { metrics: true, nativeLeads: true }, lastSyncAt: null as string | null, safeError: null };
  const providers = () => [meta, { ...meta, provider: 'google', status: 'unprepared', selectedAccountId: null }, { ...meta, provider: 'linkedin', status: 'partial', capabilities: { metrics: false, nativeLeads: true }, selectedAccountId: 'account' }];
  const source = { id: '12121212-1212-4212-8212-121212121212', campaignId: CAMPAIGN, publicId: 'public', name: 'Formulário comercial', channel: 'meta_ads', kind: 'manual', classification: 'lead', actionId: null, allowedOrigins: [], enabled: true, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const link = { id: '34343434-3434-4434-8434-343434343434', campaignId: CAMPAIGN, provider: 'meta', sourceId: source.id, externalAccountId: 'account', externalCampaignId: 'external', destination: 'native_form', enabled: true, version: 1, lastSyncAt: null, safeError: null };
  const receipt = { id: 'receipt', status: 'needs_review', days: 2, reports: 2, previewId: 'preview', previewIds: ['preview', 'second-preview'], warnings: ['missing_days_retired'], completedAt: new Date().toISOString() };
  const preview = { id: 'preview', sourceId: source.id, campaignId: CAMPAIGN, expiresAt: '2099-09-30T12:00:00Z', summary: { new: 1, possible_duplicate: 1, duplicate: 0, invalid: 0 }, rows: [{ rowIndex: 0, status: 'new', input: { name: 'Ana', email: 'ana@example.test' }, issues: [], candidates: [], contactId: null }, { rowIndex: 1, status: 'possible_duplicate', input: { name: 'Maria', email: 'maria@example.test' }, issues: [], candidates: [{ id: 'contact', name: 'Maria', email: 'maria@example.test', phone: null, company: null }], contactId: null }] };
  let linked = false; let synced = false; let confirmed = false; let confirmRequests = 0; let firstSync = true; let firstAccount = true; const keys: string[] = []; const writes: string[] = [];
  await page.route('**/api/marketing/ads-integrations**', async route => {
    const path = new URL(route.request().url()).pathname; const method = route.request().method();
    if (method === 'POST') writes.push(path);
    const respond = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) });
    if (path.endsWith('/meta/accounts')) return respond([account, { ...account, id: 'manager', name: 'Conta gerenciadora', manager: true }]);
    if (path.endsWith('/meta/account')) {
      expect(route.request().headers()['if-match']).toBe(`"${meta.version}"`); expect(route.request().postDataJSON()).toEqual({ accountId: 'account' });
      if (options.accountConflict && firstAccount) { firstAccount = false; meta = { ...meta, version: meta.version + 1 }; return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'version_conflict' } }) }); }
      meta = { ...meta, status: 'connected', selectedAccountId: 'account', version: meta.version + 1 }; return respond(meta);
    }
    if (path.endsWith('/meta/disconnect')) { expect(route.request().headers()['if-match']).toBe('"4"'); meta = { ...meta, status: 'disconnected', version: 5 }; return respond(meta); }
    if (path.endsWith('/meta/campaigns')) return respond([{ id: 'external', name: 'Campanha do provedor', status: 'ACTIVE' }]);
    return respond(providers());
  });
  await page.route(`**/api/marketing/campaigns/${CAMPAIGN}/ads-links**`, async route => {
    const path = new URL(route.request().url()).pathname; const method = route.request().method(); const json = (data: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
    if (method === 'POST') writes.push(path);
    if (path.endsWith('/disable')) { expect(route.request().headers()['if-match']).toBe('"1"'); link.enabled = false; link.version = 2; return json(link); }
    if (path.endsWith('/results')) return json({ daily: synced ? [{ date: '2026-09-28', currency: 'BRL', timeZone: account.timeZone, spend: 12.5, impressions: 40, clicks: 5, conversions: null }] : [], receipts: synced ? [receipt] : [] });
    if (path.endsWith('/sync')) { keys.push(route.request().headers()['idempotency-key']); if (firstSync) { firstSync = false; return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ads_rate_limited' } }) }); } synced = true; meta = { ...meta, version: 4, lastSyncAt: receipt.completedAt }; return json(receipt); }
    if (method === 'POST') { expect(route.request().postDataJSON()).toEqual({ provider: 'meta', sourceId: source.id, externalCampaignId: 'external', destination: 'native_form' }); linked = true; return json(link); }
    return json(linked ? [link] : []);
  });
  await page.route(`**/api/marketing/campaigns/${CAMPAIGN}/lead-sources`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [source] }) }));
  await page.route(`**/api/marketing/campaigns/${CAMPAIGN}/lead-imports/**`, route => {
    const confirming = route.request().url().endsWith('/confirm');
    if (options.expiredPreview && !confirming) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'preview_expired' } }) });
    if (confirming) { confirmRequests += 1; expect(route.request().postDataJSON()).toEqual({ decisions: [{ rowIndex: 0, action: 'create' }, { rowIndex: 1, action: 'link', contactId: 'contact' }] }); confirmed = true; }
    const persistedReceipt = { previewId: 'preview', created: 1, linked: 1, skipped: 0, duplicate: 0, invalid: 0 };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: confirming ? persistedReceipt : { ...preview, expiresAt: confirmed ? '2000-09-30T12:00:00Z' : preview.expiresAt, receipt: confirmed ? persistedReceipt : null } }) });
  });
  if (member) await page.route('**/api/auth/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { id: USER, email: 'member@example.test', tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'member' } }) }));
  return { keys, writes, confirmed: () => confirmed, confirmRequests: () => confirmRequests };
}
async function managerFlow(page: Page, mobile: boolean, expiredPreview = false) {
  const fake = await installAds(page, false, { expiredPreview }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/settings/integrations?provider=meta&result=connected');
  await expect(page.getByText('Autorização recebida. Escolha sua conta.')).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/integrations$/);
  await expect(page.getByText('Aguardando configuração')).toBeVisible();
  await expect(page.getByText('Permissões parciais')).toBeVisible();
  await page.getByRole('button', { name: 'Escolher conta Meta Ads' }).click();
  await assertTouchTarget(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }));
  await expect(page.getByLabel(/Conta gerenciadora/)).toBeDisabled();
  await page.getByLabel(/Prometeus Comércio/).check();
  await page.getByRole('button', { name: 'Confirmar conta' }).click();
  await expect(page.getByText('Conta selecionada.')).toBeVisible();
  await expect(page.getByText('Conta conectada')).toBeVisible();
  await page.screenshot({ path: `../../tmp/ads-review/integrations-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
  const axe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(axe.violations).toEqual([]);
  await page.goto(`/marketing-ops/campaigns/${CAMPAIGN}`); await page.getByRole('tab', { name: 'Fontes', exact: true }).click();
  await page.getByRole('button', { name: 'Vincular anúncios' }).click();
  await assertTouchTarget(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }));
  await page.getByLabel('Provedor de anúncios').selectOption('meta');
  await page.getByLabel('Campanha de anúncios').selectOption('external');
  await page.getByLabel('Fonte da campanha').selectOption('12121212-1212-4212-8212-121212121212');
  await page.getByRole('button', { name: 'Revisar vínculo' }).click();
  await page.getByRole('button', { name: 'Confirmar vínculo' }).click();
  await expect(page.getByText('Anúncios vinculados à fonte.')).toBeVisible();
  await page.getByRole('button', { name: 'Sincronizar', exact: true }).click();
  await assertTouchTarget(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }));
  await page.getByRole('button', { name: 'Confirmar sincronização' }).click();
  await expect(page.getByRole('alert')).toContainText('O provedor limitou as consultas.');
  await page.getByRole('button', { name: 'Confirmar sincronização' }).click();
  await expect(page.getByText('Sincronização concluída. Confira os resultados e os contatos para revisão.')).toBeVisible();
  expect(fake.keys).toHaveLength(2); expect(fake.keys[0]).toBe(fake.keys[1]);
  await page.getByRole('button', { name: 'Ver resultados', exact: true }).click();
  await assertTouchTarget(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }));
  await expect(page.getByText(/Conversões do provedor não são vendas/)).toBeVisible();
  await expect(page.getByText(/O provedor revisou a medição/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Revisar contatos · lote/ })).toHaveCount(2);
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const dialogBox = await page.getByRole('dialog').boundingBox();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0); expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: `../../tmp/ads-review/results-${mobile ? 'mobile' : 'desktop'}.png` });
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Revisar contatos · lote 1' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await assertTouchTarget(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }));
  await expect(page.getByLabel('Arquivo de contatos')).toHaveCount(0);
  expect(fake.confirmed()).toBe(false);
  if (expiredPreview) {
    await expect(page.getByText(/Sincronize novamente/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar importação' })).toHaveCount(0);
    await assertTouchTarget(page.getByRole('button', { name: 'Voltar aos resultados', exact: true }));
    await page.getByRole('button', { name: 'Voltar aos resultados', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Revisar contatos · lote 1' })).toBeFocused();
    return;
  }
  await expect(page.getByRole('button', { name: 'Confirmar importação' })).toBeDisabled();
  await assertTouchTarget(page.getByRole('button', { name: 'Voltar aos resultados', exact: true }));
  await page.getByLabel('Decisão para linha 2').selectOption('link:contact');
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Confirmar importação' }).click();
  await expect(page.getByText('Importação concluída')).toBeVisible(); expect(fake.confirmed()).toBe(true);
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Resultados dos anúncios' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar contatos · lote 1' })).toBeFocused();
  await page.getByRole('button', { name: 'Revisar contatos · lote 1' }).click();
  await expect(page.getByText('Importação concluída')).toBeVisible();
  await expect(page.getByText('1 criados · 1 vinculados · 0 já registrados · 0 ignorados · 0 inválidos')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar importação' })).toHaveCount(0);
  await expect(page.getByLabel('Decisão para linha 2')).toHaveCount(0);
  await expect(page.getByText(/Nada foi importado ainda|Sincronize novamente/)).toHaveCount(0);
  expect(fake.confirmRequests()).toBe(1);
  await page.screenshot({ path: `../../tmp/ads-review/native-receipt-${mobile ? 'mobile' : 'desktop'}.png` });
  await page.getByRole('button', { name: 'Concluir', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Resultados dos anúncios' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar contatos · lote 1' })).toBeFocused();
  await page.keyboard.press('Escape');
  const disableTrigger = page.getByRole('button', { name: 'Desabilitar vínculo', exact: true });
  await disableTrigger.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Desabilitar vínculo?' })).toBeVisible();
  await assertTouchTarget(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }));
  await page.getByRole('button', { name: 'Confirmar desabilitação' }).click();
  await expect(page.getByText('Vínculo desabilitado. O histórico foi preservado.')).toBeVisible();
  await expect(disableTrigger).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ver resultados', exact: true })).toBeFocused();
  await page.screenshot({ path: `../../tmp/ads-review/campaign-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
  await page.goto('/settings/integrations'); await page.getByRole('button', { name: 'Desconectar Meta Ads' }).click();
  await assertTouchTarget(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }));
  await page.getByRole('button', { name: 'Confirmar desconexão' }).click(); await expect(page.getByText('Conexão encerrada. O histórico foi preservado.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Atualizar conexões' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
test('manager connects a real-shaped fake account and reviews native contacts explicitly', async ({ page }) => managerFlow(page, false));
test('manager completes account, campaign and human import flows on mobile @mobile', async ({ page }) => managerFlow(page, true));
test('expired native preview requires another synchronization without automatic import', async ({ page }) => managerFlow(page, false, true));
test('account version conflict refreshes state and requires another explicit confirmation', async ({ page }) => {
  const fake = await installAds(page, false, { accountConflict: true }); await page.goto('/settings/integrations');
  await page.getByRole('button', { name: 'Escolher conta Meta Ads' }).click();
  await page.getByLabel(/Prometeus Comércio/).check();
  await page.getByRole('button', { name: 'Confirmar conta' }).click();
  await expect(page.getByRole('alert')).toContainText('Os dados mudaram.');
  expect(fake.writes.filter(path => path.endsWith('/account'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Confirmar conta' }).click();
  await expect(page.getByText('Conta selecionada.')).toBeVisible();
  expect(fake.writes.filter(path => path.endsWith('/account'))).toHaveLength(2);
});
test('integrations preserve focus, navigation and responsive layout @mobile', async ({ page }) => {
  await installAds(page); await page.goto('/settings/integrations');
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.setViewportSize({ width: 390, height: 844 });
  await assertTouchTarget(page.getByRole('button', { name: 'Abrir menu' }));
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await assertTouchTarget(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }));
  await expect(page.getByRole('button', { name: 'Abrir integrações', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir integrações', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Escolher conta Meta Ads' });
  await trigger.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Escolher conta Meta Ads' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
});
test('member reads provider states without account selection or mutation requests', async ({ page }) => {
  const fake = await installAds(page, true); await page.goto('/settings/integrations');
  await expect(page.getByRole('heading', { name: 'Integrações', exact: true })).toBeVisible();
  await expect(page.getByText(/Um administrador ou gestor/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Escolher conta|Conectar |Desconectar |Renovar / })).toHaveCount(0);
  await expect(page.getByText('Permissões parciais')).toBeVisible(); expect(fake.writes).toEqual([]);
});
test('unauthenticated access redirects to the protected login route', async ({ page }) => {
  await installAds(page); await page.route('**/api/auth/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) }));
  await page.goto('/settings/integrations'); await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Integrações', exact: true })).toHaveCount(0);
});

async function installSetup(page: Page, provider: AdsProvider = 'meta', options: { mode?: 'empty' | 'managed' | 'external'; role?: 'admin' | 'manager' | 'member'; conflict?: boolean; networkRetry?: boolean; originMissing?: boolean } = {}) {
  await installHermesOperatorFakeStack(page);
  await page.route('**/api/auth/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { id: USER, email: 'admin@example.test', tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: options.role ?? 'admin' } }) }));
  const mode = options.mode ?? 'empty';
  const callbacks = (value: AdsProvider) => `https://empresa.test/api/ads/oauth/${value}/callback`;
  let metadata: AdsSetup = { provider, version: 1, mode, writable: mode !== 'external', ready: mode !== 'empty', publicOrigin: options.originMissing ? null : 'https://empresa.test', redirectUri: options.originMissing ? null : callbacks(provider), clientId: mode === 'empty' ? null : 'original-client', apiVersion: mode === 'empty' ? null : provider === 'meta' ? 'v23.0' : provider === 'google' ? 'v25' : '202609', scopes: provider === 'meta' ? ['ads_read'] : provider === 'google' ? ['https://www.googleapis.com/auth/adwords'] : ['r_ads', 'r_ads_reporting'], metaLoginConfigId: provider === 'meta' && mode !== 'empty' ? '456' : null, googleLoginCustomerId: null, hasClientSecret: mode !== 'empty' };
  const account = { id: 'business', name: 'Conta da empresa', currency: 'BRL', timeZone: 'America/Sao_Paulo' };
  let connection = { provider, status: mode === 'empty' ? 'unprepared' : 'connected', version: 1, accounts: mode === 'empty' ? [] : [account], selectedAccountId: mode === 'empty' ? null : account.id, capabilities: { metrics: true, nativeLeads: false }, lastSyncAt: null, safeError: null };
  const writes: { path: string; input: AdsSetupInput; version: string; key: string }[] = []; const reads: string[] = [];
  let attempts = 0; let authorizations = 0;
  await page.route('**/api/marketing/ads-integrations**', async route => {
    const path = new URL(route.request().url()).pathname;
    const response = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) });
    if (route.request().method() === 'GET') reads.push(path);
    if (path.endsWith(`/${provider}/setup`)) {
      if (route.request().method() === 'GET') return response(metadata);
      writes.push({ path, input: route.request().postDataJSON(), version: route.request().headers()['if-match'], key: route.request().headers()['idempotency-key'] }); attempts += 1;
      if ((options.conflict || options.networkRetry) && attempts === 1) {
        if (options.conflict) metadata = { ...metadata, version: 2 };
        return route.fulfill({ status: options.conflict ? 409 : 503, contentType: 'application/json', body: JSON.stringify({ error: { code: options.conflict ? 'version_conflict' : 'request_failed', message: 'ignored-provider-detail' } }) });
      }
      expect(route.request().headers()['if-match']).toBe(`"${metadata.version}"`);
      metadata = { ...metadata, ...route.request().postDataJSON(), version: metadata.version + 1, mode: 'managed', writable: true, ready: true, hasClientSecret: true };
      // The real metadata contract never returns the posted secret.
      const { clientSecret: _secret, confirmReplacement: _confirm, takeOverExternal: _takeover, ...safe } = metadata as AdsSetup & AdsSetupInput;
      metadata = safe; connection = { ...connection, status: 'prepared', selectedAccountId: null, accounts: [], version: connection.version + 1 };
      return response(metadata);
    }
    if (path.endsWith(`/${provider}/authorize`)) {
      authorizations += 1; connection = { ...connection, status: 'pending_account', version: connection.version + 1 };
      const urls = { meta: 'https://www.facebook.com/v23.0/dialog/oauth', google: 'https://accounts.google.com/o/oauth2/v2/auth', linkedin: 'https://www.linkedin.com/oauth/v2/authorization' };
      return response({ authorizationUrl: `${urls[provider]}?state=fake-state` });
    }
    if (path.endsWith(`/${provider}/accounts`)) return response([account]);
    if (path.endsWith(`/${provider}/account`)) { expect(route.request().headers()['if-match']).toBe(`"${connection.version}"`); connection = { ...connection, status: 'connected', selectedAccountId: account.id, accounts: [account], version: connection.version + 1 }; return response(connection); }
    return response((['meta', 'google', 'linkedin'] as AdsProvider[]).map(value => value === provider ? connection : { ...connection, provider: value, status: 'unprepared', selectedAccountId: null, accounts: [] }));
  });
  for (const host of ['www.facebook.com', 'accounts.google.com', 'www.linkedin.com']) await page.route(`https://${host}/**`, route => route.fulfill({ contentType: 'text/html', body: `<html lang="pt-BR"><body><a href="${process.env.MARKETING_OPS_E2E_BASE_URL}/settings/integrations?provider=${provider}&result=connected">Retornar ao aplicativo</a></body></html>` }));
  return { writes, reads, authorizations: () => authorizations };
}
async function fillSetup(page: Page, provider: AdsProvider) {
  await page.getByLabel(provider === 'meta' ? 'ID do aplicativo' : provider === 'google' ? 'ID do cliente OAuth' : 'ID do cliente', { exact: true }).fill('new-client');
  await page.getByLabel('Segredo do aplicativo', { exact: true }).fill('fixture-secret');
  if (provider === 'meta') { await page.getByLabel('Versão da API', { exact: true }).fill('v23.0'); await page.getByLabel('ID da configuração de login', { exact: true }).fill('456'); }
}
for (const provider of ['meta', 'google', 'linkedin'] as AdsProvider[]) test(`admin prepares ${provider}, authorizes explicitly and selects the account`, async ({ page }) => {
  const fake = await installSetup(page, provider); await page.goto('/settings/integrations');
  await expect(page.getByRole('button', { name: /Configurar aplicativo/ })).toHaveCount(3);
  const names = { meta: 'Meta Ads', google: 'Google Ads', linkedin: 'LinkedIn Ads' };
  await page.getByRole('button', { name: `Configurar aplicativo ${names[provider]}` }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByText(`https://empresa.test/api/ads/oauth/${provider}/callback`, { exact: true })).toBeVisible();
  await assertTouchTarget(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }));
  await fillSetup(page, provider);
  await page.getByRole('button', { name: 'Revisar aplicativo' }).click();
  await expect(page.getByText('Novo segredo informado')).toBeVisible();
  expect(await page.getByRole('dialog').innerText()).not.toContain('fixture-secret'); expect(fake.writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Salvar aplicativo' }).click();
  await expect(page.getByRole('dialog').getByText('Aplicativo preparado. Falta autorizar e escolher a conta.')).toBeVisible();
  expect(fake.authorizations()).toBe(0); expect(fake.writes).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Continuar e autorizar' })).toBeFocused();
  await page.getByRole('button', { name: 'Continuar e autorizar' }).click();
  await page.getByRole('link', { name: 'Retornar ao aplicativo' }).click();
  await expect(page.getByText('Autorização recebida. Escolha sua conta.')).toBeVisible();
  expect(fake.authorizations()).toBe(1);
  await page.getByRole('button', { name: `Escolher conta ${names[provider]}` }).click();
  await page.getByLabel(/Conta da empresa/).check(); await page.getByRole('button', { name: 'Confirmar conta' }).click();
  await expect(page.getByText('Conta selecionada.')).toBeVisible(); await expect(page.getByText('Conta conectada')).toBeVisible();
  expect(page.url()).not.toContain('fixture-secret'); expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('fixture-secret');
});
test('managed replacement preserves a blank secret and requires confirmation; external takeover requires a new secret', async ({ page }) => {
  let fake = await installSetup(page, 'meta', { mode: 'managed' }); await page.goto('/settings/integrations');
  await page.getByRole('button', { name: 'Editar / trocar aplicativo Meta Ads' }).click();
  await page.getByRole('button', { name: 'Revisar aplicativo' }).click();
  await expect(page.getByText('Segredo armazenado será preservado')).toBeVisible();
  await expect(page.getByText(/resultados anteriores permanecem no histórico/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar aplicativo' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click(); expect(fake.writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Editar / trocar aplicativo Meta Ads' }).click(); await page.getByRole('button', { name: 'Revisar aplicativo' }).click();
  await page.getByLabel(/Confirmo a troca/).check(); await page.getByRole('button', { name: 'Salvar aplicativo' }).click();
  await expect(page.getByRole('button', { name: 'Continuar e autorizar' })).toBeVisible(); expect(fake.writes[0].input).not.toHaveProperty('clientSecret'); expect(fake.writes[0].input.confirmReplacement).toBe(true);
  await page.getByRole('button', { name: 'Concluir depois' }).click();
  fake = await installSetup(page, 'meta', { mode: 'external' }); await page.reload();
  await page.getByRole('button', { name: 'Editar / trocar aplicativo Meta Ads' }).click();
  await page.getByRole('button', { name: 'Revisar aplicativo' }).click(); await expect(page.getByText('Informe o segredo do aplicativo.')).toBeVisible();
  await page.getByLabel('Segredo do aplicativo', { exact: true }).fill('new-secret'); await page.getByRole('button', { name: 'Revisar aplicativo' }).click();
  await page.getByLabel(/Confirmo a troca/).check(); await expect(page.getByRole('button', { name: 'Salvar aplicativo' })).toBeDisabled();
  await page.getByLabel(/Assumir a gestão/).check(); await page.getByRole('button', { name: 'Salvar aplicativo' }).click();
  await expect(page.getByRole('button', { name: 'Continuar e autorizar' })).toBeVisible(); expect(fake.writes[0].input.takeOverExternal).toBe(true); expect(fake.authorizations()).toBe(0);
});
test('wizard retries keep the proposal key; version conflicts require a fresh review', async ({ page }) => {
  for (const conflict of [false, true]) {
    const fake = await installSetup(page, 'meta', { networkRetry: !conflict, conflict }); await page.goto('/settings/integrations');
    await page.getByRole('button', { name: 'Configurar aplicativo Meta Ads' }).click(); await fillSetup(page, 'meta');
    await page.getByRole('button', { name: 'Revisar aplicativo' }).click(); await page.getByRole('button', { name: 'Salvar aplicativo' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible(); expect(fake.writes).toHaveLength(1);
    if (conflict) { await expect(page.getByLabel('ID do aplicativo', { exact: true })).toHaveValue('new-client'); await expect(page.getByRole('button', { name: 'Salvar aplicativo' })).toHaveCount(0); await page.getByRole('button', { name: 'Revisar aplicativo' }).click(); }
    await page.getByRole('button', { name: 'Salvar aplicativo' }).click(); await expect(page.getByRole('button', { name: 'Continuar e autorizar' })).toBeVisible();
    expect(fake.writes).toHaveLength(2); expect(fake.writes[0].key === fake.writes[1].key).toBe(!conflict); expect(fake.writes[1].version).toBe(conflict ? '"2"' : '"1"');
    await page.getByRole('button', { name: 'Concluir depois' }).click();
  }
});
test('wizard keyboard focus, reflow, accessible controls and safe origin recovery @mobile', async ({ page }) => {
  await installSetup(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/settings/integrations');
  const trigger = page.getByRole('button', { name: 'Configurar aplicativo Meta Ads' }); await trigger.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Revisar aplicativo' }).click(); await expect(page.getByLabel('ID do aplicativo', { exact: true })).toBeFocused();
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true); }
  await page.setViewportSize({ width: 390, height: 844 });
  await fillSetup(page, 'meta'); await page.getByRole('button', { name: 'Revisar aplicativo' }).click();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '../../tmp/ads-review/setup-review-mobile.png' });
  await page.getByRole('button', { name: 'Salvar aplicativo' }).click(); await page.getByRole('button', { name: 'Concluir depois' }).click();
  await expect(page.getByRole('button', { name: 'Editar / trocar aplicativo Meta Ads' })).toBeFocused();
  const fake = await installSetup(page, 'meta', { originMissing: true }); await page.reload(); await page.getByRole('button', { name: 'Configurar aplicativo Meta Ads' }).click();
  await expect(page.getByText(/endereço público de retorno no servidor/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Revisar aplicativo' })).toHaveCount(0); expect(fake.writes).toHaveLength(0);
});
test('manager and member never request setup metadata or see credential controls', async ({ page }) => {
  for (const role of ['manager', 'member'] as const) {
    const fake = await installSetup(page, 'meta', { role, mode: 'managed' }); await page.goto('/settings/integrations');
    await expect(page.getByRole('heading', { name: 'Integrações', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Configurar aplicativo|Editar \/ trocar aplicativo/ })).toHaveCount(0);
    await expect(page.getByLabel('Segredo do aplicativo', { exact: true })).toHaveCount(0);
    expect(fake.reads.filter(path => path.endsWith('/setup'))).toEqual([]); expect(fake.writes).toEqual([]);
    if (role === 'manager') await expect(page.getByRole('button', { name: 'Trocar conta Meta Ads' })).toBeVisible();
    else await expect(page.getByRole('button', { name: 'Trocar conta Meta Ads' })).toHaveCount(0);
  }
});
