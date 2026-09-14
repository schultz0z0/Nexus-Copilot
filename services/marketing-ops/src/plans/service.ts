import type { Pool } from 'pg';
import type { Actor } from '../auth/actor.js';
import { appError } from '../errors.js';
import type { ArtifactClient } from '../integrations/artifactClient.js';
import type { MetricsRegistry } from '../observability/metrics.js';
import type {
  MarketingOpsPlanAction,
  PreparedAgentPlanRecord,
  PreparedAgentPlanStatus,
  PreparedAgentPlanSummaryDTO
} from './contracts.js';
import {
  executeMarketingOpsPlan,
  type MarketingOpsPlanExecutionResult,
  type PlanExecutorContext
} from './executor.js';
import { PreparedPlanRepository } from './repository.js';

export interface AgentPlanServiceDependencies {
  pool: Pool;
  planRepository?: PreparedPlanRepository;
  artifacts?: ArtifactClient;
  features: {
    read: boolean;
    write: boolean;
    approvals?: boolean;
    structuredPlanExecution?: boolean;
  };
  metrics?: Pick<MetricsRegistry, 'increment'>;
}

export interface ListPlansFilter {
  chatSessionId?: string;
  status?: PreparedAgentPlanStatus;
  limit?: number;
}

export interface ExecutePlanInput {
  planHash: string;
  executionKey: string;
}

export type PlanExecutorFn = (
  context: PlanExecutorContext,
  plan: { plan_id: string; plan_hash?: string; actions: MarketingOpsPlanAction[] }
) => Promise<MarketingOpsPlanExecutionResult>;

export function toSummaryDTO(record: PreparedAgentPlanRecord): PreparedAgentPlanSummaryDTO {
  return {
    id: record.id,
    planHash: record.planHash,
    status: record.status,
    expiresAt: record.expiresAt,
    actions: record.actions,
    requiredScopes: record.requiredScopes,
    createdAt: record.createdAt
  };
}

export class AgentPlanService {
  constructor(private readonly deps: AgentPlanServiceDependencies) {}

  private get repository(): PreparedPlanRepository {
    return this.deps.planRepository ?? new PreparedPlanRepository(this.deps.pool);
  }

  async listPlans(actor: Actor, filter: ListPlansFilter = {}): Promise<PreparedAgentPlanSummaryDTO[]> {
    if (!this.deps.features.read) {
      throw appError('feature_disabled', 503, 'Feature read is disabled');
    }
    const records = await this.repository.listPending(actor, filter.chatSessionId, filter.limit);
    return records.map(toSummaryDTO);
  }

  async executePlan(
    actor: Actor,
    correlationId: string,
    planId: string,
    input: ExecutePlanInput,
    executor: PlanExecutorFn = executeMarketingOpsPlan
  ): Promise<MarketingOpsPlanExecutionResult> {
    if (!this.deps.features.write) {
      throw appError('feature_disabled', 503, 'Feature write is disabled');
    }
    if (this.deps.features.structuredPlanExecution === false) {
      throw appError('feature_disabled', 503, 'Structured plan execution is disabled');
    }

    const plan = await this.repository.getById(actor, planId);
    if (!plan) {
      throw appError('plan_not_found', 404, 'Prepared agent plan not found');
    }

    if (plan.actions.some((action) => action.type.startsWith('approval.')) && !this.deps.features.approvals) {
      throw appError('feature_disabled', 503, 'Governance approvals are disabled');
    }

    const reservation = await this.repository.reserveForExecution(
      { actor, correlationId },
      planId,
      input.planHash,
      input.executionKey
    );

    if (reservation.isReplay) {
      this.deps.metrics?.increment('marketing_ops_plan_execution_total', {
        result: reservation.plan.status
      });
      this.deps.metrics?.increment('marketing_ops_plan_idempotency_total', {
        result: 'hit'
      });
      return reservation.plan.result as unknown as MarketingOpsPlanExecutionResult;
    }

    const executionResult = await executor(
      {
        pool: this.deps.pool,
        actor,
        correlationId,
        origin: 'rest',
        chatSessionId: reservation.plan.chatSessionId,
        planId: reservation.plan.id,
        ...(this.deps.artifacts ? { artifacts: this.deps.artifacts } : {})
      },
      {
        plan_id: reservation.plan.id,
        plan_hash: reservation.plan.planHash,
        actions: reservation.plan.actions
      }
    );

    await this.repository.finalizeExecution(
      { actor, correlationId },
      planId,
      input.executionKey,
      {
        status: executionResult.status,
        result: executionResult as unknown as Record<string, unknown>,
        executedBy: actor.userId
      }
    );

    this.deps.metrics?.increment('marketing_ops_plan_execution_total', {
      result: executionResult.status
    });
    for (const completed of executionResult.completed) {
      this.deps.metrics?.increment('marketing_ops_plan_idempotency_total', {
        result: completed.idempotency_hit ? 'hit' : 'miss'
      });
    }

    return executionResult;
  }
}
