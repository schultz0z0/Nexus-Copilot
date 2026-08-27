import type { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { listAuditEvents } from '../../domain/queries.js';
import { actorFrom, asyncRoute, requireFeature } from '../middleware.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25)
}).strict();

export function registerAudit(router: Router, pool: Pool, features: { read: boolean; write: boolean }) {
  router.get('/v1/audit-events', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { limit } = querySchema.parse(request.query);
    const data = await listAuditEvents({ pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' }, limit);
    response.json({ data, page: { limit, count: data.length } });
  }));
}
