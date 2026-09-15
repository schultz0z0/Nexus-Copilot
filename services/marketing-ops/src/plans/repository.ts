import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../auth/actor.js';
import { appError } from '../errors.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { hashCanonicalPayload } from '../domain/hash.js';
import {
  marketingOpsPlanActionsSchema,
  requiredScopesForPlan,
  type MarketingOpsPlanAction,
  type PreparedAgentPlanRecord,
  type PreparedAgentPlanStatus
} from './contracts.js';

const DEFAULT_PLAN_TTL_SECONDS = 900; // 15 minutes
const MAX_PLAN_TTL_SECONDS = 1800; // 30 minutes
const DEFAULT_LEASE_SECONDS = 60; // 1 minute

export interface PreparePlanContext {
  actor: Actor;
  chatSessionId: string;
  sourceRunId: string;
  preparedDelegationJti?: string | null;
  correlationId?: string;
}

export interface PreparePlanInput {
  actions: MarketingOpsPlanAction[];
  ttlSeconds?: number;
}

export interface ReservePlanContext {
  actor: Actor;
  correlationId: string;
}

export interface FinalizePlanContext {
  actor: Actor;
  correlationId: string;
}

export interface FinalizePlanOutcome {
  status: 'completed' | 'partial' | 'failed';
  result: Record<string, unknown>;
  executedBy: string;
}

function mapRowToRecord(row: any): PreparedAgentPlanRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    preparedBy: row.prepared_by,
    chatSessionId: row.chat_session_id,
    sourceRunId: row.source_run_id,
    preparedDelegationJti: row.prepared_delegation_jti,
    planHash: row.plan_hash,
    actions: typeof row.actions === 'string' ? JSON.parse(row.actions) : row.actions,
    requiredScopes: row.required_scopes ?? [],
    status: row.status as PreparedAgentPlanStatus,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
    executionKey: row.execution_key,
    executionStartedAt: row.execution_started_at
      ? (row.execution_started_at instanceof Date ? row.execution_started_at.toISOString() : String(row.execution_started_at))
      : null,
    executionAttempts: Number(row.execution_attempts ?? 0),
    result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : null,
    executedBy: row.executed_by,
    executedAt: row.executed_at
      ? (row.executed_at instanceof Date ? row.executed_at.toISOString() : String(row.executed_at))
      : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at)
  };
}

export class PreparedPlanRepository {
  constructor(private readonly pool: Pool) {}

  private async withClient<T>(
    actor: Actor,
    correlationId: string,
    work: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    return withActorTransaction(this.pool, actor, correlationId, work);
  }

