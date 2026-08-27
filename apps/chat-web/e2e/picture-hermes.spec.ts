import { expect, test, type Page, type Route } from '@playwright/test';

const enabled = process.env.PICTURE_HERMES_E2E_FAKE === 'true';
const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const WORKSPACE = '33333333-3333-4333-8333-333333333333';
const NEXT_WORKSPACE = '44444444-4444-4444-8444-444444444444';
const BRIEF = '55555555-5555-4555-8555-555555555555';
const FINAL = '66666666-6666-4666-8666-666666666666';
const RUN = '77777777-7777-4777-8777-777777777777';
const VALIDATED = '88888888-8888-4888-8888-888888888888';
const now = '2026-07-21T12:00:00.000Z';
const future = '2030-01-01T00:00:00.000Z';
const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

type WorkspaceStatus = 'drafting' | 'review' | 'validated';

const workspace = (id: string, status: WorkspaceStatus, candidate: string | null = null) => ({
  id,
  tenant_id: 'ens',
  user_id: USER,
  chat_session_id: SESSION,
  title: id === NEXT_WORKSPACE ? 'Nova peça' : 'Campanha Graduação ENS',
  status,
  active: true,
  version: status === 'drafting' ? 1 : status === 'review' ? 2 : 3,
  candidate_artifact_id: candidate,
  validated_artifact_id: status === 'validated' ? FINAL : null,
  validated_work_id: status === 'validated' ? VALIDATED : null,
  created_at: now,
  updated_at: now,
});

const generatedFiles = [
  {
    id: BRIEF,
    filename: 'brief.json',
    relative_path: 'brief/brief.json',
    category: 'brief',
    content_type: 'application/json',
    lifecycle: 'workspace',
    created_at: now,
  },
  {
    id: FINAL,
    filename: 'peca-final.png',
    relative_path: 'final/peca-final.png',
    category: 'final',
    content_type: 'image/png',
    lifecycle: 'workspace',
    created_at: now,
  },
];

const validatedWork = {
  id: VALIDATED,
  tenant_id: 'ens',
  artifact_type: 'peca_visual',
  title: 'Campanha Graduação ENS',
  content: '{}',
  status: 'validated',
  tags: ['picture-hermes'],
  artifact_id: FINAL,
  artifact_filename: 'peca-final.png',
  artifact_mime_type: 'image/png',
  artifact_width: 1080,
  artifact_height: 1350,
  validated_by_name: 'Gestora E2E',
  validated_at: now,
  created_at: now,
  updated_at: now,
};

const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:8088',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-tenant-id,x-user-id',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: cors,
  body: JSON.stringify(body),
});

