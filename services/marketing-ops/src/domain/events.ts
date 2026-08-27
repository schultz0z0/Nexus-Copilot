import type { PoolClient } from 'pg';
import { auditSnapshot } from './audit.js';
import type { CommandContext } from './context.js';

export async function writeDomainEvent(
  client: PoolClient,
  context: CommandContext,
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: unknown
): Promise<void> {
  const minimizedPayload = auditSnapshot(payload);
  await client.query(`
    insert into marketing_ops.domain_events
      (tenant_id, aggregate_type, aggregate_id, event_type, event_version, payload, correlation_id)
    values ($1, $2, $3, $4, 1, $5::jsonb, $6)
  `, [
    context.actor.tenantId,
    aggregateType,
    aggregateId,
    eventType,
    JSON.stringify(minimizedPayload),
    context.correlationId
  ]);
}
