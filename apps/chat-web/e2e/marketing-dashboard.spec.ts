import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { enabled, installHermesOperatorFakeStack } from './helpers/hermesOperatorFake';
import { CAMPAIGN, campaign } from './helpers/hermesOperatorFixtures';

test.skip(!enabled, 'Requires local fake authentication.');

test('clean overview opens details and a scoped campaign while retaining filters', async ({ page }) => {
  await installHermesOperatorFakeStack(page);
  await page.goto('/marketing-ops/dashboard?mode=demo');
  await expect(page.getByRole('region', { name: 'Indicadores principais' }).locator('article')).toHaveCount(4);
  await expect(page.getByRole('region', { name: 'Funil comercial' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Investimento por plataforma', exact: true })).toHaveCount(0);
  const detail = page.getByRole('button', { name: 'Explorar resultados', exact: true });
  await detail.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Detalhes dos resultados' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Funil comercial' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeFocused();
  await page.getByLabel('Período dos resultados').selectOption('2');
  await page.getByLabel('Canal', { exact: true }).selectOption('google');
  const total = await page.getByTestId('kpi-Novos leads').innerText();
  await page.getByRole('link', { name: /Ver resultados de Crescimento B2B/ }).click();
  await expect(page).toHaveURL(/dashboard\/campaigns\/growth\?weeks=2&channel=google/);
  await expect(page.getByRole('heading', { name: 'Crescimento B2B', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId('kpi-Novos leads')).not.toHaveText(total);
  await expect(page.getByLabel('Campanha', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Funil comercial' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Desempenho dos canais' }).getByRole('button', { name: 'Detalhar Google Ads' })).toHaveAccessibleDescription(/leads.*qualificados.*completos/);
  await page.getByRole('button', { name: 'Atualização semanal', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Campanha do informe')).toHaveValue('growth');
  await expect(page.getByRole('dialog').getByLabel('Campanha do informe')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Atualização semanal', exact: true })).toBeFocused();
  await page.screenshot({ path: '../../tmp/dashboard-review/campaign-clean.png', fullPage: true });
  await page.getByRole('link', { name: 'Voltar ao dashboard' }).click();
  await expect(page.getByLabel('Período dos resultados')).toHaveValue('2');
  await expect(page.getByLabel('Canal', { exact: true })).toHaveValue('google');
});

test('missing data and manual weekly review remain explicit and do not write', async ({ page }) => {
  await installHermesOperatorFakeStack(page);
  const mutations: string[] = [];
  page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) mutations.push(request.url()); });
  await page.goto('/marketing-ops/dashboard?mode=demo');
  const distribution = page.getByRole('region', { name: 'Distribuição de leads por canal', exact: true });
  await expect(distribution.locator('.recharts-pie-sector')).toHaveCount(6);
  await expect(distribution.getByTestId('distribution-total')).toHaveText(await page.getByTestId('kpi-Novos leads').innerText());
  await page.getByLabel('Canal', { exact: true }).selectOption('email');
  const detail = distribution.getByRole('button', { name: 'Ver detalhes de E-mail' });
  await expect(detail).toHaveAccessibleDescription(/leads.*100%.*completos/);
  await detail.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Resultados de E-mail' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeFocused();
  await page.getByLabel('Canal', { exact: true }).selectOption('whatsapp');
  await page.getByLabel('Período dos resultados').selectOption('1');
  await expect(page.getByTestId('kpi-Novos leads')).toHaveText('—');
  await expect(distribution.getByText('Sem registros para distribuir.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await page.getByRole('button', { name: 'Atualização semanal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Atualização semanal', exact: true });
  await dialog.getByLabel('Entregas', { exact: true }).fill('1300');
  await dialog.getByRole('button', { name: 'Revisar exemplo' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('As entregas não podem superar os envios.');
  await dialog.getByLabel('Entregas', { exact: true }).fill('1140');
  await dialog.getByRole('button', { name: 'Revisar exemplo' }).click();
  await expect(page.getByText('Revisão demonstrativa pronta. Nenhum dado foi gravado.')).toBeVisible();
  await page.getByRole('button', { name: 'Concluir simulação' }).click();
  await expect(page.getByRole('button', { name: 'Atualização semanal', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Fontes e atualização', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Falta 14–20 set')).toBeVisible();
  await page.getByRole('button', { name: 'Ver cenário sem dados' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('kpi-Novos leads')).toHaveText('—');
  expect(mutations).toEqual([]);
});

test('overview and campaign pages stay accessible across screen sizes @mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installHermesOperatorFakeStack(page);
  await page.goto('/marketing-ops/dashboard?mode=demo');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../../tmp/dashboard-review/clean-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const overviewAxe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(overviewAxe.violations).toEqual([]);
  await page.getByRole('button', { name: 'Explorar resultados', exact: true }).click();
  const dialogAxe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(dialogAxe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: /Ver resultados de Crescimento B2B/ }).click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const campaignAxe = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(campaignAxe.violations).toEqual([]);
  await page.screenshot({ path: '../../tmp/dashboard-review/campaign-clean-mobile.png', fullPage: true });
});

test('real campaign starts with measured-data absence and preserves a draft between keyboard tabs @mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installHermesOperatorFakeStack(page);
  await page.route(`**/api/marketing/campaigns/${CAMPAIGN}`, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: { ...campaign, name: 'Campanha comercial', objective: 'Gerar oportunidades comerciais', startsOn: '2026-09-01', endsOn: '2026-10-30' } }),
  }));
  await page.route('**/api/marketing/results?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { capturedLeads: 0, contactsCold: 0, whatsappClicks: 0, qualified: null, sales: null, revenue: null, spend: null, weekly: [], channels: [], campaigns: [], coverage: { sources: 0, reports: 0, partialReportsExcluded: 0, metricReports: { qualified: 0, sales: 0, revenue: 0, spend: 0 } }, lastUpdated: null } }) }));
  const writes: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/marketing/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url()); });
  await page.goto(`/marketing-ops/campaigns/${CAMPAIGN}`);
  await expect(page.getByText('Resultados ainda não medidos')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Objetivo', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Abrir ações da campanha' })).toHaveAttribute('href', `/marketing-ops/production?campaignId=${CAMPAIGN}`);
  const results = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../../tmp/dashboard-review/real-campaign-${width}.png`, fullPage: true });
  }
  await page.getByRole('tab', { name: 'Visão geral' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByLabel('Objetivo', { exact: true }).fill('Plano em revisão');
  await page.getByRole('tab', { name: 'Visão geral' }).click();
  await expect(page.getByText('Há alterações não salvas no planejamento.')).toBeVisible();
  await page.getByRole('tab', { name: /Planejamento/ }).click();
  await expect(page.getByLabel('Objetivo', { exact: true })).toHaveValue('Plano em revisão');
  expect(writes).toEqual([]);
});
