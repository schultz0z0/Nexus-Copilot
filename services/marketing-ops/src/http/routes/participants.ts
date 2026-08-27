import type { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  AddParticipantSchema,
  UpdateParticipantSchema,
  addParticipant,
  listParticipantCandidates,
  listParticipants,
  removeParticipant,
  updateParticipant
} from '../../domain/participants.js';
import {
  actorFrom,
  asyncRoute,
  parseIfMatch,
  requireFeature,
  requireIdempotencyKey
} from '../middleware.js';

const uuid = z.string().uuid();
const campaignParamsSchema = z.object({ campaignId: uuid }).strict();
const participantParamsSchema = z.object({ campaignId: uuid, userId: uuid }).strict();
const candidateQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(25)
}).strict();

export function registerParticipants(
  router: Router,
  pool: Pool,
  features: { read: boolean; write: boolean }
): void {
  router.get('/v1/campaigns/:campaignId/participants', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { campaignId } = campaignParamsSchema.parse(request.params);
    const data = await listParticipants(
      { pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' },
      campaignId
    );
    response.json({ data });
  }));

  router.get('/v1/campaigns/:campaignId/participant-candidates', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const { campaignId } = campaignParamsSchema.parse(request.params);
    const { q, limit } = candidateQuerySchema.parse(request.query);
    const data = await listParticipantCandidates(
      { pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' },
      campaignId,
      { q, limit }
    );
    response.json({ data });
  }));

  router.post('/v1/campaigns/:campaignId/participants', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { campaignId } = campaignParamsSchema.parse(request.params);
    const data = await addParticipant(
      { pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' },
      campaignId,
      parseIfMatch(request),
      { ...AddParticipantSchema.parse(request.body), idempotencyKey: requireIdempotencyKey(request) }
    );
    response.status(201).setHeader('ETag', `"${data.campaignVersion}"`).json({ data });
  }));

  router.patch('/v1/campaigns/:campaignId/participants/:userId', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { campaignId, userId } = participantParamsSchema.parse(request.params);
    const data = await updateParticipant(
      { pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' },
      campaignId,
      userId,
      parseIfMatch(request),
      { ...UpdateParticipantSchema.parse(request.body), idempotencyKey: requireIdempotencyKey(request) }
    );
    response.setHeader('ETag', `"${data.campaignVersion}"`).json({ data });
  }));

  router.delete('/v1/campaigns/:campaignId/participants/:userId', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { campaignId, userId } = participantParamsSchema.parse(request.params);
    const data = await removeParticipant(
      { pool, actor: actorFrom(request), correlationId: request.correlationId, origin: 'rest' },
      campaignId,
      userId,
      parseIfMatch(request),
      requireIdempotencyKey(request)
    );
    response.setHeader('ETag', `"${data.campaignVersion}"`).json({ data });
  }));
}
