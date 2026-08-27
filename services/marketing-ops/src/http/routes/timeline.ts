import type { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { listCampaignTimeline } from '../../domain/timeline.js';
import { actorFrom, asyncRoute, requireFeature } from '../middleware.js';

const paramsSchema = z.object({ campaignId: z.string().uuid() }).strict();
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(1024).optional()
}).strict();

export function registerTimeline(
  router: Router,
  pool: Pool,
  features: { read: boolean; write: boolean }
): void {
  router.get('/v1/campaigns/:campaignId/timeline', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { campaignId } = paramsSchema.parse(request.params);
    const query = querySchema.parse(request.query);
    const result = await listCampaignTimeline(
      {
        pool,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      campaignId,
      {
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {})
      }
    );
    response.json({
      data: result.data,
      page: {
        limit: query.limit,
        count: result.data.length,
        nextCursor: result.nextCursor
      }
    });
  }));
}
