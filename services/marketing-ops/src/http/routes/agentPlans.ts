import type { Router } from 'express';
import { z } from 'zod';
import type { PreparedAgentPlanStatus } from '../../plans/contracts.js';
import type { AgentPlanService } from '../../plans/service.js';
import { actorFrom, asyncRoute, requireFeature, requireIdempotencyKey } from '../middleware.js';

const uuid = z.string().uuid();
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

const listQuerySchema = z.object({
  chat_session_id: uuid.optional(),
  status: z.enum([
    'pending', 'executing', 'completed', 'partial', 'failed', 'expired', 'invalidated', 'all'
  ]).default('pending'),
  limit: z.coerce.number().int().min(1).max(100).default(25)
}).strict();

const executeParamsSchema = z.object({
  planId: uuid
}).strict();

const executeBodySchema = z.object({
  planHash: sha256Hex
}).strict();

export interface AgentPlansFilter {
  chatSessionId?: string;
  status: PreparedAgentPlanStatus | 'all';
  limit: number;
}

export function parseAgentPlansListQuery(value: unknown): AgentPlansFilter {
  const parsed = listQuerySchema.parse(value);
  return {
    ...(parsed.chat_session_id ? { chatSessionId: parsed.chat_session_id } : {}),
    status: parsed.status as PreparedAgentPlanStatus | 'all',
    limit: parsed.limit
  };
}

export function parseExecutePlanBody(value: unknown): { planHash: string } {
  return executeBodySchema.parse(value);
}

export function registerAgentPlans(
  router: Router,
  service: AgentPlanService,
  features: { read: boolean; write: boolean; structuredPlanExecution?: boolean }
) {
  router.get('/v1/agent-plans', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const filter = parseAgentPlansListQuery(request.query);
    const data = await service.listPlans(actorFrom(request), filter);
    response.json({ data });
  }));

  router.post('/v1/agent-plans/:planId/execute', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    requireFeature(Boolean(features.structuredPlanExecution), 'structured_plan_execution');
    const executionKey = requireIdempotencyKey(request);
    const { planId } = executeParamsSchema.parse(request.params);
    const { planHash } = parseExecutePlanBody(request.body);
    const data = await service.executePlan(
      actorFrom(request),
      request.correlationId,
      planId,
      { planHash, executionKey }
    );
    response.json({ data });
  }));
}
