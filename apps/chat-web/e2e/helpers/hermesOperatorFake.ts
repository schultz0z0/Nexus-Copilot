import { expect, type Page, type Route } from '@playwright/test';
import {
  CAMPAIGN,
  ITEM,
  RUN_EXECUTE,
  RUN_PLAN,
  RUN_UNAVAILABLE,
  SESSION,
  USER,
  asset,
  campaign,
  item,
  now,
  planMessage,
  successMessage,
  unavailableMessage,
} from './hermesOperatorFixtures';

export const enabled = process.env.MARKETING_OPS_HERMES_E2E_FAKE === 'true';
export const APPROVAL_REQUEST = 'abababab-abab-4bab-8bab-abababababab';

const cors = {
  'access-control-allow-origin': 'http://127.0.0.1:8088',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-tenant-id,x-user-id',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: { ...cors, ...headers },
  body: JSON.stringify(body),
});

async function installSession(page: Page) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: USER,
    exp: Math.floor(Date.now() / 1000) + 86_400,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { tenant_id: 'ens' },
    user_metadata: { tenant_id: 'ens', full_name: 'Gestora E2E' },
  })}.marketing-ops-e2e`;

  await page.addInitScript(({ userId, token }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: token,
      refresh_token: 'marketing-ops-e2e-refresh',
      expires_in: 86_400,
      expires_at: Math.floor(Date.now() / 1000) + 86_400,
      token_type: 'bearer',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'gestora-operator@example.test',
        app_metadata: { tenant_id: 'ens' },
        user_metadata: { tenant_id: 'ens', full_name: 'Gestora E2E' },
        created_at: '2026-01-01T00:00:00.000Z',
      },
    }));
  }, { userId: USER, token: accessToken });
}

async function installSupabaseFakes(page: Page) {
  const sessions: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];

  await page.route('http://127.0.0.1:55321/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());

    if (url.pathname.includes('/profiles')) {
      return json(route, {
        id: USER,
        role: 'manager',
        full_name: 'Gestora E2E',
        email: 'gestora-operator@example.test',
      });
    }

    if (url.pathname.includes('/chat_sessions')) {
      if (request.method() === 'GET') return json(route, sessions);
      const payload = request.postDataJSON() as Record<string, unknown>;
      const session = {
        id: SESSION,
        title: typeof payload.title === 'string' ? payload.title : 'Nova conversa',
        session_kind: 'normal',
        created_at: now,
        updated_at: now,
      };
      sessions.splice(0, sessions.length, session);
      return json(route, session, 201);
    }

    if (url.pathname.includes('/chat_messages')) {
      if (request.method() === 'GET') return json(route, messages);
      const payload = request.postDataJSON() as Record<string, unknown> | Array<Record<string, unknown>>;
      const posted = Array.isArray(payload) ? payload[0] ?? {} : payload;
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...posted };
      messages.push(row);
      return json(route, row, 201);
    }

    return json(route, []);
  });
}

async function installBridgeFakes(page: Page) {
  await page.route('http://127.0.0.1:18081/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/chat/runs' && request.method() === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      expect(payload).toMatchObject({ session_id: SESSION });
      expect(payload).not.toHaveProperty('experience');
      expect(payload).not.toHaveProperty('picture_workspace_id');

      const messageText = String(payload.message_text ?? '').trim().toLowerCase();
      const runId = messageText === 'aprovado'
        ? RUN_EXECUTE
        : messageText.includes('indisponivel')
          ? RUN_UNAVAILABLE
          : RUN_PLAN;
      return json(route, { run: { id: runId } }, 201);
    }

    if (path === `/api/chat/runs/${RUN_PLAN}/events`) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { ...cors, 'cache-control': 'no-cache' },
        body: [
          'event: status',
          'data: {"text":"Hermes está montando a proposta...","tone":"info"}',
          '',
          `event: delta\ndata: ${JSON.stringify({ delta: planMessage })}`,
          '',
          'event: done',
          'data: {}',
          '',
        ].join('\n'),
      });
    }

    if (path === `/api/chat/runs/${RUN_EXECUTE}/events`) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { ...cors, 'cache-control': 'no-cache' },
        body: [
          'event: status',
          'data: {"text":"Hermes está executando o plano confirmado...","tone":"info"}',
          '',
          `event: delta\ndata: ${JSON.stringify({ delta: successMessage })}`,
          '',
          'event: done',
          'data: {}',
          '',
        ].join('\n'),
      });
    }

    if (path === `/api/chat/runs/${RUN_UNAVAILABLE}/events`) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { ...cors, 'cache-control': 'no-cache' },
        body: [
          'event: status',
          'data: {"text":"Hermes está consultando o Marketing Ops...","tone":"info"}',
          '',
          `event: delta\ndata: ${JSON.stringify({ delta: unavailableMessage })}`,
          '',
          'event: done',
          'data: {}',
          '',
        ].join('\n'),
      });
    }

    if (/^\/api\/chat\/runs\/[0-9a-f-]{36}$/i.test(path)) {
      return json(route, { run: { id: path.split('/').pop(), status: 'completed', events: [] } });
    }

    return json(route, { error: 'not_found' }, 404);
  });
}

async function installMarketingOpsFakes(page: Page) {
  let approval = {
    id: APPROVAL_REQUEST,
    campaignId: CAMPAIGN,
    kind: 'operational',
    status: 'pending',
    requestedBy: 'abababab-abab-4bab-8bab-abababababab',
    reason: 'Autorizar envio de homologação',
    riskLevel: 'critical',
    contentAssetId: null,
    contentVersionNumber: null,
    actionPackageId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    targetHash: 'a'.repeat(64),
    supersedesRequestId: null,
    expiresAt: '2026-08-10T13:00:00.000Z',
    version: 1,
    createdAt: '2026-08-05T13:00:00.000Z',
    updatedAt: '2026-08-05T13:00:00.000Z',
    decision: null,
    editorialTarget: null,
    actionPackage: {
      id: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd', campaignId: CAMPAIGN,
      actionType: 'campaign.channel_dispatch', channel: 'email', audienceSnapshot: { count: 10 },
      scheduledFor: null, timeZone: 'America/Sao_Paulo', configuration: { mode: 'sandbox' },
      successCriteria: null, riskSummary: 'homologation only', payload: { template: 'test' },
      payloadHash: 'a'.repeat(64), status: 'pending_approval', authorizedByRequestId: null,
      authorizedAt: null, expiresAt: '2026-08-10T13:00:00.000Z', invalidatedAt: null,
      invalidationReason: null, version: 1, createdBy: USER,
      createdAt: '2026-08-05T13:00:00.000Z', updatedAt: '2026-08-05T13:00:00.000Z'
    },
    capabilities: { decide: true, cancel: false }
  };
  await page.route('http://127.0.0.1:19091/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    const path = url.pathname;

    const ok = (data: unknown, pageMeta?: { limit: number; count: number; nextCursor?: string | null }) =>
      json(route, {
        data,
        ...(pageMeta ? { page: pageMeta } : {}),
        meta: { timeZone: 'America/Sao_Paulo' },
      }, 200, { 'x-correlation-id': 'corr-hermes-operator-e2e' });

    if (path === '/v1/campaigns') {
      return ok([campaign], { limit: 100, count: 1, nextCursor: null });
    }

    if (path === '/v1/campaign-items') {
      return ok([item], { limit: 25, count: 1, nextCursor: null });
    }

    if (path === `/v1/campaign-items/${ITEM}`) {
      return ok(item);
    }

    if (path === `/v1/campaign-items/${ITEM}/content-assets`) {
      return ok([asset], { limit: 25, count: 1, nextCursor: null });
    }

    if (path === `/v1/campaigns/${CAMPAIGN}/participants`) {
      return ok([], { limit: 25, count: 0, nextCursor: null });
    }

    if (path === '/v1/in-app-notifications') {
      return ok([], { limit: 25, count: 0, nextCursor: null });
    }

    if (path === '/v1/approval-requests' && request.method() === 'GET') {
      return ok([approval], { limit: 25, count: 1, nextCursor: null });
    }

    if (path === `/v1/approval-requests/${APPROVAL_REQUEST}` && request.method() === 'GET') {
      return ok(approval);
    }

    if (path === `/v1/approval-requests/${APPROVAL_REQUEST}/decisions` && request.method() === 'POST') {
      const body = request.postDataJSON() as { decision: string; comment?: string };
      approval = { ...approval, status: body.decision as typeof approval.status, version: 2,
        capabilities: { decide: false, cancel: false },
        decision: { id: 'efefefef-efef-4fef-8fef-efefefefefef', requestId: APPROVAL_REQUEST,
          decision: body.decision, decidedBy: USER, deciderRole: 'manager', origin: 'human', comment: body.comment ?? null,
          eligibilitySnapshot: { separationOfDuties: true }, correlationId: 'edededed-eded-4ded-8ded-edededededed',
          createdAt: '2026-08-05T14:00:00.000Z' } };
      return ok(approval);
    }

    return json(route, { error: { code: 'not_found', message: 'not found' } }, 404, {
      'x-correlation-id': 'corr-hermes-operator-e2e',
    });
  });
}

export async function installHermesOperatorFakeStack(page: Page) {
  await installSupabaseFakes(page);
  await installBridgeFakes(page);
  await installMarketingOpsFakes(page);
  await installSession(page);
}
