import type { Request, Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  LinkExistingMaterialSchema,
  MAX_CAMPAIGN_MATERIAL_BYTES,
  attachUploadedMaterial,
  createMaterialAccessLink,
  linkExistingMaterial,
  listMaterials,
  unlinkMaterial
} from '../../domain/materials.js';
import { appError } from '../../errors.js';
import type { ArtifactClient } from '../../integrations/artifactClient.js';
import {
  actorFrom,
  asyncRoute,
  parseIfMatch,
  requireFeature,
  requireIdempotencyKey
} from '../middleware.js';

const uuid = z.string().uuid();
const campaignParamsSchema = z.object({ campaignId: uuid }).strict();
const materialParamsSchema = z.object({ campaignId: uuid, materialId: uuid }).strict();

export async function readBinaryBody(request: Request): Promise<Buffer> {
  const declaredLength = Number(request.header('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CAMPAIGN_MATERIAL_BYTES) {
    throw appError('material_too_large', 413, 'Material exceeds 25 MiB');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_CAMPAIGN_MATERIAL_BYTES) {
      throw appError('material_too_large', 413, 'Material exceeds 25 MiB');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

export function registerMaterials(
  router: Router,
  pool: Pool,
  artifacts: ArtifactClient,
  features: { read: boolean; write: boolean }
): void {
  router.get('/v1/campaigns/:campaignId/materials', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { campaignId } = campaignParamsSchema.parse(request.params);
    const data = await listMaterials(
      {
        pool,
        artifacts,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      campaignId
    );
    response.json({ data });
  }));

  router.post('/v1/campaigns/:campaignId/materials/upload', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { campaignId } = campaignParamsSchema.parse(request.params);
    const data = await attachUploadedMaterial(
      {
        pool,
        artifacts,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      campaignId,
      parseIfMatch(request),
      {
        filename: request.header('x-nexus-filename') ?? '',
        contentType: request.header('content-type') ?? '',
        bytes: await readBinaryBody(request)
      },
      requireIdempotencyKey(request)
    );
    response.status(201).setHeader('ETag', `"${data.campaignVersion}"`).json({ data });
  }));

  router.post('/v1/campaigns/:campaignId/materials/link', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { campaignId } = campaignParamsSchema.parse(request.params);
    const body = LinkExistingMaterialSchema.parse(request.body);
    const data = await linkExistingMaterial(
      {
        pool,
        artifacts,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      campaignId,
      parseIfMatch(request),
      body.artifactId,
      requireIdempotencyKey(request)
    );
    response.status(201).setHeader('ETag', `"${data.campaignVersion}"`).json({ data });
  }));

  router.post('/v1/campaigns/:campaignId/materials/:materialId/access-link', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { campaignId, materialId } = materialParamsSchema.parse(request.params);
    const data = await createMaterialAccessLink(
      {
        pool,
        artifacts,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      campaignId,
      materialId
    );
    response.json({ data });
  }));

  router.delete('/v1/campaigns/:campaignId/materials/:materialId', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { campaignId, materialId } = materialParamsSchema.parse(request.params);
    const data = await unlinkMaterial(
      {
        pool,
        artifacts,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      campaignId,
      materialId,
      parseIfMatch(request),
      requireIdempotencyKey(request)
    );
    response.setHeader('ETag', `"${data.campaignVersion}"`).json({ data });
  }));
}
