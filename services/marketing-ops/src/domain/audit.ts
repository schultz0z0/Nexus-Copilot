import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CommandContext } from './context.js';

export interface AuditTextFingerprint {
  present: boolean;
  length: number;
  sha256: string | null;
}

const SAFE_TEXT_FIELDS = new Set([
  'id', 'tenantId', 'userId', 'actorUserId', 'createdBy', 'updatedBy', 'unlinkedBy',
  'campaignId', 'itemId', 'materialId', 'artifactId', 'artifactOwnerId',
  'referenceDocumentId', 'referenceKey', 'referenceType', 'courseSlug',
  'status', 'from', 'to', 'role', 'actorRole', 'actorType', 'memberRole',
  'origin', 'source', 'kind', 'contentType', 'sha256', 'action', 'entityType',
  'eventType', 'correlationId', 'createdAt', 'updatedAt', 'archivedAt',
  'unlinkedAt', 'verifiedAt', 'referenceVerifiedAt', 'startsOn', 'endsOn',
  'primaryChannel', 'secondaryChannels', 'expiresAt', 'assigneeUserId',
  'priority', 'channel', 'startsAt', 'dueAt', 'completedAt', 'cancelledAt',
  'dependsOnItemId', 'itemVersion', 'predecessorStatus',
  'assetId', 'assetKind', 'assetVersion', 'versionNumber', 'contentHash',
  'frozenAt', 'frozen'
]);

const SECRET_FIELD = /(authorization|bearer|cookie|password|secret|token|delegation|access.?url|signed.?url)/i;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprint(serialized: string): AuditTextFingerprint {
  return {
    present: serialized.length > 0,
    length: serialized.length,
    sha256: serialized.length > 0
      ? createHash('sha256').update(serialized).digest('hex')
      : null
  };
}

function minimize(value: unknown, field?: string): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    return {
      present: bytes.length > 0,
      length: bytes.length,
      sha256: bytes.length > 0 ? createHash('sha256').update(bytes).digest('hex') : null
    };
  }
  if (typeof value === 'string') {
    if (field && SECRET_FIELD.test(field)) return { redacted: true };
    return field && SAFE_TEXT_FIELDS.has(field) ? value : fingerprint(value);
  }
  if (Array.isArray(value)) return value.map((item) => minimize(item, field));
  if (typeof value === 'object') {
    if (field === 'content') return fingerprint(canonicalJson(value));
    const minimized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      minimized[key] = SECRET_FIELD.test(key)
        ? { redacted: true }
        : minimize(item, key);
    }
    return minimized;
  }
  return fingerprint(String(value));
}

export function auditSnapshot(value: unknown): unknown {
  return minimize(value);
}

export async function writeAudit(
  client: PoolClient,
  context: CommandContext,
  entityType: string,
  entityId: string,
  action: string,
  beforeState: unknown,
  afterState: unknown
): Promise<void> {
  const beforeSnapshot = auditSnapshot(beforeState);
  const afterSnapshot = auditSnapshot(afterState);
  await client.query(`
    insert into marketing_ops.audit_events
      (tenant_id, actor_user_id, actor_role, actor_type, origin, entity_type,
       entity_id, action, before_state, after_state, correlation_id,
       operator_origin, chat_session_id, run_id, tool_name, tool_call_id,
       plan_id, plan_action_index)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11,
      $12, $13, $14, $15, $16, $17, $18)
  `, [
    context.actor.tenantId, context.actor.userId, context.actor.role,
    context.origin === 'mcp' ? 'delegated_user' : 'user', context.origin,
    entityType, entityId, action,
    beforeSnapshot === null ? null : JSON.stringify(beforeSnapshot),
    afterSnapshot === null ? null : JSON.stringify(afterSnapshot), context.correlationId,
    context.operatorOrigin ?? null,
    context.chatSessionId ?? null,
    context.runId ?? null,
    context.toolName ?? null,
    context.toolCallId ?? null,
    context.planId ?? null,
    context.planActionIndex ?? null
  ]);
}
