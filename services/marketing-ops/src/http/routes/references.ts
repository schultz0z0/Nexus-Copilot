import type { Router } from 'express';
import { z } from 'zod';
import { authorize } from '../../auth/permissions.js';
import type { RagCourseClient } from '../../integrations/ragCourseClient.js';
import { actorFrom, asyncRoute, requireFeature } from '../middleware.js';

const querySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(25).default(10)
}).strict();

export function registerReferences(
  router: Router,
  courses: RagCourseClient,
  features: { read: boolean; write: boolean }
): void {
  router.get('/v1/references/courses', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    authorize(actorFrom(request), 'reference.read');
    const { q, limit } = querySchema.parse(request.query);
    const data = await courses.searchCourses(
      q,
      limit
    );
    response.json({ data });
  }));
}
