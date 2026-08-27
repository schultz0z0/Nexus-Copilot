import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApiRouter } from './http/routes/index.js';
import { createLogger } from './observability/logger.js';
import { createMetrics } from './observability/metrics.js';
import { createApp } from './http/createApp.js';
import { parse } from 'yaml';
import { ArtifactClient } from './integrations/artifactClient.js';
import { RagCourseClient } from './integrations/ragCourseClient.js';
import {
  parseCampaignCreateBody,
  parseCampaignListQuery,
  parseCampaignPatchBody,
  parseCampaignTransitionBody
} from './http/routes/campaigns.js';
import {
  parseProductionItemCreateBody,
  parseProductionBatchBody,
  parseProductionItemPatchBody,
  parseProductionItemScheduleQuery,
  parseProductionItemTransitionBody
} from './http/routes/items.js';
import {
  parseNotificationListQuery,
  parseNotificationReadBody
} from './http/routes/notifications.js';
import { parseDependencyBody } from './http/routes/dependencies.js';
import {
  parseContentAssetBody,
  parseContentVersionBody,
  parseItemArtifactLinkBody,
  parseItemArtifactRemovalBody
} from './http/routes/content.js';

const pool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres' });
afterAll(() => pool.end());

function app(
  features = { read: true, write: true },
  artifactClient?: ArtifactClient
) {
  const router = apiRouter(features, artifactClient);
  return createApp({
    readiness: async () => true,
    logger: createLogger(() => undefined),
    metrics: createMetrics(),
    internalKey: 'test-internal-key',
    router
  });
}

function apiRouter(
  features = { read: true, write: true },
  artifactClient = new ArtifactClient({
    baseUrl: 'http://127.0.0.1:8095',
    internalKey: 'artifact-test-key',
    timeoutMs: 1_000
  })
) {
  return createApiRouter({
    pool,
    corsOrigins: ['http://frontend.local'],
    features,
    artifactClient,
    ragCourseClient: new RagCourseClient({
      endpoint: 'http://127.0.0.1:8000/mcp',
      timeoutMs: 1_000
    }),
    verifyToken: async (token) => {
      const users = {
        'valid-member': {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'member@local.test'
        },
        'valid-manager': {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'manager@local.test'
        }
      } as const;
      const user = users[token as keyof typeof users];
      if (!user) throw Object.assign(new Error('bad token'), { code: 'unauthorized', status: 401 });
      return user;
    }
  });
}