const installSession = async (page: Page) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: USER,
    exp: Math.floor(Date.now() / 1000) + 86_400,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { tenant_id: 'ens' },
    user_metadata: { tenant_id: 'ens', full_name: 'Gestora E2E' },
  })}.picture-e2e`;
  await page.addInitScript(({ userId, token }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: token,
      refresh_token: 'picture-e2e-refresh',
      expires_in: 86_400,
      expires_at: Math.floor(Date.now() / 1000) + 86_400,
      token_type: 'bearer',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'gestora-picture@example.test',
        app_metadata: { tenant_id: 'ens' },
        user_metadata: { tenant_id: 'ens', full_name: 'Gestora E2E' },
        created_at: '2026-01-01T00:00:00.000Z',
      },
    }));
  }, { userId: USER, token: accessToken });
};

const installFakeStack = async (page: Page, seeded = false) => {
  let current = workspace(WORKSPACE, seeded ? 'review' : 'drafting', seeded ? FINAL : null);
  let files = seeded ? [...generatedFiles] : [];
  const messages: Array<Record<string, unknown>> = [];

  await page.route('http://127.0.0.1:55321/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    if (url.pathname.includes('/profiles')) {
      return json(route, { id: USER, role: 'manager', full_name: 'Gestora E2E', email: 'gestora-picture@example.test' });
    }
    if (url.pathname.includes('/validated_works')) return json(route, [validatedWork]);
    if (url.pathname.includes('/chat_messages')) {
      if (request.method() === 'GET') return json(route, messages);
      const posted = request.postDataJSON() as Record<string, unknown>;
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...posted };
      messages.push(row);
      return json(route, row, 201);
    }
    if (url.pathname.includes('/chat_sessions')) return json(route, request.method() === 'GET' ? [] : {});
    return json(route, []);
  });

  await page.route('http://127.0.0.1:18081/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/picture/workspace/current') return json(route, { workspace: current });
    if (/\/api\/picture\/workspaces\/[0-9a-f-]{36}\/files$/i.test(path)) return json(route, { files });
    if (/\/api\/picture\/workspaces\/[0-9a-f-]{36}\/approve$/i.test(path)) {
      current = workspace(WORKSPACE, 'validated', FINAL);
      files = files.map((file) => file.id === FINAL ? { ...file, lifecycle: 'validated' } : file);
      return json(route, { workspace: current });
    }
    if (/\/api\/picture\/workspaces\/[0-9a-f-]{36}\/new-piece$/i.test(path)) {
      current = workspace(NEXT_WORKSPACE, 'drafting');
      files = [];
      messages.length = 0;
      return json(route, { workspace: current });
    }
    if (/\/api\/picture\/workspaces\/[0-9a-f-]{36}$/i.test(path)) return json(route, { workspace: current });
    const access = path.match(/^\/api\/artifacts\/([0-9a-f-]{36})\/access-link$/i);
    if (access) {
      const urlValue = access[1] === BRIEF
        ? `data:application/json;base64,${Buffer.from(JSON.stringify({ objective: 'Gerar matrículas', channel: 'Instagram' })).toString('base64')}`
        : onePixelPng;
      return json(route, { url: urlValue, expires_at: future });
    }
    if (path === '/api/chat/runs' && request.method() === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      expect(payload).toMatchObject({ experience: 'picture', picture_workspace_id: WORKSPACE });
      expect(payload).not.toHaveProperty('image_generation');
      current = workspace(WORKSPACE, 'review', FINAL);
      files = [...generatedFiles];
      return json(route, { run: { id: RUN } }, 201);
    }
    if (path === `/api/chat/runs/${RUN}/events`) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { ...cors, 'cache-control': 'no-cache' },
        body: 'event: delta\ndata: {"delta":"A peça foi gerada e está pronta para revisão."}\n\nevent: done\ndata: {}\n\n',
      });
    }
    if (path === `/api/chat/runs/${RUN}`) return json(route, { run: { id: RUN, status: 'completed', events: [] } });
    return json(route, { error: 'not_found' }, 404);
  });

  await installSession(page);
};

test.describe('Picture-Hermes fake end-to-end', () => {
  test.skip(!enabled, 'Set PICTURE_HERMES_E2E_FAKE=true to run the no-FAL browser gate.');

  test('persists, approves, resets and exposes the validated final', async ({ page }) => {
    await installFakeStack(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Abrir gerador de imagens' }).click();

    await expect(page.getByPlaceholder('Descreva a peça, objetivo, público e formato...')).toBeVisible();
    await expect(page.locator('aside').getByRole('heading', { name: 'Arquivos da peça' })).toBeVisible();
    await page.getByPlaceholder('Descreva a peça, objetivo, público e formato...').fill('Crie um post de graduação para Instagram.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(page.getByText('A peça foi gerada e está pronta para revisão.')).toBeVisible();
    await expect(page.getByRole('button', { name: /peca-final\.png/ })).toBeVisible();

    await page.getByRole('button', { name: /brief\.json/ }).click();
    await expect(page.locator('pre')).toContainText('Gerar matrículas');
    await page.reload();
    await expect(page.getByText('Picture-Hermes · Pronta para revisar')).toBeVisible();
    await expect(page.getByRole('button', { name: /peca-final\.png/ })).toBeVisible();

    await page.getByRole('button', { name: 'Aprovar peça' }).click();
    await expect(page.getByText('Picture-Hermes · Aprovada')).toBeVisible();
    await page.getByRole('button', { name: 'Criar nova peça' }).click();
    const confirmation = page.getByRole('alertdialog', { name: 'Criar uma nova peça?' });
    await expect(confirmation).toContainText('A peça final aprovada continuará disponível em Trabalhos Validados.');
    await confirmation.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByText('Picture-Hermes · Aprovada')).toBeVisible();

    await page.getByRole('button', { name: 'Criar nova peça' }).click();
    await page.getByRole('alertdialog', { name: 'Criar uma nova peça?' }).getByRole('button', { name: 'Confirmar e criar' }).click();
    await expect(page.getByText('Converse com o Hermes e envie suas referências.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nova peça' })).toBeVisible();

    await page.goto('/manager/validated-works');
    await expect(page.getByRole('heading', { name: 'Trabalhos Validados' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Campanha Graduação ENS' })).toBeVisible();
    await expect(page.getByText('1080 × 1350 px')).toBeVisible();
    await page.getByRole('button', { name: 'Abrir preview de Campanha Graduação ENS' }).click();
    await expect(page.getByRole('dialog', { name: 'Campanha Graduação ENS' })).toBeVisible();
  });

  test('opens the workspace files in the mobile drawer @mobile', async ({ page }) => {
    await installFakeStack(page, true);
    await page.goto('/');
    await page.getByRole('button', { name: 'Abrir menu' }).click();
    await page.getByRole('button', { name: 'Abrir gerador de imagens' }).click();
    await expect(page.getByText('Picture-Hermes · Pronta para revisar')).toBeVisible();
    await expect(page.getByText('Workspace temporário e candidata final', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Arquivos' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Arquivos da peça' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: /peca-final\.png/ })).toBeVisible();
  });
});
