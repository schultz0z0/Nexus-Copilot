import type { Request, Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  createContentAsset,
  createContentVersion,
  listContentAssets,
  listContentVersions
} from '../../domain/content.js';
import {
  attachUploadedItemArtifact,
  createItemArtifactAccessLink,
  linkExistingItemArtifact,
  listItemArtifacts,
  unlinkItemArtifact
} from '../../domain/itemArtifacts.js';
import type { ArtifactClient } from '../../integrations/artifactClient.js';
import {
  actorFrom,
  asyncRoute,
  parseIfMatch,
  requireFeature,
  requireIdempotencyKey
} from '../middleware.js';
import { readBinaryBody } from './materials.js';

const uuid = z.string().uuid();
const itemParamsSchema = z.object({ itemId: uuid }).strict();
const assetParamsSchema = z.object({ assetId: uuid }).strict();
const artifactAccessParamsSchema = z.object({
  itemId: uuid,
  artifactLinkId: uuid
}).strict();

const contentAssetBodySchema = z.object({
  assetKind: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
  title: z.string().trim().min(1).max(200)
}).strict();
const contentVersionBodySchema = z.object({
  body: z.string().max(1_048_576).nullable(),
  metadata: z.record(z.unknown()),
  freeze: z.boolean()
}).strict();
const itemArtifactLinkBodySchema = z.object({
  artifactId: uuid,
  assetId: uuid.optional()
}).strict();
const itemArtifactRemovalBodySchema = z.object({
  artifactLinkId: uuid
}).strict();
const optionalAssetIdSchema = uuid.optional();

export const parseContentAssetBody = (value: unknown) =>
  contentAssetBodySchema.parse(value);
export const parseContentVersionBody = (value: unknown) =>
  contentVersionBodySchema.parse(value);
export const parseItemArtifactLinkBody = (value: unknown) =>
  itemArtifactLinkBodySchema.parse(value);
export const parseItemArtifactRemovalBody = (value: unknown) =>
  itemArtifactRemovalBodySchema.parse(value);

function itemArtifactContext(
  request: Request,
  pool: Pool,
  artifacts: ArtifactClient
) {
  return {
    pool,
    artifacts,
    actor: actorFrom(request),
    correlationId: request.correlationId,
    origin: 'rest' as const
  };
}

export function registerContent(
  router: Router,
  pool: Pool,
  artifacts: ArtifactClient,
  features: { read: boolean; write: boolean }
): void {
  router.get('/v1/campaign-items/:itemId/content-assets', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { itemId } = itemParamsSchema.parse(request.params);
    const data = await listContentAssets(
      {
        pool,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      itemId
    );
    response.json({ data });
  }));

  router.post('/v1/campaign-items/:itemId/content-assets', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { itemId } = itemParamsSchema.parse(request.params);
    const body = parseContentAssetBody(request.body);
    const data = await createContentAsset(
      {
        pool,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      itemId,
      parseIfMatch(request),
      { ...body, idempotencyKey: requireIdempotencyKey(request) }
    );
    response.status(201).setHeader('ETag', `"${data.itemVersion}"`).json({ data });
  }));

  router.get('/v1/content-assets/:assetId/versions', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { assetId } = assetParamsSchema.parse(request.params);
    const data = await listContentVersions(
      {
        pool,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      assetId
    );
    response.json({ data });
  }));

  router.post('/v1/content-assets/:assetId/versions', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { assetId } = assetParamsSchema.parse(request.params);
    const body = parseContentVersionBody(request.body);
    const data = await createContentVersion(
      {
        pool,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      assetId,
      parseIfMatch(request),
      { ...body, idempotencyKey: requireIdempotencyKey(request) }
    );
    response.locals.contentVersionCreated = true;
    response.status(201).setHeader('ETag', `"${data.assetVersion}"`).json({ data });
  }));

  router.get('/v1/campaign-items/:itemId/artifacts', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { itemId } = itemParamsSchema.parse(request.params);
    const data = await listItemArtifacts(
      itemArtifactContext(request, pool, artifacts),
      itemId
    );
    response.json({ data });
  }));

  router.post('/v1/campaign-items/:itemId/artifacts', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { itemId } = itemParamsSchema.parse(request.params);
    const expectedVersion = parseIfMatch(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const context = itemArtifactContext(request, pool, artifacts);
    const data = request.is('application/json')
      ? await linkExistingItemArtifact(
        context,
        itemId,
        expectedVersion,
        (() => {
          const parsed = parseItemArtifactLinkBody(request.body);
          return {
            artifactId: parsed.artifactId,
            ...(parsed.assetId === undefined ? {} : { assetId: parsed.assetId })
          };
        })(),
        idempotencyKey
      )
      : await attachUploadedItemArtifact(
        context,
        itemId,
        expectedVersion,
        {
          filename: request.header('x-nexus-filename') ?? '',
          contentType: request.header('content-type') ?? '',
          bytes: await readBinaryBody(request),
          ...(optionalAssetIdSchema.parse(
            request.header('x-nexus-asset-id')?.trim() || undefined
          )
            ? { assetId: request.header('x-nexus-asset-id')!.trim() }
            : {})
        },
        idempotencyKey
      );
    response.status(201).setHeader('ETag', `"${data.itemVersion}"`).json({ data });
  }));

  router.delete('/v1/campaign-items/:itemId/artifacts', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { itemId } = itemParamsSchema.parse(request.params);
    const { artifactLinkId } = parseItemArtifactRemovalBody(request.body);
    const data = await unlinkItemArtifact(
      itemArtifactContext(request, pool, artifacts),
      itemId,
      artifactLinkId,
      parseIfMatch(request),
      requireIdempotencyKey(request)
    );
    response.setHeader('ETag', `"${data.itemVersion}"`).json({ data });
  }));

  router.post(
    '/v1/campaign-items/:itemId/artifacts/:artifactLinkId/access-link',
    asyncRoute(async (request, response) => {
      requireFeature(features.read, 'read');
      const { itemId, artifactLinkId } = artifactAccessParamsSchema.parse(request.params);
      const data = await createItemArtifactAccessLink(
        itemArtifactContext(request, pool, artifacts),
        itemId,
        artifactLinkId
      );
      response.json({ data });
    })
  );
}