describe('Marketing Ops REST v1', () => {
  it('keeps every public REST operation in the OpenAPI contract', () => {
    const document = parse(readFileSync(new URL('../openapi/marketing-ops.v1.yaml', import.meta.url), 'utf8')) as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths).sort()).toEqual([
      '/audit-events', '/campaigns',
      '/campaign-items', '/campaign-items/batch', '/campaign-items/{itemId}',
      '/campaign-items/{itemId}/artifacts',
      '/campaign-items/{itemId}/artifacts/{artifactLinkId}/access-link',
      '/campaign-items/{itemId}/content-assets',
      '/campaign-items/{itemId}/dependencies',
      '/campaign-items/{itemId}/transition',
      '/campaigns/{campaignId}/items', '/campaigns/{campaignId}/items/{itemId}',
      '/campaigns/{campaignId}/materials', '/campaigns/{campaignId}/materials/link',
      '/campaigns/{campaignId}/materials/upload',
      '/campaigns/{campaignId}/materials/{materialId}',
      '/campaigns/{campaignId}/materials/{materialId}/access-link',
      '/campaigns/{campaignId}/participant-candidates',
      '/campaigns/{campaignId}/participants',
      '/campaigns/{campaignId}/participants/{userId}',
      '/campaigns/{campaignId}/timeline', '/campaigns/{id}',
      '/campaigns/{id}/archive', '/campaigns/{id}/transitions',
      '/capabilities', '/content-assets/{assetId}/versions',
      '/in-app-notifications', '/references/courses'
    ].sort());
  });

  it('parses strict production item, schedule, dependency and content contracts', () => {
    const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const assigneeId = '11111111-1111-4111-8111-111111111111';
    expect(parseProductionItemCreateBody({
      campaignId,
      kind: 'email',
      title: 'E-mail de abertura',
      assigneeUserId: assigneeId,
      priority: 'high',
      channel: 'email',
      description: 'Preparar conteúdo',
      startsAt: '2026-08-01T12:00:00.000Z',
      dueAt: '2026-08-01T15:00:00.000Z',
      metadata: { audience: 'alumni' }
    })).toMatchObject({ campaignId, kind: 'email', priority: 'high' });
    expect(parseProductionItemPatchBody({ priority: 'urgent' })).toEqual({
      priority: 'urgent'
    });
    expect(parseProductionItemTransitionBody({ to: 'ready' })).toEqual({
      to: 'ready'
    });
    expect(parseProductionBatchBody({
      items: [{ itemId: campaignId, version: 1 }],
      action: { type: 'priority', priority: 'urgent' }
    })).toMatchObject({ action: { type: 'priority' } });
    expect(parseNotificationListQuery({ unreadOnly: 'true', limit: '50' }))
      .toEqual({ unreadOnly: true, limit: 50 });
    expect(parseNotificationReadBody({ ids: [campaignId] }))
      .toEqual({ ids: [campaignId] });
    expect(parseProductionItemScheduleQuery({
      view: 'month',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      campaignId,
      kind: 'email',
      assigneeId,
      priority: 'high',
      limit: '50'
    })).toMatchObject({ view: 'month', campaignId, kind: 'email', limit: 50 });
    expect(() => parseProductionItemScheduleQuery({ view: 'tenant-private' })).toThrow();
    expect(parseDependencyBody({ dependsOnItemId: campaignId })).toEqual({
      dependsOnItemId: campaignId
    });
    expect(parseContentAssetBody({ assetKind: 'email_body', title: 'Corpo' }))
      .toEqual({ assetKind: 'email_body', title: 'Corpo' });
    expect(parseContentVersionBody({
      body: 'Conteúdo',
      metadata: { locale: 'pt-BR' },
      freeze: true
    })).toMatchObject({ freeze: true });
    expect(parseItemArtifactLinkBody({ artifactId: campaignId })).toEqual({
      artifactId: campaignId
    });
    expect(parseItemArtifactRemovalBody({ artifactLinkId: campaignId })).toEqual({
      artifactLinkId: campaignId
    });

    expect(() => parseProductionItemScheduleQuery({ unknown: 'field' })).toThrow();
    expect(() => parseProductionItemCreateBody({
      campaignId,
      kind: 'email',
      title: 'Mass assignment',
      status: 'completed'
    })).toThrow();
    expect(() => parseProductionItemTransitionBody({ to: 'approved' })).toThrow();
    expect(() => parseProductionBatchBody({
      items: [{ itemId: campaignId, version: 1 }],
      action: { type: 'reschedule' }
    })).toThrow();
    expect(() => parseNotificationListQuery({ unreadOnly: 'yes' })).toThrow();
    expect(() => parseDependencyBody({
      dependsOnItemId: campaignId,
      itemVersion: 99
    })).toThrow();
    expect(() => parseContentVersionBody({
      body: 'Conteúdo',
      metadata: {},
      freeze: false,
      versionNumber: 42
    })).toThrow();
  });

  it('parses the complete strict campaign REST contract', () => {
    expect(parseCampaignListQuery({
      q: 'campanha ens',
      status: 'active',
      referenceType: 'course',
      referenceKey: 'mba-gestao',
      channel: 'email',
      responsible: '11111111-1111-4111-8111-111111111111',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      limit: '50'
    })).toMatchObject({
      q: 'campanha ens',
      status: 'active',
      referenceType: 'course',
      referenceKey: 'mba-gestao',
      channel: 'email',
      responsibleId: '11111111-1111-4111-8111-111111111111',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      limit: 50
    });
    expect(() => parseCampaignListQuery({ unknown: 'field' })).toThrow();
    expect(() => parseCampaignListQuery({ limit: '101' })).toThrow();

    expect(parseCampaignCreateBody({
      name: 'Campanha completa',
      objective: 'Objetivo',
      referenceType: 'product',
      referenceTitleSnapshot: 'Produto ENS',
      startsOn: '2026-08-01',
      endsOn: '2026-08-31',
      primaryChannel: 'linkedin',
      secondaryChannels: ['email'],
      briefing: 'Briefing',
      notes: null
    })).toMatchObject({ name: 'Campanha completa', primaryChannel: 'linkedin' });
    expect(parseCampaignPatchBody({ briefing: 'Novo briefing' })).toEqual({ briefing: 'Novo briefing' });
    expect(parseCampaignTransitionBody({ to: 'planned' })).toEqual({ to: 'planned' });
    expect(() => parseCampaignCreateBody({ name: 'Mass assignment', status: 'active' })).toThrow();
    expect(() => parseCampaignPatchBody({})).toThrow();
    expect(() => parseCampaignTransitionBody({ to: 'unknown' })).toThrow();
    expect(() => parseCampaignTransitionBody({ to: 'archived' })).toThrow();
  });

  it('documents required mutation headers, ETags and stable public errors', () => {
    const document = parse(readFileSync(new URL('../openapi/marketing-ops.v1.yaml', import.meta.url), 'utf8')) as {
      paths: Record<string, Record<string, { parameters?: Array<{ $ref?: string }>; responses?: Record<string, { headers?: Record<string, unknown> }> }>>;
      components: { schemas: Record<string, unknown> };
    };
    const mutations = [
      ['/campaigns', 'post', false],
      ['/campaigns/{id}', 'patch', true],
      ['/campaigns/{id}/transitions', 'post', true],
      ['/campaigns/{id}/archive', 'post', true],
      ['/campaigns/{campaignId}/items', 'post', false],
      ['/campaigns/{campaignId}/items/{itemId}', 'patch', true],
      ['/campaigns/{campaignId}/participants', 'post', true],
      ['/campaigns/{campaignId}/participants/{userId}', 'patch', true],
      ['/campaigns/{campaignId}/participants/{userId}', 'delete', true],
      ['/campaigns/{campaignId}/materials/upload', 'post', true],
      ['/campaigns/{campaignId}/materials/link', 'post', true],
      ['/campaigns/{campaignId}/materials/{materialId}', 'delete', true]
      ,['/campaign-items', 'post', false]
      ,['/campaign-items/{itemId}', 'patch', true]
      ,['/campaign-items/{itemId}/transition', 'post', true]
      ,['/campaign-items/{itemId}/dependencies', 'post', true]
      ,['/campaign-items/{itemId}/dependencies', 'delete', true]
      ,['/campaign-items/{itemId}/content-assets', 'post', true]
      ,['/content-assets/{assetId}/versions', 'post', true]
      ,['/campaign-items/{itemId}/artifacts', 'post', true]
      ,['/campaign-items/{itemId}/artifacts', 'delete', true]
      ,['/campaign-items/batch', 'post', false, false]
      ,['/in-app-notifications', 'patch', false, false]
    ] as const;
    for (const [path, method, requiresVersion, returnsVersion = true] of mutations) {
      const operation = document.paths[path]?.[method];
      const refs = operation?.parameters?.map((parameter) => parameter.$ref) ?? [];
      expect(refs).toContain('#/components/parameters/IdempotencyKey');
      if (requiresVersion) expect(refs).toContain('#/components/parameters/IfMatch');
      const success = operation?.responses?.['200'] ?? operation?.responses?.['201'];
      if (returnsVersion) expect(success?.headers).toHaveProperty('ETag');
    }
    expect(Object.keys(document.components.schemas)).toEqual(expect.arrayContaining([
      'ErrorEnvelope', 'CampaignCreate', 'CampaignPatch', 'CampaignTransition',
      'ParticipantCreate', 'ParticipantPatch', 'MaterialLink', 'TimelinePage'
    ]));
    expect(document.components.schemas).toHaveProperty('PublicErrorCode');
  });

  it('keeps the Express router and OpenAPI operations in lockstep', () => {
    const document = parse(readFileSync(new URL('../openapi/marketing-ops.v1.yaml', import.meta.url), 'utf8')) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const documented = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.keys(operations)
        .filter((method) => ['get', 'post', 'patch', 'delete'].includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`)
    ).sort();
    const stack = (apiRouter() as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    }).stack;
    const implemented = stack.flatMap((layer) => {
      if (!layer.route) return [];
      const path = layer.route.path
        .replace(/^\/v1/, '')
        .replace(/:([^/]+)/g, '{$1}');
      return Object.entries(layer.route.methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => `${method.toUpperCase()} ${path}`);
    }).sort();
    expect(documented).toEqual(implemented);
  });

  it('publishes capabilities and default-off flags', async () => {
    const response = await request(app({ read: false, write: false })).get('/v1/capabilities');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ contractVersion: 1, features: { read: false, write: false } });
  });

  it('requires authentication and an idempotency key', async () => {
    expect((await request(app()).post('/v1/campaigns').send({ name: 'No auth' })).status).toBe(401);
    const missingKey = await request(app()).post('/v1/campaigns').set('Authorization', 'Bearer valid-member').send({ name: 'No key' });
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe('idempotency_key_required');
  });

  it('creates, lists and returns ETag for the same domain record', async () => {
    const created = await request(app()).post('/v1/campaigns')
      .set('Authorization', 'Bearer valid-member')
      .set('X-Tenant-Id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'REST campaign' });
    expect(created.status).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    const listed = await request(app()).get('/v1/campaigns?limit=10&status=draft')
      .set('Authorization', 'Bearer valid-member')
      .set('X-Tenant-Id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((campaign: { id: string }) => campaign.id === created.body.data.id)).toBe(true);
  });

  it('creates a complete draft and transitions it with aggregate ETags', async () => {
    const headers = {
      Authorization: 'Bearer valid-member',
      'X-Tenant-Id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    };
    const created = await request(app()).post('/v1/campaigns')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({
        name: 'Complete REST campaign',
        objective: 'Validate the operational REST contract',
        referenceType: 'product',
        referenceTitleSnapshot: 'Nexus AI',
        startsOn: '2026-08-01',
        endsOn: '2026-08-31',
        primaryChannel: 'linkedin',
        secondaryChannels: ['email'],
        briefing: 'Internal briefing',
        notes: null
      });
    expect(created.status).toBe(201);
    const createdEtag = String(created.headers.etag);
    expect(createdEtag).toBe('"1"');
    expect(created.body.data).toMatchObject({
      status: 'draft',
      objective: 'Validate the operational REST contract',
      primaryChannel: 'linkedin'
    });

    const transitioned = await request(app())
      .post(`/v1/campaigns/${created.body.data.id}/transitions`)
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .set('If-Match', createdEtag)
      .send({ to: 'planned' });
    expect(transitioned.status).toBe(200);
    expect(transitioned.headers.etag).toBe('"2"');
    expect(transitioned.body.data.status).toBe('planned');
  });

  it('creates, queries, edits and transitions a production item through canonical REST', async () => {
    const headers = {
      Authorization: 'Bearer valid-member',
      'X-Tenant-Id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    };
    const campaign = await request(app()).post('/v1/campaigns')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ name: `Production REST ${randomUUID()}` });
    expect(campaign.status).toBe(201);

    const created = await request(app()).post('/v1/campaign-items')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({
        campaignId: campaign.body.data.id,
        kind: 'task',
        title: 'Preparar briefing',
        assigneeUserId: '11111111-1111-4111-8111-111111111111',
        dueAt: '2099-08-01T15:00:00.000Z'
      });
    expect(created.status).toBe(201);
    expect(created.headers.etag).toBe('"1"');

    const detail = await request(app())
      .get(`/v1/campaign-items/${created.body.data.id}`)
      .set(headers);
    expect(detail.status).toBe(200);
    expect(detail.headers.etag).toBe('"1"');

    const schedule = await request(app())
      .get(`/v1/campaign-items?campaignId=${campaign.body.data.id}&limit=10`)
      .set(headers);
    expect(schedule.status).toBe(200);
    expect(schedule.body).toMatchObject({
      meta: { timeZone: 'America/Sao_Paulo' }
    });
    expect(schedule.body.data.some((item: { id: string }) =>
      item.id === created.body.data.id
    )).toBe(true);

    const patched = await request(app())
      .patch(`/v1/campaign-items/${created.body.data.id}`)
      .set(headers)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', randomUUID())
      .send({ priority: 'high' });
    expect(patched.status).toBe(200);
    expect(patched.headers.etag).toBe('"2"');

    const transitioned = await request(app())
      .post(`/v1/campaign-items/${created.body.data.id}/transition`)
      .set(headers)
      .set('If-Match', '"2"')
      .set('Idempotency-Key', randomUUID())
      .send({ to: 'ready' });
    expect(transitioned.status).toBe(200);
    expect(transitioned.headers.etag).toBe('"3"');
    expect(transitioned.body.data.status).toBe('ready');
  });

  it('executes a manager batch and reads owned in-app notifications through REST', async () => {
    const headers = {
      Authorization: 'Bearer valid-manager',
      'X-Tenant-Id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    };
    const campaign = await request(app()).post('/v1/campaigns')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ name: `Batch REST ${randomUUID()}` });
    const item = await request(app()).post('/v1/campaign-items')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({
        campaignId: campaign.body.data.id,
        kind: 'task',
        title: 'Item em lote',
        assigneeUserId: '22222222-2222-4222-8222-222222222222'
      });

    const batch = await request(app()).post('/v1/campaign-items/batch')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({
        items: [{ itemId: item.body.data.id, version: 1 }],
        action: { type: 'priority', priority: 'urgent' }
      });
    expect(batch.status).toBe(200);
    expect(batch.body.data).toMatchObject({ succeeded: 1, failed: 0 });
    expect(batch.body.data.results[0].item).toMatchObject({
      id: item.body.data.id,
      priority: 'urgent',
      version: 2
    });

    const notifications = await request(app())
      .get('/v1/in-app-notifications?unreadOnly=true&limit=100')
      .set(headers);
    expect(notifications.status).toBe(200);
    const owned = notifications.body.data.filter((notification: { itemId: string }) =>
      notification.itemId === item.body.data.id
    );
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({
      notificationType: 'assignment',
      readAt: null
    });

    const marked = await request(app()).patch('/v1/in-app-notifications')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ ids: [owned[0].id] });
    expect(marked.status).toBe(200);
    expect(marked.body.data[0].readAt).toEqual(expect.any(String));

    const forbidden = await request(app()).post('/v1/campaign-items/batch')
      .set({
        Authorization: 'Bearer valid-member',
        'X-Tenant-Id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      })
      .set('Idempotency-Key', randomUUID())
      .send({
        items: [{ itemId: item.body.data.id, version: 2 }],
        action: { type: 'priority', priority: 'low' }
      });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('forbidden');
  });

  it('exposes dependency, immutable content and artifact resources through REST', async () => {
    const headers = {
      Authorization: 'Bearer valid-member',
      'X-Tenant-Id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    };
    const artifactId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const artifactClient = new ArtifactClient({
      baseUrl: 'http://artifact.test',
      internalKey: 'artifact-test-key',
      timeoutMs: 1_000,
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/access-link') && init?.method === 'POST') {
          return new Response(JSON.stringify({
            url: 'https://artifact.test/signed',
            expires_at: '2099-08-01T15:05:00.000Z'
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          id: artifactId,
          owner_id: '11111111-1111-4111-8111-111111111111',
          filename: 'peca.txt',
          content_type: 'text/plain',
          size: 5,
          sha256: 'a'.repeat(64),
          created_at: '2099-08-01T15:00:00.000Z',
          source: 'marketing_ops'
        }), { status: 200 });
      }
    });
    const testApp = app({ read: true, write: true }, artifactClient);
    const campaign = await request(testApp).post('/v1/campaigns')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ name: `Nested REST ${randomUUID()}` });
    const dependent = await request(testApp).post('/v1/campaign-items')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ campaignId: campaign.body.data.id, kind: 'email', title: 'Dependente' });
    const predecessor = await request(testApp).post('/v1/campaign-items')
      .set(headers)
      .set('Idempotency-Key', randomUUID())
      .send({ campaignId: campaign.body.data.id, kind: 'task', title: 'Predecessor' });
    expect(dependent.status).toBe(201);
    expect(predecessor.status).toBe(201);

    const added = await request(testApp)
      .post(`/v1/campaign-items/${dependent.body.data.id}/dependencies`)
      .set(headers)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', randomUUID())
      .send({ dependsOnItemId: predecessor.body.data.id });
    expect(added.status).toBe(201);
    expect(added.headers.etag).toBe('"2"');
    const dependencies = await request(testApp)
      .get(`/v1/campaign-items/${dependent.body.data.id}/dependencies`)
      .set(headers);
    expect(dependencies.body.data).toHaveLength(1);
    expect(dependencies.body.data[0]).toMatchObject({ isBlocking: true });

    const removed = await request(testApp)
      .delete(`/v1/campaign-items/${dependent.body.data.id}/dependencies`)
      .set(headers)
      .set('If-Match', '"2"')
      .set('Idempotency-Key', randomUUID())
      .send({ dependsOnItemId: predecessor.body.data.id });
    expect(removed.status).toBe(200);
    expect(removed.headers.etag).toBe('"3"');

    const asset = await request(testApp)
      .post(`/v1/campaign-items/${dependent.body.data.id}/content-assets`)
      .set(headers)
      .set('If-Match', '"3"')
      .set('Idempotency-Key', randomUUID())
      .send({ assetKind: 'email_body', title: 'Corpo do e-mail' });
    expect(asset.status).toBe(201);
    expect(asset.headers.etag).toBe('"4"');
    expect(asset.body.data).toMatchObject({ version: 1, itemVersion: 4 });

    const version = await request(testApp)
      .post(`/v1/content-assets/${asset.body.data.id}/versions`)
      .set(headers)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Olá', metadata: { locale: 'pt-BR' }, freeze: true });
    expect(version.status).toBe(201);
    expect(version.headers.etag).toBe('"2"');
    expect(version.body.data).toMatchObject({
      versionNumber: 1,
      assetVersion: 2
    });
    const mediumVersion = await request(testApp)
      .post(`/v1/content-assets/${asset.body.data.id}/versions`)
      .set(headers)
      .set('If-Match', '"2"')
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'x'.repeat(300 * 1024), metadata: {}, freeze: false });
    expect(mediumVersion.status).toBe(201);
    expect(mediumVersion.headers.etag).toBe('"3"');
    const oversizedVersion = await request(testApp)
      .post(`/v1/content-assets/${asset.body.data.id}/versions`)
      .set(headers)
      .set('If-Match', '"3"')
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'x'.repeat(1150 * 1024), metadata: {}, freeze: false });
    expect(oversizedVersion.status).toBe(413);
    expect(oversizedVersion.body.error.code).toBe('payload_too_large');
    const staleVersion = await request(testApp)
      .post(`/v1/content-assets/${asset.body.data.id}/versions`)
      .set(headers)
      .set('If-Match', '"1"')
      .set('Idempotency-Key', randomUUID())
      .send({ body: 'Stale', metadata: {}, freeze: false });
    expect(staleVersion.status).toBe(409);
    expect(staleVersion.body.error).toMatchObject({
      code: 'version_conflict',
      details: { currentVersion: 3 }
    });

    const linked = await request(testApp)
      .post(`/v1/campaign-items/${dependent.body.data.id}/artifacts`)
      .set(headers)
      .set('If-Match', '"4"')
      .set('Idempotency-Key', randomUUID())
      .send({ artifactId, assetId: asset.body.data.id });
    expect(linked.status).toBe(201);
    expect(linked.headers.etag).toBe('"5"');
    const access = await request(testApp)
      .post(
        `/v1/campaign-items/${dependent.body.data.id}/artifacts/` +
        `${linked.body.data.artifact.id}/access-link`
      )
      .set(headers);
    expect(access.status).toBe(200);
    expect(access.body.data.url).toBe('https://artifact.test/signed');

    const unlinked = await request(testApp)
      .delete(`/v1/campaign-items/${dependent.body.data.id}/artifacts`)
      .set(headers)
      .set('If-Match', '"5"')
      .set('Idempotency-Key', randomUUID())
      .send({ artifactLinkId: linked.body.data.artifact.id });
    expect(unlinked.status).toBe(200);
    expect(unlinked.headers.etag).toBe('"6"');
  });

  it('filters by course, status, owner and period with cursor pagination', async () => {
    const headers = {
      Authorization: 'Bearer valid-member',
      'X-Tenant-Id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    };
    const first = await request(app()).post('/v1/campaigns').set(headers)
      .set('Idempotency-Key', randomUUID()).send({ name: 'Course campaign one', courseSlug: 'course-one' });
    const second = await request(app()).post('/v1/campaigns').set(headers)
      .set('Idempotency-Key', randomUUID()).send({ name: 'Course campaign two', courseSlug: 'course-one' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const query = new URLSearchParams({
      course: 'course-one', status: 'draft', owner: '11111111-1111-4111-8111-111111111111',
      from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z', limit: '1'
    });
    const pageOne = await request(app()).get(`/v1/campaigns?${query}`).set(headers);
    expect(pageOne.status).toBe(200);
    expect(pageOne.body.data).toHaveLength(1);
    expect(pageOne.body.data[0]).toMatchObject({
      courseSlug: 'course-one',
      createdBy: '11111111-1111-4111-8111-111111111111'
    });
    expect(pageOne.body.page.nextCursor).toEqual(expect.any(String));

    query.set('cursor', pageOne.body.page.nextCursor);
    const pageTwo = await request(app()).get(`/v1/campaigns?${query}`).set(headers);
    expect(pageTwo.status).toBe(200);
    expect(pageTwo.body.data).toHaveLength(1);
    expect(pageTwo.body.data[0].id).not.toBe(pageOne.body.data[0].id);
  });

  it('maps stale If-Match to a version conflict', async () => {
    const created = await request(app()).post('/v1/campaigns')
      .set('Authorization', 'Bearer valid-member').set('Idempotency-Key', randomUUID())
      .set('X-Tenant-Id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').send({ name: 'ETag campaign' });
    const updated = await request(app()).patch(`/v1/campaigns/${created.body.data.id}`)
      .set('Authorization', 'Bearer valid-member').set('Idempotency-Key', randomUUID()).set('If-Match', '"1"')
      .set('X-Tenant-Id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').send({ name: 'Version two' });
    expect(updated.status).toBe(200);
    const stale = await request(app()).patch(`/v1/campaigns/${created.body.data.id}`)
      .set('Authorization', 'Bearer valid-member').set('Idempotency-Key', randomUUID()).set('If-Match', '"1"')
      .set('X-Tenant-Id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').send({ name: 'Stale' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
  });

  it('rejects untrusted origins and disabled writes', async () => {
    const forbiddenOrigin = await request(app()).get('/v1/capabilities').set('Origin', 'https://evil.local');
    expect(forbiddenOrigin.status).toBe(403);
    const disabled = await request(app({ read: true, write: false })).post('/v1/campaigns')
      .set('Authorization', 'Bearer valid-member').set('Idempotency-Key', randomUUID()).send({ name: 'Disabled' });
    expect(disabled.status).toBe(503);
    expect(disabled.body.error.code).toBe('feature_disabled');
  });

  it('answers trusted CORS preflight without authentication', async () => {
    const response = await request(app()).options('/v1/campaigns')
      .set('Origin', 'http://frontend.local')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key,x-tenant-id');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
  });
});
