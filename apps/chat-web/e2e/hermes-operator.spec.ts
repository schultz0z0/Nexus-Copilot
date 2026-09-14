import { expect, test } from '@playwright/test';
import { enabled, installHermesOperatorFakeStack } from './helpers/hermesOperatorFake';

test.describe('Hermes Campaign Operator fake end-to-end', () => {
  test.skip(!enabled, 'Set MARKETING_OPS_HERMES_E2E_FAKE=true to run the browser gate.');

  test('shows controlled unavailability without inventing a deep link or success state', async ({ page }) => {
    await installHermesOperatorFakeStack(page);
    await page.goto('/');

    await page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...')
      .fill('Liste minhas campanhas indisponivel');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();

    await expect(page.getByText('Não consegui consultar o Marketing Ops agora.')).toBeVisible();
    await expect(page.getByText('Nenhuma alteração foi persistida.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir item e conteúdo' })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`\\?chat=`));
  });
});
