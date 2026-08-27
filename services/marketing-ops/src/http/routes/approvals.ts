import type { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  ApprovalDecisionInputSchema,
  ApprovalListFiltersSchema,
  EditorialApprovalInputSchema,
  OperationalApprovalInputSchema,
  cancelApprovalRequest,
  decideApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
  submitEditorialApproval,
  submitOperationalApproval
} from '../../domain/approvals.js';
import {
  actorFrom,
  asyncRoute,
  parseIfMatch,
  requireFeature,
  requireIdempotencyKey
} from '../middleware.js';

const uuid = z.string().uuid();
const paramsSchema = z.object({ requestId: uuid }).strict();
const filtersSchema = z.object({
  status: z.string().optional(),
  kind: z.string().optional(),
  riskLevel: z.string().optional(),
  campaignId: z.string().optional(),
  requestedBy: z.string().optional(),
  expiresBefore: z.string().optional(),
  expiresAfter: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().optional()
}).strict();

export const parseEditorialApprovalBody = (value: unknown) =>
  EditorialApprovalInputSchema.parse(value);
export const parseOperationalApprovalBody = (value: unknown) =>
  OperationalApprovalInputSchema.parse(value);
export const parseApprovalDecisionBody = (value: unknown) =>
  ApprovalDecisionInputSchema.parse(value);
export const parseApprovalFilters = (value: unknown) =>
  ApprovalListFiltersSchema.parse(filtersSchema.parse(value));

function context(pool: Pool, request: Parameters<typeof actorFrom>[0]) {
  return {
    pool,
    actor: actorFrom(request),
    correlationId: request.correlationId,
    origin: 'rest' as const
  };
}

export function registerApprovals(
  router: Router,
  pool: Pool,
  features: { read: boolean; write: boolean; approvals?: boolean }
): void {
  const requireApprovals = () => requireFeature(Boolean(features.approvals), 'governance approvals');

  router.get('/v1/approval-requests', asyncRoute(async (request, response) => {
    requireApprovals();
    const filters = parseApprovalFilters(request.query);
    const page = await listApprovalRequests(context(pool, request), filters);
    response.json({
      data: page.data,
      page: { limit: filters.limit, count: page.data.length, nextCursor: page.nextCursor }
    });
  }));

  router.get('/v1/approval-requests/:requestId', asyncRoute(async (request, response) => {
    requireApprovals();
    const { requestId } = paramsSchema.parse(request.params);
    const data = await getApprovalRequest(context(pool, request), requestId);
    response.setHeader('ETag', `"${data.version}"`).json({ data });
  }));

  router.post('/v1/approval-requests/editorial', asyncRoute(async (request, response) => {
    requireApprovals();
    requireFeature(features.write, 'write');
    const body = parseEditorialApprovalBody(request.body);
    const data = await submitEditorialApproval(context(pool, request), {
      ...body,
      idempotencyKey: requireIdempotencyKey(request)
    });
    response.locals.approvalTransition = {
      kind: data.kind, status: data.status, risk: data.riskLevel
    };
    response.status(201).setHeader('ETag', `"${data.version}"`).json({ data });
  }));

  router.post('/v1/approval-requests/operational', asyncRoute(async (request, response) => {
    requireApprovals();
    requireFeature(features.write, 'write');
    const body = parseOperationalApprovalBody(request.body);
    const data = await submitOperationalApproval(context(pool, request), {
      ...body,
      idempotencyKey: requireIdempotencyKey(request)
    });
    response.locals.approvalTransition = {
      kind: data.kind, status: data.status, risk: data.riskLevel
    };
    response.status(201).setHeader('ETag', `"${data.version}"`).json({ data });
  }));

  router.post('/v1/approval-requests/:requestId/decisions', asyncRoute(async (request, response) => {
    requireApprovals();
    requireFeature(features.write, 'write');
    const { requestId } = paramsSchema.parse(request.params);
    const body = parseApprovalDecisionBody(request.body);
    const data = await decideApprovalRequest(
      context(pool, request), requestId, parseIfMatch(request),
      { ...body, idempotencyKey: requireIdempotencyKey(request) }
    );
    response.locals.approvalTransition = {
      kind: data.kind, status: data.status, risk: data.riskLevel
    };
    response.setHeader('ETag', `"${data.version}"`).json({ data });
  }));

  router.post('/v1/approval-requests/:requestId/cancel', asyncRoute(async (request, response) => {
    requireApprovals();
    requireFeature(features.write, 'write');
    const { requestId } = paramsSchema.parse(request.params);
    const data = await cancelApprovalRequest(
      context(pool, request), requestId, parseIfMatch(request), requireIdempotencyKey(request)
    );
    response.locals.approvalTransition = {
      kind: data.kind, status: data.status, risk: data.riskLevel
    };
    response.setHeader('ETag', `"${data.version}"`).json({ data });
  }));
}
