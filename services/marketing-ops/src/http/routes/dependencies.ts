import type { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  addItemDependency,
  listItemDependencies,
  removeItemDependency
} from '../../domain/dependencies.js';
import {
  actorFrom,
  asyncRoute,
  parseIfMatch,
  requireFeature,
  requireIdempotencyKey
} from '../middleware.js';

const uuid = z.string().uuid();
const itemParamsSchema = z.object({ itemId: uuid }).strict();
const dependencyBodySchema = z.object({ dependsOnItemId: uuid }).strict();

export const parseDependencyBody = (value: unknown) =>
  dependencyBodySchema.parse(value);

export function registerDependencies(
  router: Router,
  pool: Pool,
  features: { read: boolean; write: boolean }
): void {
  router.get('/v1/campaign-items/:itemId/dependencies', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { itemId } = itemParamsSchema.parse(request.params);
    const data = await listItemDependencies(
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

  router.post('/v1/campaign-items/:itemId/dependencies', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { itemId } = itemParamsSchema.parse(request.params);
    const { dependsOnItemId } = parseDependencyBody(request.body);
    const data = await addItemDependency(
      {
        pool,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      itemId,
      dependsOnItemId,
      parseIfMatch(request),
      requireIdempotencyKey(request)
    );
    response.status(201).setHeader('ETag', `"${data.itemVersion}"`).json({ data });
  }));

  router.delete('/v1/campaign-items/:itemId/dependencies', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { itemId } = itemParamsSchema.parse(request.params);
    const { dependsOnItemId } = parseDependencyBody(request.body);
    const data = await removeItemDependency(
      {
        pool,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      itemId,
      dependsOnItemId,
      parseIfMatch(request),
      requireIdempotencyKey(request)
    );
    response.setHeader('ETag', `"${data.itemVersion}"`).json({ data });
  }));
}
