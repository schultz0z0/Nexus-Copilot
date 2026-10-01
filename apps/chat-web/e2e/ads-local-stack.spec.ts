import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.skip(process.env.LOCAL_ADS_SMOKE !== 'true', 'Requires explicit localhost connector smoke mode.');
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

for (const title of ['Ads integrations expose honest setup states through the real BFF', '@mobile Ads integrations expose honest setup states through the real BFF']) {
  test(title, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Only localhost is allowed.');
    const local = parse(readFileSync(new URL('../../../.env.local', import.meta.url)));
    const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: local.DEV_USER_EMAIL, password: local.DEV_USER_PASSWORD }) });
    expect(login.status).toBe(200);
    const session = login.headers.getSetCookie().find(value => value.startsWith('ens_session='))?.split(';')[0];
    if (!session) throw new Error('Local session is unavailable.');
    try {
      const response = await fetch(`${origin}/api/marketing/ads-integrations`, { headers: { Cookie: session } });
      expect(response.status).toBe(200);
      const data = (await response.json()).data;
      expect(data.map((row: { provider: string }) => row.provider).sort()).toEqual(['google', 'linkedin', 'meta']);
      for (const row of data) {
        expect(row.status).toBe('unprepared');
        expect(Object.keys(row).sort()).toEqual(['accounts', 'capabilities', 'lastSyncAt', 'provider', 'safeError', 'selectedAccountId', 'status', 'version']);
      }
      const separator = session.indexOf('=');
      await page.context().addCookies([{ name: session.slice(0, separator), value: session.slice(separator + 1), url: origin, httpOnly: true, sameSite: 'Lax' }]);
      await page.goto('/settings/integrations');
      await expect(page.getByRole('heading', { name: 'Integrações', exact: true })).toBeVisible();
      for (const name of ['Meta Ads', 'Google Ads', 'LinkedIn Ads']) await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(page.getByText(/Não foi possível carregar/)).toHaveCount(0);
      const connect = page.getByRole('button', { name: /^(Conectar|Reconectar)/ });
      for (const button of await connect.all()) await expect(button).toBeDisabled();
      await expect(page.getByRole('button', { name: /Configurar aplicativo/ })).toHaveCount(3);
      for (const provider of ['meta', 'google', 'linkedin']) {
        const setupResponse = await fetch(`${origin}/api/marketing/ads-integrations/${provider}/setup`, { headers: { Cookie: session } });
        expect(setupResponse.status).toBe(200);
        const setup = (await setupResponse.json()).data;
        expect(setup).toMatchObject({ provider, mode: 'empty', version: 1, writable: true, ready: false, hasClientSecret: false, redirectUri: `${origin}/api/ads/oauth/${provider}/callback` });
        expect(setup).not.toHaveProperty('clientSecret');
      }
      for (const name of ['Meta Ads', 'Google Ads', 'LinkedIn Ads']) {
        const article = page.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
        const configure = article.getByRole('button', { name: /Configurar aplicativo/ });
        await configure.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('input[type="password"]')).toHaveCount(1);
        await expect(dialog.getByText(/api\/ads\/oauth\//)).toBeVisible();
        // Measure the final surface rather than the intermediate fade-in alpha.
        await dialog.evaluate(async element => {
          await Promise.all(element.getAnimations().map(animation => animation.finished));
        });
        await expect(dialog).toHaveCSS('opacity', '1');
        expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(configure).toBeFocused();
      }
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      const accessibility = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(accessibility.violations).toEqual([]);
    } finally {
      await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Cookie: session, 'content-type': 'application/json' }, body: '{}' });
      await page.context().clearCookies();
    }
  });
}
