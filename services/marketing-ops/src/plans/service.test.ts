import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { Actor } from '../auth/actor.js';
import type { MarketingOpsPlanAction, PreparedAgentPlanRecord } from './contracts.js';
import { PreparedPlanRepository } from './repository.js';
import { AgentPlanService } from './service.js';

const actorA: Actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantSlug: 'ens',
  role: 'member'
};

const sampleActions: MarketingOpsPlanAction[] = [
  {
    type: 'campaign.create_draft',
    ref: 'campaign-test',
    name: 'Test Campaign'
  }
];

const approvalActions: MarketingOpsPlanAction[] = [
  {
    type: 'approval.submit_editorial',
    campaign_id: '11111111-1111-4111-8111-111111111111',
    asset_id: '33333333-3333-4333-8333-333333333333',
    version_number: 1,
    reason: 'Review requested',
    expires_at: '2026-10-01T00:00:00.000Z'
  }
];

function createSampleRecord(overrides: Partial<PreparedAgentPlanRecord> = {}): PreparedAgentPlanRecord {
  return {
    id: randomUUID(),
    tenantId: actorA.tenantId,
    preparedBy: actorA.userId,
    chatSessionId: randomUUID(),
    sourceRunId: randomUUID(),
    preparedDelegationJti: randomUUID(),
    planHash: 'a'.repeat(64),
    actions: sampleActions,
    requiredScopes: ['campaign:write'],
    status: 'pending',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    executionKey: null,
    executionStartedAt: null,
    executionAttempts: 0,
    result: null,
    executedBy: null,
    executedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe('AgentPlanService', () => {
  describe('listPlans', () => {
    it('returns allowlisted summary DTO fields only', async () => {
      const record = createSampleRecord();
      const mockRepo = {
        listPending: vi.fn().mockResolvedValue([record])
      } as unknown as PreparedPlanRepository;

      const service = new AgentPlanService({
        pool: {} as Pool,
        planRepository: mockRepo,
        features: { read: true, write: true, structuredPlanExecution: true }
      });

      const result = await service.listPlans(actorA, { chatSessionId: record.chatSessionId });
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: record.id,
        planHash: record.planHash,
        status: record.status,
        expiresAt: record.expiresAt,
        actions: record.actions,
        requiredScopes: record.requiredScopes,
        result: null,
        executedAt: null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      });
      // Ensure no sensitive or internal fields leaked
      expect((result[0] as any).tenantId).toBeUndefined();
      expect((result[0] as any).preparedBy).toBeUndefined();
      expect((result[0] as any).preparedDelegationJti).toBeUndefined();
      expect((result[0] as any).executionKey).toBeUndefined();
      expect((result[0] as any).sourceRunId).toBeUndefined();
      expect((result[0] as any).executedBy).toBeUndefined();
    });

    it('lists all recent plans and projects a closed persisted receipt result', async () => {
      const resultPayload = {
        status: 'completed',
        plan_id: 'plan-1',
        completed: [{ action_index: 0, action_type: 'campaign.create_draft', idempotency_hit: false, resource: { id: 'campaign-1' } }],
        failed: [],
        pending: [{ action_index: 1, action_type: 'approval.submit_operational' }],
        deep_links: ['/marketing-ops/campaigns/11111111-1111-4111-8111-111111111111'],
        internal_secret: 'must-not-reach-browser'
      };
      const record = createSampleRecord({
        status: 'completed',
        result: resultPayload,
        executedAt: new Date().toISOString()
      });
      const mockRepo = {
        listRecent: vi.fn().mockResolvedValue([record])
      } as unknown as PreparedPlanRepository;
      const service = new AgentPlanService({
        pool: {} as Pool,
        planRepository: mockRepo,
        features: { read: true, write: true, structuredPlanExecution: true }
      });

      const result = await service.listPlans(actorA, {
        chatSessionId: record.chatSessionId,
        status: 'all',
        limit: 10
      });

      expect(mockRepo.listRecent).toHaveBeenCalledWith(actorA, record.chatSessionId, undefined, 10);
      expect(result[0]?.result).toEqual({
        status: 'completed',
        plan_id: 'plan-1',
        completed: resultPayload.completed,
        failed: [],
        pending: resultPayload.pending,
        deep_links: resultPayload.deep_links
      });
      expect((result[0]?.result as any).internal_secret).toBeUndefined();
    });

    it('fails closed when a legacy stored action contains a nested credential field', async () => {
      const record = createSampleRecord({
        actions: [{
          type: 'campaign_item.create',
          campaign_id: '22222222-2222-4222-8222-222222222222',
          kind: 'post',
          title: 'Unsafe legacy plan',
          metadata: { nested: { plan_token: 'must-not-reach-browser' } }
        } as unknown as MarketingOpsPlanAction]
      });
      const mockRepo = {
        listPending: vi.fn().mockResolvedValue([record])
      } as unknown as PreparedPlanRepository;
      const service = new AgentPlanService({
        pool: {} as Pool,
        planRepository: mockRepo,
        features: { read: true, write: true, structuredPlanExecution: true }
      });

      await expect(service.listPlans(actorA)).rejects.toThrow(/Credential-like fields/);
    });
  });

  describe('executePlan', () => {
    it('rejects when write feature is disabled', async () => {
      const service = new AgentPlanService({
        pool: {} as Pool,
        features: { read: true, write: false, structuredPlanExecution: true }
      });

      await expect(
        service.executePlan(actorA, 'corr-1', randomUUID(), {
          planHash: 'a'.repeat(64),
          executionKey: randomUUID()
        })
      ).rejects.toMatchObject({ code: 'feature_disabled', status: 503 });
    });

    it('rejects when structuredPlanExecution feature is disabled', async () => {
      const service = new AgentPlanService({
        pool: {} as Pool,
        features: { read: true, write: true, structuredPlanExecution: false }
      });

      await expect(
        service.executePlan(actorA, 'corr-1', randomUUID(), {
          planHash: 'a'.repeat(64),
          executionKey: randomUUID()
        })
      ).rejects.toMatchObject({ code: 'feature_disabled', status: 503 });
    });

    it('returns 404 when plan is not found', async () => {
      const mockRepo = {
        getById: vi.fn().mockResolvedValue(null)
      } as unknown as PreparedPlanRepository;

      const service = new AgentPlanService({
        pool: {} as Pool,
        planRepository: mockRepo,
        features: { read: true, write: true, structuredPlanExecution: true }
      });

      await expect(
        service.executePlan(actorA, 'corr-1', randomUUID(), {
          planHash: 'a'.repeat(64),
          executionKey: randomUUID()
        })
      ).rejects.toMatchObject({ code: 'plan_not_found', status: 404 });
    });

    it('rejects approval actions when approvals feature is disabled', async () => {
      const record = createSampleRecord({ actions: approvalActions });
      const mockRepo = {
        getById: vi.fn().mockResolvedValue(record)
      } as unknown as PreparedPlanRepository;

      const service = new AgentPlanService({
        pool: {} as Pool,
        planRepository: mockRepo,
        features: { read: true, write: true, approvals: false, structuredPlanExecution: true }
      });

      await expect(
        service.executePlan(actorA, 'corr-1', record.id, {
          planHash: record.planHash,
          executionKey: randomUUID()
        })
      ).rejects.toMatchObject({ code: 'feature_disabled', status: 503 });
    });

    it('returns already completed execution result on idempotency hit', async () => {
      const executionKey = randomUUID();
      const cachedResult = {
        plan_id: 'plan-1',
        status: 'completed',
        completed: [{ action_index: 0, action_type: 'campaign.create_draft', resource: {}, idempotency_hit: true }],
        failed: [],
        pending: [],
        deep_links: []
      };
      const record = createSampleRecord({
        status: 'completed',
        executionKey,
        result: cachedResult
      });
      const mockRepo = {
        getById: vi.fn().mockResolvedValue(record),
        reserveForExecution: vi.fn().mockResolvedValue({
          plan: record,
          isReplay: true
        })
      } as unknown as PreparedPlanRepository;

      const service = new AgentPlanService({
        pool: {} as Pool,
        planRepository: mockRepo,
        features: { read: true, write: true, structuredPlanExecution: true }
      });

      const result = await service.executePlan(actorA, 'corr-1', record.id, {
        planHash: record.planHash,
        executionKey
      });
      expect(result).toEqual(cachedResult);
    });

    it('rejects with 409 plan_executing when execution is in progress', async () => {
      const record = createSampleRecord();
      const mockRepo = {
        getById: vi.fn().mockResolvedValue(record),
        reserveForExecution: vi.fn().mockRejectedValue({
          code: 'plan_executing',
          status: 409,
          message: 'Plan execution is currently in progress'
        })
      } as unknown as PreparedPlanRepository;

      const service = new AgentPlanService({
        pool: {} as Pool,
        planRepository: mockRepo,
        features: { read: true, write: true, structuredPlanExecution: true }
      });

      await expect(
        service.executePlan(actorA, 'corr-1', record.id, {
          planHash: record.planHash,
          executionKey: randomUUID()
        })
      ).rejects.toMatchObject({ code: 'plan_executing', status: 409 });
    });

    it('reserves, executes exact stored actions, finalizes, and increments metrics', async () => {
      const planId = randomUUID();
      const planHash = 'b'.repeat(64);
      const executionKey = randomUUID();
      const record = createSampleRecord({ id: planId, planHash, actions: sampleActions });

      const mockRepo = {
        getById: vi.fn().mockResolvedValue(record),
        reserveForExecution: vi.fn().mockResolvedValue({
          plan: record,
          isReplay: false
        }),
        finalizeExecution: vi.fn().mockResolvedValue({
          ...record,
          status: 'completed'
        })
      } as unknown as PreparedPlanRepository;

      const mockMetrics = { increment: vi.fn() };
      const service = new AgentPlanService({
        pool: {} as Pool,
        planRepository: mockRepo,
        features: { read: true, write: true, structuredPlanExecution: true },
        metrics: mockMetrics
      });

      const fakeExecutor = vi.fn().mockResolvedValue({
        plan_id: planId,
        status: 'completed',
        completed: [{ action_index: 0, action_type: 'campaign.create_draft', resource: { id: 'camp-1' }, idempotency_hit: false }],
        failed: [],
        pending: [],
        deep_links: []
      });

      const result = await service.executePlan(
        actorA,
        'corr-1',
        planId,
        { planHash, executionKey },
        fakeExecutor
      );

      expect(result.status).toBe('completed');
      expect(fakeExecutor).toHaveBeenCalledWith(
        expect.objectContaining({ actor: actorA, correlationId: 'corr-1' }),
        { plan_id: planId, plan_hash: planHash, actions: sampleActions }
      );
      expect(mockRepo.finalizeExecution).toHaveBeenCalledWith(
        { actor: actorA, correlationId: 'corr-1' },
        planId,
        executionKey,
        expect.objectContaining({ status: 'completed', executedBy: actorA.userId })
      );
      expect(mockMetrics.increment).toHaveBeenCalledWith(
        'marketing_ops_plan_execution_total',
        { result: 'completed' }
      );
      expect(mockMetrics.increment).toHaveBeenCalledWith(
        'marketing_ops_plan_idempotency_total',
        { result: 'miss' }
      );
    });
  });
});
