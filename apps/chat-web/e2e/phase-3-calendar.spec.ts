import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const enabled = process.env.MARKETING_OPS_CALENDAR_E2E_ENABLED === 'true';
const anchorDate = process.env.MARKETING_OPS_CALENDAR_E2E_DATE ?? new Date().toISOString().slice(0, 10);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when MARKETING_OPS_CALENDAR_E2E_ENABLED=true`);
  return value;
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(requiredEnv('MARKETING_OPS_E2E_MANAGER_EMAIL'));
  await page.getByLabel('Senha').fill(requiredEnv('MARKETING_OPS_E2E_MANAGER_PASSWORD'));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Login realizado com sucesso!')).toBeVisible();
}

async function expectNoWcagViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    nodes: nodes.map(({ target, html, failureSummary }) => ({ target, html, failureSummary }))
  }))).toEqual([]);
}

test.describe('Phase 3 production calendars', () => {
  test.skip(!enabled, 'Enable only in a controlled Phase 3 validation environment.');

  test('week preserves URL context, exposes an equivalent list and passes axe', async ({ page }) => {
    await login(page);
    await page.goto(`/marketing-ops/production/week?date=${anchorDate}&status=draft`);

    await expect(page.getByRole('grid', { name: 'Calendário semanal' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lista acessível do período' })).toBeVisible();
    await expect(page.getByText('America/Sao_Paulo', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Próxima semana' }).click();
    await expect(page).toHaveURL(/\/marketing-ops\/production\/week\?[^#]*date=\d{4}-\d{2}-\d{2}/);
    await expect(page).toHaveURL(/status=draft/);
    await expectNoWcagViolations(page);
  });

  test('@mobile month contains wide grid scrolling, keeps the document bounded and passes axe', async ({ page }) => {
    await login(page);
    await page.goto(`/marketing-ops/production/month?date=${anchorDate}`);

    const calendar = page.getByRole('grid', { name: 'Calendário mensal' });
    await expect(calendar).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lista acessível do período' })).toBeVisible();
    const dimensions = await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="production-calendar-scroll"]') as HTMLElement | null;
      return {
        innerWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        calendarClientWidth: scroll?.clientWidth ?? 0,
        calendarScrollWidth: scroll?.scrollWidth ?? 0
      };
    });
    expect(dimensions.innerWidth).toBe(390);
    expect(dimensions.documentWidth).toBe(390);
    expect(dimensions.calendarScrollWidth).toBeGreaterThan(dimensions.calendarClientWidth);
    await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeVisible();
    await expectNoWcagViolations(page);
  });
});
