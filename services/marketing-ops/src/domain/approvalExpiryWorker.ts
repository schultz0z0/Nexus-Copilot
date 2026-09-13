import type { Pool } from 'pg';

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

const boundedLimit = (value: number | undefined) => Math.max(1, Math.min(value ?? 100, 100));

export async function expireApprovalRequestsBatch(
  pool: Pool,
  options: ApprovalExpiryBatchOptions = {}
): Promise<{ expired: number }> {
  const result = await pool.query<{ expired: number }>(`
    select marketing_ops_private.expire_approval_requests_batch(
      $1::timestamptz, $2::integer, $3::uuid, $4::uuid
    )::integer as expired
  `, [
    (options.now ?? new Date()).toISOString(),
    boundedLimit(options.limit),
    options.tenantId ?? null,
    options.requestId ?? null
  ]);
  return { expired: result.rows[0]?.expired ?? 0 };
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
