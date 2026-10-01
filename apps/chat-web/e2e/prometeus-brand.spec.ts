import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { enabled, installHermesOperatorFakeStack } from './helpers/hermesOperatorFake';

// Local fixtures only: never authenticate against or mutate a real environment.
test.skip(!enabled, 'Run with E2E_FAKE_MODE=marketing-ops.');

async function checkContrast(page: Page) {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(results.violations).toEqual([]);
}

async function checkWidth(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('Prometeus login retains readable fields and keyboard focus', async ({ page }) => {
  await installHermesOperatorFakeStack(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Bem-vindo à Prometeus' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Prometeus' })).toBeVisible();
  await expect(page).toHaveTitle('Prometeus');
  await page.getByLabel('E-mail', { exact: true }).focus();
  await expect(page.getByLabel('E-mail', { exact: true })).toBeFocused();
  await checkContrast(page);
  await page.screenshot({ path: '../../tmp/brand-review/login-desktop.png', fullPage: true });
});

test('Prometeus surfaces retain contrast across chat, tables and dialogs', async ({ page }) => {
  await installHermesOperatorFakeStack(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Amplie a capacidade/ })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Mascote robô da Prometeus' })).toBeVisible();
  await expect(page.getByText('Vamos crescer? 👋')).toBeVisible();
  await expect(page.getByText('Potencialize já! ✨')).toBeVisible();
  await checkContrast(page);
  await checkWidth(page);
  await page.screenshot({ path: '../../tmp/brand-review/chat-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Abrir ações rápidas' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await checkContrast(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Abrir ações rápidas' })).toBeFocused();
  await page.getByRole('button', { name: 'Abrir campanhas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Campanhas', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir campanha Campanha Pós 2026' })).toBeVisible();
  await checkContrast(page);
  await page.screenshot({ path: '../../tmp/brand-review/campaigns-desktop.png', fullPage: true });
  await page.getByLabel('Responsável', { exact: true }).fill('invalid-id');
  await page.getByLabel('Responsável', { exact: true }).press('Tab');
  await expect(page.getByText('Informe um ID de usuário válido.')).toBeVisible();
  await checkContrast(page);
  await page.getByLabel('Responsável', { exact: true }).clear();
  await page.getByRole('button', { name: 'Nova campanha', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova campanha' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Nome', { exact: true })).toBeFocused();
  await checkContrast(page);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Abrir esteira de produção' }).click();
  await expect(page.getByRole('heading', { name: 'Esteira de produção', exact: true })).toBeVisible();
  await checkContrast(page);
});

test('Prometeus mobile keeps branding, navigation and composer usable @mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installHermesOperatorFakeStack(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Amplie a capacidade/ })).toBeVisible();
  await checkWidth(page);
  await checkContrast(page);
  await page.screenshot({ path: '../../tmp/brand-review/chat-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abrir campanhas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir campanhas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Campanhas', exact: true })).toBeVisible();
  await checkWidth(page);
  await checkContrast(page);
  await page.screenshot({ path: '../../tmp/brand-review/campaigns-mobile.png', fullPage: true });
});
