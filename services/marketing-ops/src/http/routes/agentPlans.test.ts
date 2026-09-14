import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../auth/actor.js';
import { AppError } from '../../errors.js';
import type { AgentPlanService } from '../../plans/service.js';
import {
  parseAgentPlansListQuery,
  parseExecutePlanBody,
  registerAgentPlans
} from './agentPlans.js';

const actorA: Actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantSlug: 'ens',
  role: 'member'
};

function createTestApp(
  service: Partial<AgentPlanService>,
  features = { read: true, write: true, structuredPlanExecution: true }
): Express {
  const app = express();
  app.use(express.json());
  // Mock auth middleware setting request.actor and request.correlationId
  app.use((req, _res, next) => {
    (req as any).actor = actorA;
    (req as any).correlationId = req.headers['x-correlation-id'] || 'test-corr';
    next();
  });
  const router = express.Router();
  registerAgentPlans(router, service as AgentPlanService, features);
  app.use(router);

  // Express error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof AppError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, status: err.status }
      });
      return;
    }
    if (err.name === 'ZodError') {
      res.status(400).json({
        error: { code: 'bad_request', message: 'Validation failed', status: 400 }
      });
      return;
    }
    res.status(err.status || 500).json({
      error: { code: err.code || 'internal_error', message: err.message, status: err.status || 500 }
    });
  });

  return app;
}

describe('agentPlans wire contract', () => {
  describe('validation parsing', () => {
    it('accepts valid query parameters and defaults limit and status', () => {
      const sessionId = randomUUID();
      const parsed = parseAgentPlansListQuery({
        chat_session_id: sessionId
      });
      expect(parsed).toEqual({
        chatSessionId: sessionId,
        status: 'pending',
        limit: 25
      });
    });

    it('rejects unknown query fields in strict list query', () => {
      expect(() => parseAgentPlansListQuery({ unknown: 'field' })).toThrow();
    });

    it('parses valid execute plan body with planHash only', () => {
      const planHash = 'c'.repeat(64);
      const parsed = parseExecutePlanBody({ planHash });
      expect(parsed).toEqual({ planHash });
    });

    it('strictly rejects malicious execute body containing actions or other unexpected fields', () => {
      const planHash = 'c'.repeat(64);
      expect(() =>
        parseExecutePlanBody({
          planHash,
          actions: [{ type: 'campaign.create_draft', ref: 'hacked', name: 'Injected action' }]
        })
      ).toThrow();
    });

    it('rejects malformed planHash', () => {
      expect(() => parseExecutePlanBody({ planHash: 'invalid-hash' })).toThrow();
    });
  });

  describe('HTTP endpoints', () => {
    it('GET /v1/agent-plans returns 200 and list of plan summaries', async () => {
      const sessionId = randomUUID();
      const sampleDto = {
        id: randomUUID(),
        planHash: 'd'.repeat(64),
        status: 'pending' as const,
        expiresAt: new Date().toISOString(),
        actions: [{ type: 'campaign.create_draft' as const, ref: 'c1', name: 'Camp' }],
        requiredScopes: ['campaign:write'],
        createdAt: new Date().toISOString()
      };
      const mockService = {
        listPlans: vi.fn().mockResolvedValue([sampleDto])
      };
      const app = createTestApp(mockService);

      const res = await request(app)
        .get(`/v1/agent-plans?chat_session_id=${sessionId}`)
        .expect(200);

      expect(res.body).toEqual({ data: [sampleDto] });
      expect(mockService.listPlans).toHaveBeenCalledWith(
        actorA,
        expect.objectContaining({ chatSessionId: sessionId, status: 'pending', limit: 25 })
      );
    });

    it('POST /v1/agent-plans/:planId/execute requires Idempotency-Key header', async () => {
      const planId = randomUUID();
      const app = createTestApp({});

      const res = await request(app)
        .post(`/v1/agent-plans/${planId}/execute`)
        .send({ planHash: 'e'.repeat(64) })
        .expect(400);

      expect(res.body.error.code).toBe('idempotency_key_required');
    });

    it('POST /v1/agent-plans/:planId/execute rejects unknown body fields with 400', async () => {
      const planId = randomUUID();
      const app = createTestApp({});

      const res = await request(app)
        .post(`/v1/agent-plans/${planId}/execute`)
        .set('Idempotency-Key', randomUUID())
        .send({
          planHash: 'e'.repeat(64),
          actions: [{ type: 'campaign.create_draft' }]
        })
        .expect(400);

      expect(res.body.error.code).toBe('bad_request');
    });

    it('POST /v1/agent-plans/:planId/execute executes plan and returns execution result', async () => {
      const planId = randomUUID();
      const planHash = 'f'.repeat(64);
      const executionKey = randomUUID();
      const executionResult = {
        plan_id: planId,
        status: 'completed',
        completed: [{ action_index: 0, action_type: 'campaign.create_draft', resource: {}, idempotency_hit: false }],
        failed: [],
        pending: [],
        deep_links: []
      };

      const mockService = {
        executePlan: vi.fn().mockResolvedValue(executionResult)
      };
      const app = createTestApp(mockService);

      const res = await request(app)
        .post(`/v1/agent-plans/${planId}/execute`)
        .set('Idempotency-Key', executionKey)
        .send({ planHash })
        .expect(200);

      expect(res.body).toEqual({ data: executionResult });
      expect(mockService.executePlan).toHaveBeenCalledWith(
        actorA,
        expect.any(String),
        planId,
        { planHash, executionKey }
      );
    });

    it('POST /v1/agent-plans/:planId/execute denies when write feature is disabled', async () => {
      const planId = randomUUID();
      const app = createTestApp({}, { read: true, write: false, structuredPlanExecution: true });

      const res = await request(app)
        .post(`/v1/agent-plans/${planId}/execute`)
        .set('Idempotency-Key', randomUUID())
        .send({ planHash: 'f'.repeat(64) })
        .expect(503);

      expect(res.body.error.code).toBe('feature_disabled');
    });

    it('POST /v1/agent-plans/:planId/execute denies when structuredPlanExecution feature is disabled', async () => {
      const planId = randomUUID();
      const app = createTestApp({}, { read: true, write: true, structuredPlanExecution: false });

      const res = await request(app)
        .post(`/v1/agent-plans/${planId}/execute`)
        .set('Idempotency-Key', randomUUID())
        .send({ planHash: 'f'.repeat(64) })
        .expect(503);

      expect(res.body.error.code).toBe('feature_disabled');
    });
  });
});
