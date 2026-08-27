import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export interface ApprovalExpiryBatchOptions {
  now?: Date;
  limit?: number;
  tenantId?: string;
  requestId?: string;
}

export interface ApprovalExpiryWorkerOptions {
  intervalMs: number;
  batchSize: number;
  onError?: (error: unknown) => void;
}

interface ExpiryCandidate {
  id: string;
  tenant_id: string;
  campaign_id: string;
  kind: 'editorial' | 'operational';
  requested_by: string;
  action_package_id: string | null;
  version: number | string;
}

const boundedLimit = (value: number | undefined) => Math.max(1, Math.min(value ?? 100, 100));

async function configureSystemTransaction(client: PoolClient, correlationId: string): Promise<void> {
  await client.query('begin');
  await client.query("select set_config('marketing_ops.correlation_id', $1, true)", [correlationId]);
  await client.query("select set_config('marketing_ops.system_origin', 'approval_expiry_worker', true)");
  await client.query('set local role service_role');
}

export async function expireApprovalRequestsBatch(
  pool: Pool,
  options: ApprovalExpiryBatchOptions = {}
): Promise<{ expired: number }> {
  const client = await pool.connect();
  const now = options.now ?? new Date();
  const correlationId = randomUUID();
  let expired = 0;
  try {
    await configureSystemTransaction(client, correlationId);
    const candidates = await client.query<ExpiryCandidate>(`
      select request.id, request.tenant_id, request.campaign_id, request.kind,
        request.requested_by, request.action_package_id, request.version
      from marketing_ops.approval_requests as request
      where request.status = 'pending'
        and request.expires_at <= $1
        and ($2::uuid is null or request.tenant_id = $2)
        and ($3::uuid is null or request.id = $3)
      order by request.expires_at, request.id
      limit $4
      for update skip locked
    `, [now.toISOString(), options.tenantId ?? null, options.requestId ?? null, boundedLimit(options.limit)]);

    for (const candidate of candidates.rows) {
      const decision = await client.query<{ id: string }>(`
        insert into marketing_ops.approval_decisions (
          tenant_id, request_id, decision, decided_by, decider_role,
          decision_origin, comment, eligibility_snapshot, correlation_id
        ) values ($1, $2, 'expired', null, null, 'system', null, $3::jsonb, $4)
        on conflict (request_id) do nothing
        returning id
      `, [candidate.tenant_id, candidate.id,
        JSON.stringify({ origin: 'approval_expiry_worker', expiredAt: now.toISOString() }),
        correlationId]);
      if (!decision.rows[0]) continue;

      const updated = await client.query<{ id: string }>(`
        update marketing_ops.approval_requests
        set status = 'expired', version = version + 1
        where id = $1 and tenant_id = $2 and status = 'pending' and version = $3
        returning id
      `, [candidate.id, candidate.tenant_id, Number(candidate.version)]);
      if (!updated.rows[0]) {
        throw new Error(`Approval ${candidate.id} changed while being expired`);
      }

      if (candidate.action_package_id) {
        const actionPackage = await client.query(`
          update marketing_ops.action_packages
          set status = 'expired', invalidated_at = $2,
            invalidation_reason = 'approval_expired', version = version + 1
          where id = $1 and tenant_id = $3 and status = 'pending_approval'
          returning id
        `, [candidate.action_package_id, now.toISOString(), candidate.tenant_id]);
        if (!actionPackage.rows[0]) {
          throw new Error(`Approval ${candidate.id} references a non-expirable action package`);
        }
      }

      await client.query(`
        insert into marketing_ops.audit_events (
          tenant_id, actor_user_id, actor_role, actor_type, origin, entity_type,
          entity_id, action, before_state, after_state, correlation_id
        ) values ($1, null, null, 'service', 'internal', 'approval_request', $2,
          'approval.expired', '{"status":"pending"}'::jsonb,
          '{"status":"expired","origin":"approval_expiry_worker"}'::jsonb, $3)
      `, [candidate.tenant_id, candidate.id, correlationId]);
      await client.query(`
        insert into marketing_ops.domain_events (
          tenant_id, aggregate_type, aggregate_id, event_type, event_version,
          payload, correlation_id
        ) values ($1, 'approval_request', $2,
          'marketing_ops.approval.expired.v1', 1, $3::jsonb, $4)
      `, [candidate.tenant_id, candidate.id, JSON.stringify({
        requestId: candidate.id,
        campaignId: candidate.campaign_id,
        kind: candidate.kind,
        status: 'expired',
        origin: 'approval_expiry_worker'
      }), correlationId]);
      await client.query(`
        insert into marketing_ops.in_app_notifications (
          tenant_id, user_id, event_key, notification_type, campaign_id,
          item_id, approval_request_id, label, payload, occurred_at
        ) values ($1, $2, 'approval-status:' || $3::text || ':expired',
          'approval_status', $4, null, $3::uuid, 'Solicita\u00e7\u00e3o de aprova\u00e7\u00e3o atualizada',
          jsonb_build_object('campaignId', $4::uuid, 'approvalRequestId', $3::uuid,
            'status', 'expired'), $5)
        on conflict (tenant_id, user_id, event_key) do nothing
      `, [candidate.tenant_id, candidate.requested_by, candidate.id,
        candidate.campaign_id, now.toISOString()]);
      expired += 1;
    }

    await client.query('commit');
    return { expired };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function startApprovalExpiryWorker(pool: Pool, options: ApprovalExpiryWorkerOptions): () => void {
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await expireApprovalRequestsBatch(pool, { limit: options.batchSize });
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), options.intervalMs);
  timer.unref();
  void run();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
