import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { expect, test } from '@playwright/test';

// Read-only smoke against the user's local stack, separate from intercepted E2E.
// Sessions stay in memory; disable artifacts that could record auth cookies.
test.skip(process.env.LOCAL_STACK_SMOKE !== 'true', 'Requires explicit local-stack smoke mode.');
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('campaigns and production load through the real authenticated BFF', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Local stack smoke must use loopback.');
  const env = parse(readFileSync(new URL('../../../.env.local', import.meta.url)));
  if (!env.DEV_USER_EMAIL || !env.DEV_USER_PASSWORD) throw new Error('Local evaluation credentials are unavailable.');
  // Node fetch is intentionally outside Playwright tracing. Never log this body.
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.DEV_USER_EMAIL, password: env.DEV_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  const session = login.headers.getSetCookie().find(cookie => cookie.startsWith('ens_session='))?.split(';')[0];
  if (!session) throw new Error('Local login did not establish a session.');
  const separator = session.indexOf('=');
  try {
    await page.context().addCookies([{ name: session.slice(0, separator), value: session.slice(separator + 1), url: origin, httpOnly: true, sameSite: 'Lax' }]);
    for (const route of [
      { page: '/marketing-ops/campaigns', api: '/api/marketing/campaigns', heading: 'Campanhas', loading: 'Carregando campanhas', empty: 'Nenhuma campanha ainda' },
      { page: '/marketing-ops/production', api: '/api/marketing/campaign-items', heading: 'Esteira de produção', loading: 'Carregando produção', empty: 'Nenhum item de produção ainda' },
    ]) {
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === route.api && response.request().method() === 'GET'),
        page.goto(route.page),
      ]);
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(Array.isArray(payload.data)).toBe(true);
      await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible();
      await expect(page.locator(`[aria-label="${route.loading}"]`)).toHaveCount(0);
      await expect(page.getByText(/Não foi possível carregar/)).toHaveCount(0);
      if (payload.data.length === 0) await expect(page.getByText(route.empty, { exact: true })).toBeVisible();
    }
  } finally {
    await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: session, 'Content-Type': 'application/json' }, body: '{}' });
    await page.context().clearCookies();
  }
});

for (const name of ['incomplete planning explains the actual API requirements', '@mobile incomplete planning explains the actual API requirements']) {
  test(name, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Local stack smoke must use loopback.');
    const env = parse(readFileSync(new URL('../../../.env.local', import.meta.url)));
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.DEV_USER_EMAIL, password: env.DEV_USER_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const session = login.headers.getSetCookie().find(cookie => cookie.startsWith('ens_session='))?.split(';')[0];
    if (!session) throw new Error('Local login did not establish a session.');
    const separator = session.indexOf('=');
    const read = async (path: string) => {
      const response = await fetch(`${origin}/api/marketing${path}`, { headers: { Cookie: session } });
      expect(response.status).toBe(200);
      return (await response.json()).data;
    };
    try {
      // Exercise the failed transition only when the real record is still
      // incomplete. Never transition a ready campaign or change the user's data.
      const campaigns = await read('/campaigns?limit=25');
      const summary = campaigns.find((campaign: { name: string; status: string }) => campaign.name === 'Graduação' && campaign.status === 'draft');
      test.skip(!summary, 'Requires the reported local draft.');
      const before = await read(`/campaigns/${summary.id}`);
      test.skip(Boolean(before.referenceType && before.referenceTitleSnapshot && before.startsOn && before.endsOn), 'Do not transition a completed plan.');
      await page.context().addCookies([{ name: session.slice(0, separator), value: session.slice(separator + 1), url: origin, httpOnly: true, sameSite: 'Lax' }]);
      await page.goto(`/marketing-ops/campaigns/${summary.id}`);
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === `/api/marketing/campaigns/${summary.id}/transitions` && response.request().method() === 'POST'),
        page.getByRole('button', { name: 'Planejar', exact: true }).click(),
      ]);
      expect(response.status()).toBe(422);
      const payload = await response.json();
      expect(payload.error.code).toBe('campaign_requirements_missing');
      const labels: Record<string, string> = {
        referenceType: 'Tipo de referência', referenceTitleSnapshot: 'Título da referência',
        startsOn: 'Início', endsOn: 'Término', objective: 'Objetivo',
        primaryOwner: 'Responsável principal', name: 'Nome',
      };
      const alert = page.getByRole('alert');
      await expect(alert).toContainText('Seu rascunho foi preservado.');
      for (const field of payload.error.details.fields) await expect(alert).toContainText(labels[field]);
      await expect(alert).not.toContainText('Campaign is missing');
      // Keyboard activation, focus and reflow on both viewport sizes.
      const complete = page.getByRole('button', { name: 'Completar planejamento' });
      await complete.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('tab', { name: 'Planejamento', exact: true })).toHaveAttribute('data-state', 'active');
      await expect(page.getByLabel('Tipo de referência', { exact: true })).toBeFocused();
      await expect(page.getByLabel('Objetivo', { exact: true })).toHaveValue(before.objective ?? '');
      await expect(page.getByRole('textbox', { name: 'Briefing', exact: true })).toHaveValue(before.briefing ?? '');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await read(`/campaigns/${summary.id}`)).toEqual(before);
    } finally {
      await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: session, 'Content-Type': 'application/json' }, body: '{}' });
      await page.context().clearCookies();
    }
  });
}
