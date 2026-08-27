import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createMarketingOpsClient, MarketingOpsApiError } from '../src/lib/marketingOps/client';

type TestRole = 'member' | 'manager' | 'admin';

const enabled = process.env.MARKETING_OPS_E2E_ENABLED === 'true';
const fixturePrefix = '[E2E-PHASE2]';
const phase3FixturePrefix = '[E2E-PHASE3]';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when MARKETING_OPS_E2E_ENABLED=true`);
  return value;
}

function credentials(role: TestRole): { email: string; password: string } {
  const prefix = `MARKETING_OPS_E2E_${role.toUpperCase()}`;
  return {
    email: requiredEnv(`${prefix}_EMAIL`),
    password: requiredEnv(`${prefix}_PASSWORD`)
  };
}

function dateFromNow(offsetDays: number): string {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function dateTimeFromNow(offsetDays: number, time = '10:00'): string {
  return `${dateFromNow(offsetDays)}T${time}`;
}

async function accessToken(role: TestRole): Promise<string> {
  const account = credentials(role);
  const supabaseUrl = requiredEnv('MARKETING_OPS_E2E_SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = requiredEnv('MARKETING_OPS_E2E_SUPABASE_ANON_KEY');
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(account)
  });
  const payload = await response.json() as { access_token?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`controlled ${role} authentication failed`);
  }
  return payload.access_token;
}

async function apiClient(role: TestRole) {
  const token = await accessToken(role);
  return createMarketingOpsClient({
    baseUrl: requiredEnv('MARKETING_OPS_E2E_API_URL'),
    getAccessToken: async () => token
  });
}

async function deleteControlledArtifact(artifactId: string): Promise<void> {
  const response = await fetch(
    `${requiredEnv('MARKETING_OPS_E2E_ARTIFACT_URL').replace(/\/+$/, '')}/v1/artifacts/${encodeURIComponent(artifactId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${requiredEnv('MARKETING_OPS_E2E_ARTIFACT_INTERNAL_KEY')}`
      }
    }
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`controlled artifact cleanup failed with ${response.status}`);
  }
}

async function login(page: Page, role: TestRole): Promise<void> {
  const account = credentials(role);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(account.email);
  await page.getByLabel('Senha').fill(account.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Login realizado com sucesso!')).toBeVisible();
  await page.goto('/marketing-ops/campaigns');
  await expect(page.getByRole('heading', { name: 'Campanhas' })).toBeVisible();
}

async function createCampaign(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Nova campanha' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nova campanha' });
  await dialog.getByLabel('Nome').fill(name);
  await dialog.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page).toHaveURL(/\/marketing-ops\/campaigns\/[0-9a-f-]{36}$/i);
  return page.url();
}

async function archiveCampaign(page: Page): Promise<void> {
  const archive = page.getByRole('button', { name: 'Arquivar campanha' });
  await expect(archive).toBeVisible();
  await archive.click();
  const dialog = page.getByRole('alertdialog', { name: 'Arquivar campanha' });
  await dialog.getByRole('button', { name: 'Confirmar arquivamento' }).click();
  await expect(page.getByText(/somente leitura/i)).toBeVisible();
}

async function expectNoWcagViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length }))).toEqual([]);
}

test.describe('Marketing Ops integrated Phase 2 and 3 journeys', () => {
  test.skip(!enabled, 'Set MARKETING_OPS_E2E_ENABLED=true only in the controlled VPS gate.');

  test('manager completes collaboration, material and timeline flow', async ({ page }) => {
    const name = `${fixturePrefix} manager ${Date.now()}`;
    let participantAdded = false;
    let materialLinked = false;
    await login(page, 'manager');
    await createCampaign(page, name);

    try {
      await page.getByLabel('Objetivo').fill('Validar a jornada operacional E2E');
      await page.getByLabel('Tipo de referência').selectOption('course');
      const courseQuery = requiredEnv('MARKETING_OPS_E2E_COURSE_QUERY');
      const courseTitle = requiredEnv('MARKETING_OPS_E2E_COURSE_TITLE');
      await page.getByRole('searchbox', { name: 'Buscar curso oficial' }).fill(courseQuery);
      await page.getByRole('button', { name: courseTitle }).click();
      await expect(page.getByText(courseTitle, { exact: true })).toBeVisible();
      await page.getByLabel('Público').fill('Tenant controlado de testes');
      await page.getByLabel('Início').fill(dateFromNow(1));
      await page.getByLabel('Término').fill(dateFromNow(8));
      await page.getByLabel('Canal principal').selectOption('email');
      await page.getByLabel('Briefing').fill('Conteúdo sintético marcado para o gate da Fase 2.');
      await page.getByRole('button', { name: 'Salvar alterações' }).click();
      await expect(page.getByText(/versão 2/i)).toBeVisible();

      const candidateName = requiredEnv('MARKETING_OPS_E2E_CANDIDATE_NAME');
      await page.getByRole('button', { name: 'Adicionar participante' }).click();
      const participantDialog = page.getByRole('dialog', { name: 'Adicionar participante' });
      await participantDialog.getByLabel('Buscar pessoa').fill(candidateName);
      await participantDialog.getByRole('button', { name: `Selecionar ${candidateName}` }).click();
      await participantDialog.getByRole('button', { name: 'Confirmar participante' }).click();
      participantAdded = true;
      await expect(page.getByText(candidateName)).toBeVisible();

      const artifactId = requiredEnv('MARKETING_OPS_E2E_EXISTING_ARTIFACT_ID');
      await page.getByRole('button', { name: 'Vincular existente' }).click();
      const materialDialog = page.getByRole('dialog', { name: 'Vincular artefato existente' });
      await materialDialog.getByLabel('ID do artefato').fill(artifactId);
      await materialDialog.getByRole('button', { name: 'Confirmar vínculo' }).click();
      materialLinked = true;
      await expect(page.getByText('1 material')).toBeVisible();

      let uploadRequests = 0;
      page.on('request', (request) => {
        if (request.url().includes('/materials/upload')) uploadRequests += 1;
      });
      await page.locator('#campaign-material-upload').setInputFiles({
        name: 'oversized.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(25 * 1024 * 1024 + 1)
      });
      await expect(page.getByText(/máximo de 25 MiB/i)).toBeVisible();
      expect(uploadRequests).toBe(0);

      await page.getByRole('button', { name: 'Planejar' }).click();
      await expect(page.getByText('Planejada')).toBeVisible();
      await expect(page.getByText(/Participante adicionado|Material vinculado/).first()).toBeVisible();
      await expectNoWcagViolations(page);
    } finally {
      try {
        if (materialLinked) {
          await page.getByRole('button', { name: /^Desvincular / }).click();
          await page.getByRole('alertdialog', { name: 'Desvincular material' })
            .getByRole('button', { name: 'Confirmar desvínculo' }).click();
          await expect(page.getByText('0 materiais')).toBeVisible();
        }
        if (participantAdded) {
          const candidateName = requiredEnv('MARKETING_OPS_E2E_CANDIDATE_NAME');
          await page.getByRole('button', { name: `Remover ${candidateName}` }).click();
          await page.getByRole('alertdialog', { name: 'Remover participante' })
            .getByRole('button', { name: 'Confirmar remoção' }).click();
          await expect(page.getByText(candidateName)).toHaveCount(0);
        }
      } finally {
        await archiveCampaign(page);
      }
    }

    await page.goto('/marketing-ops/campaigns');
    await page.getByRole('searchbox', { name: 'Buscar campanhas' }).fill(name);
    await page.getByLabel('Status').selectOption('archived');
    await expect(page).toHaveURL(/q=.*E2E-PHASE2.*&status=archived|status=archived.*&q=.*E2E-PHASE2/i);
    await expect(page.getByRole('button', { name }).first()).toBeVisible();
    await page.getByRole('button', { name }).first().click();
    await expect(page.getByText(/somente leitura/i)).toBeVisible();
  });

  test('manager receives a version conflict across two sessions without losing local values', async ({ page, browser }) => {
    const name = `${fixturePrefix} conflict ${Date.now()}`;
    await login(page, 'manager');
    const campaignUrl = await createCampaign(page, name);
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();

    try {
      await login(secondPage, 'manager');
      await secondPage.goto(campaignUrl);
      await expect(secondPage.getByRole('heading', { name })).toBeVisible();

      await page.getByLabel('Notas').fill('Valor salvo pela sessão A');
      await page.getByRole('button', { name: 'Salvar alterações' }).click();
      await expect(page.getByText(/versão 2/i)).toBeVisible();

      await secondPage.getByLabel('Notas').fill('Valor local preservado pela sessão B');
      await secondPage.getByRole('button', { name: 'Salvar alterações' }).click();
      const conflict = secondPage.getByRole('dialog', { name: 'Conflito de versão' });
      await expect(conflict.getByText('Valor local preservado pela sessão B')).toBeVisible();
      await conflict.getByRole('button', { name: 'Reaplicar minhas alterações' }).click();
      await expect(secondPage.getByLabel('Notas')).toHaveValue('Valor local preservado pela sessão B');
    } finally {
      await secondContext.close();
      await page.reload();
      await archiveCampaign(page);
    }
  });

  test('manager completes the phase-3 production, dependency, content, artifact, notification and batch journey', async ({ page }) => {
    const manager = await apiClient('manager');
    const campaignName = `${phase3FixturePrefix} production ${Date.now()}`;
    const predecessorTitle = `${phase3FixturePrefix} predecessor ${Date.now()}`;
    const itemTitle = `${phase3FixturePrefix} email ${Date.now()}`;
    let campaignId: string | null = null;
    let artifactId: string | null = null;

    await login(page, 'manager');
    try {
      const campaign = await manager.createCampaign({ name: campaignName }, crypto.randomUUID());
      campaignId = campaign.data.id;
      const predecessor = await manager.createProductionItem({
        campaignId,
        kind: 'task',
        title: predecessorTitle,
        assigneeUserId: '22222222-2222-4222-8222-222222222222',
        startsAt: new Date(`${dateFromNow(2)}T12:00:00.000Z`).toISOString(),
        dueAt: new Date(`${dateFromNow(3)}T12:00:00.000Z`).toISOString()
      }, crypto.randomUUID());
      const dependent = await manager.createProductionItem({
        campaignId,
        kind: 'email',
        title: itemTitle,
        assigneeUserId: '22222222-2222-4222-8222-222222222222',
        startsAt: new Date(`${dateFromNow(3)}T12:00:00.000Z`).toISOString(),
        dueAt: new Date(`${dateFromNow(4)}T14:00:00.000Z`).toISOString()
      }, crypto.randomUUID());

      const dependency = await manager.addProductionItemDependency(
        dependent.data.id,
        predecessor.data.id,
        dependent.data.version,
        crypto.randomUUID()
      );
      const asset = await manager.createContentAsset(
        dependent.data.id,
        dependency.data.itemVersion,
        { assetKind: 'email_body', title: `${phase3FixturePrefix} body` },
        crypto.randomUUID()
      );
      const contentVersion = await manager.createContentVersion(
        asset.data.id,
        asset.data.version,
        {
          body: 'Synthetic controlled Phase 3 content.',
          metadata: { fixture: phase3FixturePrefix },
          freeze: true
        },
        crypto.randomUUID()
      );
      expect(contentVersion.data.frozenAt).not.toBeNull();

      const uploaded = await manager.uploadProductionItemArtifact(
        dependent.data.id,
        asset.data.itemVersion,
        new File(
          [Buffer.from('controlled phase 3 artifact\n')],
          `${phase3FixturePrefix}-artifact.txt`,
          { type: 'text/plain' }
        ),
        crypto.randomUUID(),
        asset.data.id
      );
      artifactId = uploaded.data.artifact.artifactId;
      const access = await manager.createProductionItemArtifactAccessLink(
        dependent.data.id,
        uploaded.data.artifact.id
      );
      expect(new URL(access.data.url).protocol).toMatch(/^https?:$/);
      const unlinked = await manager.unlinkProductionItemArtifact(
        dependent.data.id,
        uploaded.data.artifact.id,
        uploaded.data.itemVersion,
        crypto.randomUUID()
      );
      await deleteControlledArtifact(artifactId);
      artifactId = null;

      const notifications = await manager.listInAppNotifications({ unreadOnly: true, limit: 25 });
      expect(notifications.data.some((notification) => (
        notification.itemId === dependent.data.id
        && notification.label === 'Novo item atribuído'
      ))).toBe(true);
      expect(JSON.stringify(notifications.data)).not.toContain(itemTitle);

      await page.goto(`/marketing-ops/production?campaignId=${campaignId}`);
      await expect(page.getByText(itemTitle, { exact: true }).first()).toBeVisible();
      await page.getByRole('checkbox', { name: `Selecionar ${itemTitle}` }).check();
      await page.getByRole('button', { name: 'Lote (1)' }).click();
      const batchDialog = page.getByRole('dialog', { name: 'Ação em lote' });
      await batchDialog.getByRole('combobox', { name: 'Nova prioridade' }).selectOption('high');
      await batchDialog.getByRole('button', { name: 'Aplicar em 1 item' }).click();
      await expect(batchDialog.getByText('1 atualizado')).toBeVisible();
      await expect(batchDialog.getByText('0 falharam')).toBeVisible();
      await batchDialog.getByRole('button', { name: 'Fechar' }).click();

      await page.getByRole('button', { name: `Abrir item ${itemTitle}` }).click();
      const itemDialog = page.getByRole('dialog', { name: 'Detalhes do item' });
      await itemDialog.getByLabel(/Início/).fill(dateTimeFromNow(4, '09:00'));
      await itemDialog.getByLabel(/Prazo/).fill(dateTimeFromNow(5, '11:00'));
      const updateResponse = page.waitForResponse((response) => (
        response.url().includes(`/v1/campaign-items/${dependent.data.id}`)
        && response.request().method() === 'PATCH'
      ));
      await itemDialog.getByRole('button', { name: 'Salvar alterações' }).click();
      expect((await updateResponse).status()).toBe(200);
      await itemDialog.getByRole('button', { name: 'Fechar' }).click();

      await page.goto(`/marketing-ops/production/week?date=${dateFromNow(5)}&campaignId=${campaignId}`);
      await expect(page.getByRole('grid', { name: 'Calendário semanal' })).toBeVisible();
      await expect(page.getByText(itemTitle, { exact: true }).first()).toBeVisible();
      await expectNoWcagViolations(page);

      await page.goto(`/marketing-ops/production?campaignId=${campaignId}`);
      const notificationButton = page.getByRole('button', { name: /Notificações, \d+ não lidas/ });
      await notificationButton.click();
      const notificationDialog = page.getByRole('dialog', { name: 'Notificações' });
      await expect(notificationDialog.getByText('Novo item atribuído').first()).toBeVisible();
      await expect(notificationDialog.getByText(itemTitle)).toHaveCount(0);
      const markAll = notificationDialog.getByRole('button', { name: 'Marcar todas como lidas' });
      if (await markAll.count()) await markAll.click();

      const currentDependent = await manager.getProductionItem(dependent.data.id);
      const readyDependent = await manager.transitionProductionItem(
        dependent.data.id,
        currentDependent.data.version,
        'ready',
        crypto.randomUUID()
      );
      const reviewDependent = await manager.transitionProductionItem(
        dependent.data.id,
        readyDependent.data.version,
        'in_review',
        crypto.randomUUID()
      );
      await expect(manager.transitionProductionItem(
        dependent.data.id,
        reviewDependent.data.version,
        'completed',
        crypto.randomUUID()
      )).rejects.toMatchObject({
        code: 'item_blocked',
        status: 409
      } satisfies Partial<MarketingOpsApiError>);

      const readyPredecessor = await manager.transitionProductionItem(
        predecessor.data.id,
        predecessor.data.version,
        'ready',
        crypto.randomUUID()
      );
      const reviewPredecessor = await manager.transitionProductionItem(
        predecessor.data.id,
        readyPredecessor.data.version,
        'in_review',
        crypto.randomUUID()
      );
      await manager.transitionProductionItem(
        predecessor.data.id,
        reviewPredecessor.data.version,
        'completed',
        crypto.randomUUID()
      );
      const completed = await manager.transitionProductionItem(
        dependent.data.id,
        reviewDependent.data.version,
        'completed',
        crypto.randomUUID()
      );
      expect(completed.data.status).toBe('completed');
      expect(unlinked.data.itemVersion).toBeGreaterThan(uploaded.data.itemVersion);
    } finally {
      if (artifactId) await deleteControlledArtifact(artifactId);
      if (campaignId) {
        const current = await manager.getCampaign(campaignId);
        if (current.data.status !== 'archived') {
          await manager.archiveCampaign(campaignId, current.data.version, crypto.randomUUID());
        }
      }
    }
  });

  test('manager and admin reach the campaign workspace while a viewer fails closed', async ({ browser }) => {
    for (const role of ['manager', 'admin'] as const) {
      const context = await browser.newContext();
      const rolePage = await context.newPage();
      await login(rolePage, role);
      await expect(rolePage.getByRole('button', { name: 'Nova campanha' }).first()).toBeVisible();
      await rolePage.goto('/marketing-ops/production');
      await expect(rolePage.getByRole('button', { name: 'Lote (0)' })).toBeVisible();
      await context.close();
    }

    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await login(viewerPage, 'member');
    await viewerPage.goto(`/marketing-ops/campaigns/${requiredEnv('MARKETING_OPS_E2E_VIEWER_CAMPAIGN_ID')}`);
    await expect(viewerPage.getByText(/somente leitura/i)).toBeVisible();
    await expect(viewerPage.getByRole('button', { name: 'Salvar alterações' })).toHaveCount(0);
    await expect(viewerPage.getByRole('button', { name: 'Adicionar participante' })).toHaveCount(0);
    await expect(viewerPage.getByText('Adicionar material')).toHaveCount(0);
    await viewerPage.goto('/marketing-ops/production');
    await expect(viewerPage.getByRole('heading', { name: 'Esteira de produção' })).toBeVisible();
    await expect(viewerPage.getByRole('button', { name: 'Lote (0)' })).toHaveCount(0);
    await viewerContext.close();
  });

  test('@mobile renders the campaign workspace without overflow and passes axe', async ({ page }) => {
    await login(page, 'manager');
    await page.goto(`/marketing-ops/campaigns/${requiredEnv('MARKETING_OPS_E2E_VIEWER_CAMPAIGN_ID')}`);
    await expect(page.getByRole('heading', { name: 'Essenciais' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pessoas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Materiais' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Atividade' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions).toEqual({ innerWidth: 390, scrollWidth: 390 });
    await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeVisible();
    await expectNoWcagViolations(page);
  });
});