  async prepare(context: PreparePlanContext, input: PreparePlanInput): Promise<PreparedAgentPlanRecord> {
    const actions = marketingOpsPlanActionsSchema.parse(input.actions);
    const planHash = hashCanonicalPayload(actions);
    const requiredScopes = requiredScopesForPlan(actions);
    const correlationId = context.correlationId ?? 'prepare-' + context.sourceRunId;
    const ttlSeconds = Math.max(60, Math.min(MAX_PLAN_TTL_SECONDS, input.ttlSeconds ?? DEFAULT_PLAN_TTL_SECONDS));

    return this.withClient(context.actor, correlationId, async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [[context.actor.tenantId, context.actor.userId, context.chatSessionId, context.sourceRunId].join(':')]
      );

      // Check for exact existing pending plan with same run and hash
      const existing = await client.query(
        `SELECT *
           FROM marketing_ops.prepared_agent_plans
          WHERE tenant_id = $1
            AND prepared_by = $2
            AND chat_session_id = $3
            AND source_run_id = $4
            AND plan_hash = $5
            AND status = 'pending'
            AND expires_at > clock_timestamp()
          ORDER BY created_at DESC
          LIMIT 1`,
        [context.actor.tenantId, context.actor.userId, context.chatSessionId, context.sourceRunId, planHash]
      );

      if (existing.rows.length > 0) {
        return mapRowToRecord(existing.rows[0]);
      }

      // Invalidate any existing pending plan for same run with different hash
      await client.query(
        `UPDATE marketing_ops.prepared_agent_plans
            SET status = 'invalidated'
          WHERE tenant_id = $1
            AND prepared_by = $2
            AND chat_session_id = $3
            AND source_run_id = $4
            AND status = 'pending'`,
        [context.actor.tenantId, context.actor.userId, context.chatSessionId, context.sourceRunId]
      );

      // Insert new pending plan
      const inserted = await client.query(
        `INSERT INTO marketing_ops.prepared_agent_plans (
          tenant_id,
          prepared_by,
          chat_session_id,
          source_run_id,
          prepared_delegation_jti,
          plan_hash,
          actions,
          required_scopes,
          status,
          expires_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'pending', clock_timestamp() + ($9 || ' seconds')::interval
        ) RETURNING *`,
        [
          context.actor.tenantId,
          context.actor.userId,
          context.chatSessionId,
          context.sourceRunId,
          context.preparedDelegationJti ?? null,
          planHash,
          JSON.stringify(actions),
          requiredScopes,
          ttlSeconds
        ]
      );

      return mapRowToRecord(inserted.rows[0]);
    });
  }

  async listPending(actor: Actor, chatSessionId?: string, limit = 10): Promise<PreparedAgentPlanRecord[]> {
    const correlationId = 'list-pending-' + (chatSessionId ?? 'all');
    return this.withClient(actor, correlationId, async (client) => {
      const sessionClause = chatSessionId ? ' AND chat_session_id = $3' : '';
      const updateParams: unknown[] = [actor.tenantId, actor.userId];
      if (chatSessionId) updateParams.push(chatSessionId);

      // Opportunistic expiry update
      await client.query(
        `UPDATE marketing_ops.prepared_agent_plans
            SET status = 'expired'
          WHERE tenant_id = $1
            AND prepared_by = $2${sessionClause}
            AND status = 'pending'
            AND expires_at <= clock_timestamp()`,
        updateParams
      );

      const selectParams: unknown[] = [actor.tenantId, actor.userId];
      let limitParamIndex = 3;
      if (chatSessionId) {
        selectParams.push(chatSessionId);
        limitParamIndex = 4;
      }
      selectParams.push(Math.max(1, Math.min(limit, 50)));

      const result = await client.query(
        `SELECT *
           FROM marketing_ops.prepared_agent_plans
          WHERE tenant_id = $1
            AND prepared_by = $2${sessionClause}
            AND status = 'pending'
            AND expires_at > clock_timestamp()
          ORDER BY created_at DESC
          LIMIT $${limitParamIndex}`,
        selectParams
      );

      return result.rows.map(mapRowToRecord);
    });
  }

  async getById(actor: Actor, planId: string): Promise<PreparedAgentPlanRecord | null> {
    const correlationId = 'get-plan-' + planId;
    return this.withClient(actor, correlationId, async (client) => {
      const result = await client.query(
        `SELECT *
           FROM marketing_ops.prepared_agent_plans
          WHERE id = $1
            AND tenant_id = $2
            AND prepared_by = $3`,
        [planId, actor.tenantId, actor.userId]
      );

      if (result.rows.length === 0) return null;

      const record = mapRowToRecord(result.rows[0]);
      if (record.status === 'pending' && new Date(record.expiresAt).getTime() <= Date.now()) {
        await client.query(
          `UPDATE marketing_ops.prepared_agent_plans
              SET status = 'expired'
            WHERE id = $1`,
          [planId]
        );
        return { ...record, status: 'expired' };
      }

      return record;
    });
  }

  async reserveForExecution(
    context: ReservePlanContext,
    planId: string,
    planHash: string,
    executionKey: string,
    leaseSeconds = DEFAULT_LEASE_SECONDS
  ): Promise<{ plan: PreparedAgentPlanRecord; isReplay: boolean }> {
    return this.withClient(context.actor, context.correlationId, async (client) => {
      const selectResult = await client.query(
        `SELECT *
           FROM marketing_ops.prepared_agent_plans
          WHERE id = $1
            AND tenant_id = $2
          FOR UPDATE`,
        [planId, context.actor.tenantId]
      );

      if (selectResult.rows.length === 0) {
        throw appError('plan_not_found', 404, 'Plan not found');
      }

      const plan = mapRowToRecord(selectResult.rows[0]);

      if (plan.preparedBy !== context.actor.userId) {
        throw appError('plan_forbidden', 403, 'Plan does not belong to actor');
      }

      if (plan.planHash !== planHash) {
        throw appError('plan_hash_mismatch', 409, 'Plan hash mismatch');
      }

      // If already in a terminal state
      if (plan.status === 'completed' || plan.status === 'partial' || plan.status === 'failed') {
        if (plan.executionKey === executionKey) {
          return { plan, isReplay: true };
        }
        throw appError('plan_not_pending', 409, `Plan is already in terminal state ${plan.status}`);
      }

      if (plan.status === 'invalidated') {
        throw appError('plan_invalidated', 409, 'Plan was invalidated by a revised plan');
      }

      if (plan.status === 'expired' || (plan.status === 'pending' && new Date(plan.expiresAt).getTime() <= Date.now())) {
        if (plan.status === 'pending') {
          await client.query(
            `UPDATE marketing_ops.prepared_agent_plans SET status = 'expired' WHERE id = $1`,
            [planId]
          );
        }
        throw appError('plan_expired', 410, 'Plan has expired');
      }

      // If already executing
      if (plan.status === 'executing') {
        if (plan.executionKey === executionKey) {
          const startedAt = plan.executionStartedAt ? new Date(plan.executionStartedAt).getTime() : 0;
          const leaseExpired = Date.now() - startedAt > leaseSeconds * 1000;
          if (leaseExpired) {
            // Stale lease: allow recovery with same execution key
            const updated = await client.query(
              `UPDATE marketing_ops.prepared_agent_plans
                  SET execution_started_at = clock_timestamp(),
                      execution_attempts = execution_attempts + 1
                WHERE id = $1
                RETURNING *`,
              [planId]
            );
            return { plan: mapRowToRecord(updated.rows[0]), isReplay: false };
          }
          throw appError('plan_executing', 409, 'Plan execution is currently in progress');
        }
        throw appError('plan_executing', 409, 'Plan is being executed under a different key');
      }

      // Plan is pending: reserve it
      const updated = await client.query(
        `UPDATE marketing_ops.prepared_agent_plans
            SET status = 'executing',
                execution_key = $1,
                execution_started_at = clock_timestamp(),
                execution_attempts = execution_attempts + 1
          WHERE id = $2
            AND status = 'pending'
          RETURNING *`,
        [executionKey, planId]
      );

      if (updated.rows.length === 0) {
        throw appError('plan_not_pending', 409, 'Plan is no longer pending');
      }

      return { plan: mapRowToRecord(updated.rows[0]), isReplay: false };
    });
  }

  async finalizeExecution(
    context: FinalizePlanContext,
    planId: string,
    executionKey: string,
    outcome: FinalizePlanOutcome
  ): Promise<PreparedAgentPlanRecord> {
    return this.withClient(context.actor, context.correlationId, async (client) => {
      const updated = await client.query(
        `UPDATE marketing_ops.prepared_agent_plans
            SET status = $1,
                result = $2::jsonb,
                executed_by = $3,
                executed_at = clock_timestamp()
          WHERE id = $4
            AND tenant_id = $5
            AND execution_key = $6
            AND status = 'executing'
          RETURNING *`,
        [
          outcome.status,
          JSON.stringify(outcome.result),
          outcome.executedBy,
          planId,
          context.actor.tenantId,
          executionKey
        ]
      );

      if (updated.rows.length === 0) {
        throw appError('plan_finalize_failed', 409, 'Unable to finalize plan execution');
      }

      return mapRowToRecord(updated.rows[0]);
    });
  }
}
