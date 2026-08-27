import type { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  archiveCampaign,
  createCampaignDraft,
  transitionCampaign,
  updateCampaign,
  type CreateCampaignDraftInput
} from '../../domain/campaigns.js';
import {
  CampaignChannelSchema,
  CampaignEditableFieldsSchema,
  CampaignPatchSchema,
  CampaignStatusSchema,
  ReferenceTypeSchema
} from '../../domain/contracts.js';
import {
  getCampaign,
  listCampaigns,
  normalizeCampaignFilters,
  type CampaignFilters
} from '../../domain/queries.js';
import { actorFrom, asyncRoute, parseIfMatch, requireFeature, requireIdempotencyKey } from '../middleware.js';
import type { RagCourseClient } from '../../integrations/ragCourseClient.js';

const courseSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,127}$/);
const uuid = z.string().uuid();
const idParamsSchema = z.object({ id: uuid }).strict();
const createBodySchema = CampaignEditableFieldsSchema
  .partial()
  .required({ name: true })
  .extend({ courseSlug: courseSlug.optional() })
  .strict();
const transitionBodySchema = z.object({
  to: z.enum(['draft', 'planned', 'active', 'completed'])
}).strict();
const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: CampaignStatusSchema.optional(),
  referenceType: ReferenceTypeSchema.optional(),
  referenceKey: z.string().trim().min(1).max(200).optional(),
  channel: CampaignChannelSchema.optional(),
  responsible: uuid.optional(),
  periodFrom: z.string().date().optional(),
  periodTo: z.string().date().optional(),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  course: courseSlug.optional(),
  owner: uuid.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict();

export function parseCampaignListQuery(value: unknown): CampaignFilters {
  const parsed = listQuerySchema.parse(value);
  const filters: CampaignFilters = {
    limit: parsed.limit,
    ...(parsed.q !== undefined ? { q: parsed.q } : {}),
    ...(parsed.status ? { status: parsed.status } : {}),
    ...(parsed.referenceType ? { referenceType: parsed.referenceType } : {}),
    ...(parsed.referenceKey ? { referenceKey: parsed.referenceKey } : {}),
    ...(parsed.channel ? { channel: parsed.channel } : {}),
    ...(parsed.responsible ? { responsibleId: parsed.responsible } : {}),
    ...(parsed.periodFrom ? { periodFrom: parsed.periodFrom } : {}),
    ...(parsed.periodTo ? { periodTo: parsed.periodTo } : {}),
    ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
    ...(parsed.course ? { courseSlug: parsed.course } : {}),
    ...(parsed.owner ? { ownerId: parsed.owner } : {}),
    ...(parsed.from ? { updatedFrom: parsed.from } : {}),
    ...(parsed.to ? { updatedTo: parsed.to } : {})
  };
  normalizeCampaignFilters(filters);
  return filters;
}

export function parseCampaignCreateBody(
  value: unknown
): Omit<CreateCampaignDraftInput, 'idempotencyKey'> {
  return createBodySchema.parse(value) as Omit<CreateCampaignDraftInput, 'idempotencyKey'>;
}
export const parseCampaignPatchBody = (value: unknown) => CampaignPatchSchema.parse(value);
export const parseCampaignTransitionBody = (value: unknown) => transitionBodySchema.parse(value);

export function registerCampaigns(
  router: Router,
  pool: Pool,
  courseReferences: RagCourseClient,
  features: { read: boolean; write: boolean }
) {
  router.get('/v1/campaigns', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const filters = parseCampaignListQuery(request.query);
    const result = await listCampaigns({ pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' }, filters);
    response.json({
      data: result.data,
      page: { limit: filters.limit, count: result.data.length, nextCursor: result.nextCursor }
    });
  }));
  router.get('/v1/campaigns/:id', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { id } = idParamsSchema.parse(request.params);
    const data = await getCampaign({ pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' }, id);
    response.setHeader('ETag', `"${data.version}"`).json({ data });
  }));
  router.post('/v1/campaigns', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const input = parseCampaignCreateBody(request.body);
    const data = await createCampaignDraft(
      { pool, courseReferences, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' },
      { ...input, idempotencyKey: requireIdempotencyKey(request) }
    );
    response.status(201).setHeader('ETag', `"${data.version}"`).json({ data });
  }));
  router.patch('/v1/campaigns/:id', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { id } = idParamsSchema.parse(request.params);
    const data = await updateCampaign(
      { pool, courseReferences, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' },
      id,
      parseIfMatch(request),
      { ...parseCampaignPatchBody(request.body), idempotencyKey: requireIdempotencyKey(request) }
    );
    response.setHeader('ETag', `"${data.version}"`).json({ data });
  }));
  router.post('/v1/campaigns/:id/transitions', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { id } = idParamsSchema.parse(request.params);
    const { to } = parseCampaignTransitionBody(request.body);
    const data = await transitionCampaign(
      { pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' },
      id,
      parseIfMatch(request),
      to,
      requireIdempotencyKey(request)
    );
    response.setHeader('ETag', `"${data.version}"`).json({ data });
  }));
  router.post('/v1/campaigns/:id/archive', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { id } = idParamsSchema.parse(request.params);
    const data = await archiveCampaign(
      { pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' },
      id, parseIfMatch(request), requireIdempotencyKey(request)
    );
    response.setHeader('ETag', `"${data.version}"`).json({ data });
  }));
}
