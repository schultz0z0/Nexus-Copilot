import { expect, test } from '@playwright/test';
import { installHermesOperatorFakeStack } from './helpers/hermesOperatorFake';

const enabled = process.env.MARKETING_OPS_KILL_SWITCH_E2E === 'true';

test.describe('Marketing Ops frontend kill switch', () => {
  test.skip(!enabled, 'Set MARKETING_OPS_KILL_SWITCH_E2E=true to run the browser gate.');

  test('removes navigation and fails closed for a direct Marketing Ops URL', async ({ page }) => {
    await installHermesOperatorFakeStack(page);
    await page.goto('/marketing-ops/campaigns');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Abrir campanhas' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Abrir esteira de produção' })).toHaveCount(0);
  });
});
