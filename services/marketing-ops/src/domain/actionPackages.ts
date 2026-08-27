import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { CommandContext } from './context.js';
import { hashCanonicalPayload } from './hash.js';

const jsonObject = z.record(z.unknown());

export const ActionPackageInputSchema = z.object({
  actionType: z.string().trim().min(1).max(100),
  channel: z.string().trim().min(1).max(64),
  audienceSnapshot: jsonObject,
  scheduledFor: z.string().datetime({ offset: true }).nullable().default(null),
  timeZone: z.string().trim().min(1).max(100).refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA timezone'),
  configuration: jsonObject,
  successCriteria: z.string().trim().max(2000).nullable().default(null),
  riskSummary: z.string().trim().max(2000).nullable().default(null),
  payload: jsonObject
}).strict();

export type CanonicalActionPackage = z.output<typeof ActionPackageInputSchema>;
export type ActionPackageInput = z.input<typeof ActionPackageInputSchema>;

export interface ActionPackage extends CanonicalActionPackage {
  id: string;
  campaignId: string;
  payloadHash: string;
  status: 'pending_approval' | 'authorized' | 'invalidated' | 'expired';
  authorizedByRequestId: string | null;
  authorizedAt: string | null;
  expiresAt: string;
  invalidatedAt: string | null;
  invalidationReason: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface ActionPackageRow {
  id: string;
  campaign_id: string;
  created_by: string;
  action_type: string;
  channel: string;
  audience_snapshot: Record<string, unknown>;
  scheduled_for: Date | string | null;
  time_zone: string;
  configuration: Record<string, unknown>;
  success_criteria: string | null;
  risk_summary: string | null;
  payload: Record<string, unknown>;
  payload_hash: string;
  status: ActionPackage['status'];
  authorized_by_request_id: string | null;
  authorized_at: Date | string | null;
  expires_at: Date | string;
  invalidated_at: Date | string | null;
  invalidation_reason: string | null;
  version: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

const iso = (value: Date | string) => new Date(value).toISOString();
const nullableIso = (value: Date | string | null) => value === null ? null : iso(value);

export function canonicalActionPackage(value: ActionPackageInput): CanonicalActionPackage {
  return ActionPackageInputSchema.parse(value);
}

export function hashActionPackage(value: ActionPackageInput): string {
  return hashCanonicalPayload(canonicalActionPackage(value));
}

export function mapActionPackage(row: ActionPackageRow): ActionPackage {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    createdBy: row.created_by,
    actionType: row.action_type,
    channel: row.channel,
    audienceSnapshot: row.audience_snapshot,
    scheduledFor: nullableIso(row.scheduled_for),
    timeZone: row.time_zone,
    configuration: row.configuration,
    successCriteria: row.success_criteria,
    riskSummary: row.risk_summary,
    payload: row.payload,
    payloadHash: row.payload_hash,
    status: row.status,
    authorizedByRequestId: row.authorized_by_request_id,
    authorizedAt: nullableIso(row.authorized_at),
    expiresAt: iso(row.expires_at),
    invalidatedAt: nullableIso(row.invalidated_at),
    invalidationReason: row.invalidation_reason,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

export async function insertActionPackage(
  client: PoolClient,
  context: CommandContext,
  campaignId: string,
  value: ActionPackageInput,
  expiresAt: string
): Promise<ActionPackage> {
  const action = canonicalActionPackage(value);
  const payloadHash = hashCanonicalPayload(action);
  const result = await client.query<ActionPackageRow>(`
    insert into marketing_ops.action_packages (
      tenant_id, campaign_id, created_by, action_type, channel, audience_snapshot,
      scheduled_for, time_zone, configuration, success_criteria, risk_summary,
      payload, payload_hash, expires_at
    ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11,
      $12::jsonb, $13, $14)
    returning *
  `, [
    context.actor.tenantId, campaignId, context.actor.userId, action.actionType,
    action.channel, JSON.stringify(action.audienceSnapshot), action.scheduledFor,
    action.timeZone, JSON.stringify(action.configuration), action.successCriteria,
    action.riskSummary, JSON.stringify(action.payload), payloadHash, expiresAt
  ]);
  if (!result.rows[0]) throw new Error('Action package insertion returned no row');
  return mapActionPackage(result.rows[0]);
}
