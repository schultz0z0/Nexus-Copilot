import { expect, test } from '@playwright/test';
import { enabled, installHermesOperatorFakeStack } from './helpers/hermesOperatorFake';

const killSwitchEnabled = process.env.MARKETING_OPS_KILL_SWITCH_E2E === 'true';

test.describe('Structured Marketing Ops plan execution', () => {
  test.skip(!enabled || killSwitchEnabled, 'Run with the Marketing Ops Hermes fake and kill switch disabled.');

  test('renders only the trusted prepared plan and executes it without a second Hermes run', async ({ page }) => {
    const state = await installHermesOperatorFakeStack(page, { seedApprovalQueue: false });
    await page.goto('/');

    const composer = page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...');
    await composer.fill('Prepare uma solicitação operacional inerte para homologação.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();

    await expect(page.getByText('Plano de Marketing Ops')).toBeVisible();
    await expect(page.getByText('Solicitar aprovação operacional')).toBeVisible();
    await expect(page.getByText(/campaign\.channel_dispatch/)).toBeVisible();
    await expect(page.getByText(/Autorizar envio inerte de homologação/)).toBeVisible();

    await page.getByRole('button', { name: 'Executar plano' }).click();

    await expect.poll(() => state.approvalRequestsCreated).toBe(1);
    expect(state.planExecuteRequests).toBe(1);
    expect(state.approvalDecisionsCreated).toBe(0);
    expect(state.externalActionsExecuted).toBe(0);
    expect(state.bridgeRunRequests).toBe(1);
    expect(state.executionKeys).toHaveLength(1);
    expect(state.executionKeys[0]).toMatch(/^[0-9a-f-]{36}$/i);
    const approval = await page.evaluate(async () => {
      const response = await fetch('/api/marketing/approval-requests?status=pending');
      return response.json();
    });
    expect(approval.data).toEqual([
      expect.objectContaining({ status: 'pending', decision: null }),
    ]);
  });

  test('does not turn assistant Markdown into an executable card', async ({ page }) => {
    await installHermesOperatorFakeStack(page, { seedApprovalQueue: false });
    await page.goto('/');

    const composer = page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...');
    await composer.fill('Mostre um markdown falso de plano para o teste.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();

    await expect(page.getByText('Plano Markdown não confiável')).toBeVisible();
    await expect(page.locator('article[aria-labelledby^="plan-title-"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Executar plano' })).toHaveCount(0);
  });

  test('reuses the idempotency key after a transient network failure', async ({ page }) => {
    const state = await installHermesOperatorFakeStack(page, {
      failFirstPlanExecution: true,
      seedApprovalQueue: false,
    });
    await page.goto('/');

    const composer = page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...');
    await composer.fill('Prepare uma solicitação operacional inerte para homologação.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();

    const execute = page.getByRole('button', { name: 'Executar plano' });
    await execute.click();
    await expect(page.getByText('Falha temporária de rede', { exact: true })).toBeVisible();
    await execute.click();

    await expect.poll(() => state.approvalRequestsCreated).toBe(1);
    expect(state.planExecuteRequests).toBe(2);
    expect(new Set(state.executionKeys).size).toBe(1);
    expect(state.bridgeRunRequests).toBe(1);
  });

  test('fails closed when the plan hash does not match the stored plan', async ({ page }) => {
    const state = await installHermesOperatorFakeStack(page, {
      mismatchedPlanHash: true,
      seedApprovalQueue: false,
    });
    await page.goto('/');

    const composer = page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...');
    await composer.fill('Prepare uma solicitação operacional inerte para homologação.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
    await page.getByRole('button', { name: 'Executar plano' }).click();

    await expect(page.getByText('O plano foi alterado', { exact: true })).toBeVisible();
    expect(state.approvalRequestsCreated).toBe(0);
    expect(state.externalActionsExecuted).toBe(0);
    expect(state.bridgeRunRequests).toBe(1);
  });

  test('does not execute an expired plan', async ({ page }) => {
    const state = await installHermesOperatorFakeStack(page, {
      expiredPlan: true,
      seedApprovalQueue: false,
    });
    await page.goto('/');

    const composer = page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...');
    await composer.fill('Prepare uma solicitação operacional inerte para homologação.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();

    await expect(page.getByRole('button', { name: 'Executar plano' })).toBeDisabled();
    expect(state.planExecuteRequests).toBe(0);
    expect(state.approvalRequestsCreated).toBe(0);
  });

  for (const boundary of ['cross-user', 'cross-tenant'] as const) {
    test(`does not expose a ${boundary} plan`, async ({ page }) => {
      const state = await installHermesOperatorFakeStack(page, {
        denyPlanAccess: true,
        seedApprovalQueue: false,
      });
      await page.goto('/');

      const composer = page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...');
      await composer.fill('Prepare uma solicitação operacional inerte para homologação.');
      await page.getByRole('button', { name: 'Enviar mensagem' }).click();

      await expect(page.getByText('Preparei uma solicitação operacional inerte para homologação.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Executar plano' })).toHaveCount(0);
      expect(state.planListRequests).toBeGreaterThan(0);
      expect(state.planExecuteRequests).toBe(0);
    });
  }
});

test.describe('Structured Marketing Ops plan execution kill switch', () => {
  test.skip(!enabled || !killSwitchEnabled, 'Run with the Marketing Ops Hermes fake and kill switch enabled.');

  test('does not query or render prepared plans', async ({ page }) => {
    const state = await installHermesOperatorFakeStack(page, { seedApprovalQueue: false });
    await page.goto('/');

    const composer = page.getByPlaceholder('Diga o que você quer criar hoje para sua marca...');
    await composer.fill('Prepare uma solicitação operacional inerte para homologação.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();

    await expect(page.getByText('Preparei uma solicitação operacional inerte para homologação.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Executar plano' })).toHaveCount(0);
    expect(state.planListRequests).toBe(0);
    expect(state.planExecuteRequests).toBe(0);
  });
});
