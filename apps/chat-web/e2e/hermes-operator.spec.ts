import { expect, test } from '@playwright/test';
import { ASSET, ITEM } from './helpers/hermesOperatorFixtures';
import { enabled, installHermesOperatorFakeStack } from './helpers/hermesOperatorFake';

test.describe('Hermes Campaign Operator fake end-to-end', () => {
  test.skip(!enabled, 'Set MARKETING_OPS_HERMES_E2E_FAKE=true to run the browser gate.');

  test('requires confirmation first and then opens the returned deep link in the production workspace', async ({ page }) => {
    await installHermesOperatorFakeStack(page);
    await page.goto('/');

    await expect(page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...')).toBeVisible();
    await page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...')
      .fill('Crie um rascunho para a campanha de Pós 2026 e gere checklist de email.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();

    await expect(page.getByText('Plano pronto para confirmar.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir item e conteúdo' })).toHaveCount(0);

    await page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...').fill('aprovado');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();

    const deepLink = page.getByRole('link', { name: 'Abrir item e conteúdo' });
    await expect(page.getByText('Operação concluída no Marketing Ops.')).toBeVisible();
    await expect(deepLink).toHaveAttribute('href', `/marketing-ops/production/items/${ITEM}?contentAssetId=${ASSET}`);

    await deepLink.click();
    await expect(page).toHaveURL(new RegExp(`/marketing-ops/production/items/${ITEM}\\?contentAssetId=${ASSET}`));

    const dialog = page.getByRole('dialog', { name: 'Detalhes do item' });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel('Conteúdo selecionado')).toContainText('Copy principal');
    await expect(page.getByLabel('Conteúdo selecionado')).toContainText('Conteúdo copy · versão 1');
  });

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
