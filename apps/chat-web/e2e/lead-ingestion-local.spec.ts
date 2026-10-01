import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.skip(process.env.LOCAL_LEADS_E2E !== 'true', 'Requires local acquisition evaluation mode.');
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

for (const title of ['real acquisition through campaign and dashboard', '@mobile real acquisition through campaign and dashboard']) {
  test(title, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Acquisition evaluation must stay on loopback.');
    const local = parse(readFileSync(new URL('../../../.env.local', import.meta.url)));
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: local.DEV_USER_EMAIL, password: local.DEV_USER_PASSWORD }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.getSetCookie().find(value => value.startsWith('ens_session='))?.split(';')[0];
    if (!cookie) throw new Error('No evaluation session.');
    const suffix = randomUUID();
    const runtimeErrors: string[] = [];
    page.on('pageerror', error => runtimeErrors.push(error.name));
    let campaignId: string | null = null;
    const call = async (path: string, method = 'GET', body?: unknown, version?: number) => {
      const response = await fetch(`${origin}/api/marketing${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(method === 'GET' ? {} : { 'Idempotency-Key': randomUUID() }), ...(version === undefined ? {} : { 'If-Match': `"${version}"` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      expect(response.ok, `Fixture API ${method} ${path} status ${response.status}`).toBe(true);
      return (await response.json()).data;
    };
    try {
      const campaign = await call('/campaigns', 'POST', { name: `Teste técnico · captação ${suffix.slice(0, 8)}`, objective: 'Validação local fictícia', referenceType: 'initiative', referenceTitleSnapshot: 'Teste técnico', startsOn: '2026-09-01', endsOn: '2026-10-31', primaryChannel: 'website' });
      campaignId = campaign.id;
      const members = await call(`/campaigns/${campaignId}/participants`);
      const owner = members.find((member: { memberRole: string }) => member.memberRole === 'owner');
      const ownership = await call(`/campaigns/${campaignId}/participants/${owner.userId}`, 'PATCH', { isPrimary: true }, campaign.version);
      await call(`/campaigns/${campaignId}/transitions`, 'POST', { to: 'planned' }, ownership.campaignVersion);
      const source = await call(`/campaigns/${campaignId}/lead-sources`, 'POST', { name: 'Meta · importação de teste', channel: 'meta_ads', kind: 'manual' });
      const formSource = await call(`/campaigns/${campaignId}/lead-sources`, 'POST', { name: 'Google · LP de teste', channel: 'google_ads', kind: 'landing_page', allowedOrigins: [origin] });
      const email = `fixture-${suffix}@example.invalid`;
      const cookieIndex = cookie.indexOf('=');
      await page.context().addCookies([{ name: cookie.slice(0, cookieIndex), value: cookie.slice(cookieIndex + 1), url: origin, httpOnly: true, sameSite: 'Lax' }]);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/marketing-ops/campaigns/${campaignId}`);
      await page.getByRole('tab', { name: 'Leads', exact: true }).click();
      await page.getByRole('button', { name: 'Importar contatos', exact: true }).click();
      await page.getByLabel('Fonte da importação', { exact: true }).selectOption(source.id);
      await page.getByLabel('Arquivo de contatos', { exact: true }).setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(`name,email,occurredAt\nContato fictício,${email},2026-09-28T10:00:00-03:00`) });
      await page.getByRole('button', { name: 'Gerar prévia', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Prévia da importação' }).getByRole('heading', { name: 'Linha 1 · Contato fictício', exact: true })).toBeVisible();
      expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      await page.getByRole('button', { name: 'Confirmar importação', exact: true }).click();
      await expect(page.getByText(/Importação concluída/)).toBeVisible();
      await page.getByRole('button', { name: 'Concluir', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Importar contatos', exact: true })).toBeFocused();
      const contacts = await call(`/campaigns/${campaignId}/leads`);
      expect(contacts).toHaveLength(1);
      const captureBody = { submissionId: randomUUID(), name: 'Contato fictício', email };
      for (let retry = 0; retry < 2; retry++) {
        const capture = await fetch(`${origin}/api/capture/${formSource.publicId}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(captureBody) });
        expect(capture.status).toBe(202);
        const accepted = await capture.text();
        expect(accepted).not.toContain(email);
      }
      expect(await call(`/campaigns/${campaignId}/leads`)).toHaveLength(1);
      const report = await call(`/campaigns/${campaignId}/result-reports`, 'POST', { sourceId: source.id, periodFrom: '2026-09-21', periodTo: '2026-09-30', timeZone: 'America/Sao_Paulo', metrics: { sent: 100, clicked: 10, sales: 2, revenue: 500, spend: 100 } });
      await page.getByRole('tab', { name: 'Visão geral', exact: true }).click();
      await page.getByRole('button', { name: 'Relatórios de resultados', exact: true }).click();
      await page.getByRole('button', { name: 'Revisar relatório', exact: true }).click();
      await page.getByLabel('Vendas', { exact: true }).fill('3');
      await page.getByLabel('Receita', { exact: true }).fill('750');
      await page.getByRole('button', { name: 'Revisar valores', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Revisão dos valores' })).toContainText('750');
      expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      await page.getByRole('button', { name: 'Confirmar revisão', exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('status')).toContainText('Relatório revisado');
      await page.getByRole('button', { name: 'Ver histórico', exact: true }).click();
      await expect(page.getByText('Versão 2', { exact: false })).toBeVisible();
      expect(await call(`/campaigns/${campaignId}/result-reports/${report.id}/revisions`)).toHaveLength(2);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Relatórios de resultados', exact: true })).toBeFocused();
      const results = await call(`/results?campaignId=${campaignId}`);
      expect(results.capturedLeads).toBe(1);
      expect(results.sales).toBe(3);
      expect(results.revenue).toBe(750);
      await page.goto(`/marketing-ops/dashboard?campaignId=${campaignId}`);
      await expect(page.getByRole('heading', { name: 'Dashboard de marketing', exact: true })).toBeVisible();
      await expect(page.getByText('750', { exact: false }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      if (process.env.LOCAL_LEADS_E2E_SCREENSHOTS === 'true') {
        await page.screenshot({ path: join(tmpdir(), `prometeus-leads-${title.includes('@mobile') ? 'mobile' : 'desktop'}.png`), fullPage: true });
      }
      await page.goto(`/marketing-ops/campaigns/${campaignId}`);
      await expect(page.getByRole('region', { name: 'Indicadores da campanha' })).toContainText('750');
      const disabled = await call(`/campaigns/${campaignId}/lead-sources/${formSource.id}`, 'PATCH', { enabled: false }, formSource.version);
      expect(disabled.enabled).toBe(false);
      const revoked = await fetch(`${origin}/api/capture/${formSource.publicId}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...captureBody, submissionId: randomUUID() }) });
      expect(revoked.status).toBe(404);
      expect(runtimeErrors).toEqual([]);
    } finally {
      if (campaignId) {
        const current = await call(`/campaigns/${campaignId}`);
        await call(`/campaigns/${campaignId}/archive`, 'POST', {}, current.version);
      }
      await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
      await page.context().clearCookies();
    }
  });
}
