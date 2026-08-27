import type { PoolClient } from 'pg';
import { appError } from '../errors.js';
import type { CommandContext } from './context.js';
import { hashCanonicalPayload } from './hash.js';

export async function executeIdempotentCommand<T>(
  client: PoolClient,
  context: CommandContext,
  operation: string,
  key: string,
  payload: unknown,
  command: () => Promise<T>
): Promise<T> {
  const requestHash = hashCanonicalPayload(payload);
  const inserted = await client.query(`
    insert into marketing_ops.idempotency_records
      (tenant_id, actor_id, operation, idempotency_key, request_hash, expires_at)
    values ($1, $2, $3, $4, $5, now() + interval '24 hours')
    on conflict do nothing
    returning request_hash
  `, [context.actor.tenantId, context.actor.userId, operation, key, requestHash]);

  if (inserted.rowCount === 0) {
    const existing = await client.query<{ request_hash: string; status: string; response_ref: T | null }>(`
      select request_hash, status::text, response_ref
      from marketing_ops.idempotency_records
      where tenant_id = $1 and actor_id = $2 and operation = $3 and idempotency_key = $4
    `, [context.actor.tenantId, context.actor.userId, operation, key]);
    const record = existing.rows[0];
    if (!record || record.request_hash !== requestHash) {
      throw appError('idempotency_conflict', 409, 'Idempotency key was already used with a different payload');
    }
    if (record.status !== 'completed' || record.response_ref === null) {
      throw appError('idempotency_in_progress', 409, 'Idempotent command is still in progress');
    }
    context.idempotencyTracker?.(true);
    return record.response_ref;
  }

  context.idempotencyTracker?.(false);
  const response = await command();
  await client.query(`
    update marketing_ops.idempotency_records
    set status = 'completed', response_ref = $5::jsonb, response_status = 200
    where tenant_id = $1 and actor_id = $2 and operation = $3 and idempotency_key = $4
  `, [context.actor.tenantId, context.actor.userId, operation, key, JSON.stringify(response)]);
  return response;
}
