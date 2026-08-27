import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { APPROVAL_REQUEST, enabled, installHermesOperatorFakeStack } from './helpers/hermesOperatorFake';

test.describe('Phase 5 approval governance local browser contract', () => {
  test.skip(!enabled, 'Set MARKETING_OPS_HERMES_E2E_FAKE=true to run the browser gate.');

  test.beforeEach(async ({ page }) => { await installHermesOperatorFakeStack(page); });

  test('lists a frozen operational package and records one human decision', async ({ page }) => {
    await page.goto('/marketing-ops/approvals');
    await expect(page.getByRole('heading', { name: 'Aprovações de negócio' })).toBeVisible();
    await expect(page.getByText('Risco crítico')).toBeVisible();
    await page.getByText('Autorizar envio de homologação').click();
    await expect(page).toHaveURL(new RegExp(`/marketing-ops/approvals/${APPROVAL_REQUEST}$`));
    await expect(page.getByText('Pacote operacional imutável')).toBeVisible();
    await expect(page.getByText('a'.repeat(64))).toBeVisible();
    await page.getByRole('button', { name: 'Aprovar' }).click();
    await expect(page.getByRole('button', { name: 'Confirmar decisão' })).toBeDisabled();
    await page.getByLabel('Confirmar risco crítico').check();
    await page.getByRole('button', { name: 'Confirmar decisão' }).click();
    await expect(page.getByText(/Decisão: approved/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprovar' })).toHaveCount(0);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((violation) => violation.impact === 'critical')).toEqual([]);
  });

  test('keeps the approval queue usable without horizontal overflow @mobile', async ({ page }) => {
    await page.goto('/marketing-ops/approvals?status=pending&kind=operational');
    await expect(page.getByRole('heading', { name: 'Aprovações de negócio' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByText('Autorizar envio de homologação').click();
    await expect(page.getByText('Pacote operacional imutável')).toBeVisible();
  });
});
