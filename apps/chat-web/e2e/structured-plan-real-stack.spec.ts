import { expect, test } from '@playwright/test';

const enabled = process.env.MARKETING_OPS_REAL_STACK_E2E === 'true';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the real-stack plan gate`);
  return value;
}

test.describe('Structured plan card against the disposable real stack', () => {
  test.skip(!enabled, 'Run only from the isolated stack rehearsal.');

  test('renders the actor-scoped persisted plan without parsing assistant text', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(required('MARKETING_OPS_REAL_STACK_EMAIL'));
    await page.getByLabel('Senha').fill(required('MARKETING_OPS_REAL_STACK_PASSWORD'));
    const loginResponse = page.waitForResponse((response) => (
      response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'
    ));
    await page.getByRole('button', { name: 'Entrar' }).click();
    expect((await loginResponse).status()).toBe(200);

    await page.goto(`/?chat=${encodeURIComponent(required('MARKETING_OPS_REAL_STACK_SESSION_ID'))}`);
    const card = page.getByTestId(`agent-plan-${required('MARKETING_OPS_REAL_STACK_PLAN_ID')}`);
    await expect(card).toBeVisible();
    await expect(card.getByText('Solicitar aprovação operacional')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Executar plano' })).toBeEnabled();
  });
});
