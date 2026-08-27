import type { PoolClient } from 'pg';
import { z } from 'zod';
import type { ActorRole } from '../auth/actor.js';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import {
  ActionPackageInputSchema,
  insertActionPackage,
  mapActionPackage,
  type ActionPackage,
  type ActionPackageInput
} from './actionPackages.js';
import { writeAudit } from './audit.js';
import { expireApprovalRequestsBatch } from './approvalExpiryWorker.js';
import type { CommandContext } from './context.js';
import { writeDomainEvent } from './events.js';
import { executeIdempotentCommand } from './idempotency.js';

export const ApprovalKindSchema = z.enum(['editorial', 'operational']);
export const ApprovalStatusSchema = z.enum([
  'pending', 'approved', 'rejected', 'changes_requested', 'cancelled', 'expired'
]);
export const ApprovalRiskSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;
export type ApprovalRisk = z.infer<typeof ApprovalRiskSchema>;

const uuid = z.string().uuid();
const expiresAt = z.string().datetime({ offset: true });
const submissionFields = {
  campaignId: uuid,
  reason: z.string().trim().min(1).max(4000),
  riskLevel: ApprovalRiskSchema.optional().default('low'),
  expiresAt,
  supersedesRequestId: uuid.optional()
};

export const EditorialApprovalInputSchema = z.object({
  ...submissionFields,
  assetId: uuid,
  versionNumber: z.number().int().positive()
}).strict();

export const OperationalApprovalInputSchema = z.object({
  ...submissionFields,
  actionPackage: ActionPackageInputSchema
}).strict();

const approvalDecisionFields = {
  decision: z.enum(['approved', 'rejected', 'changes_requested']),
  comment: z.string().trim().max(4000).optional()
};

const validateDecisionComment = (
  value: { decision: 'approved' | 'rejected' | 'changes_requested'; comment?: string | undefined },
  context: z.RefinementCtx
) => {
  if (value.decision !== 'approved' && !value.comment) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['comment'],
      message: 'A comment is required for rejection or requested changes'
    });
  }
};

export const ApprovalDecisionInputSchema = z.object(approvalDecisionFields)
  .strict().superRefine(validateDecisionComment);

const idempotencyKey = z.string().trim().min(1).max(200);
export const EditorialApprovalCommandSchema = EditorialApprovalInputSchema.extend({ idempotencyKey });
export const OperationalApprovalCommandSchema = OperationalApprovalInputSchema.extend({ idempotencyKey });
export const ApprovalDecisionCommandSchema = z.object({
  ...approvalDecisionFields,
  idempotencyKey
}).strict().superRefine(validateDecisionComment);

export const ApprovalListFiltersSchema = z.object({
  status: ApprovalStatusSchema.optional(),
  kind: ApprovalKindSchema.optional(),
  riskLevel: ApprovalRiskSchema.optional(),
  campaignId: uuid.optional(),
  requestedBy: uuid.optional(),
  expiresBefore: expiresAt.optional(),
  expiresAfter: expiresAt.optional(),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.number().int().min(1).max(100).optional().default(25)
}).strict();

export type EditorialApprovalInput = z.input<typeof EditorialApprovalCommandSchema>;
export type OperationalApprovalInput = z.input<typeof OperationalApprovalCommandSchema>;
export type ApprovalDecisionInput = z.input<typeof ApprovalDecisionCommandSchema>;
export type ApprovalListFilters = z.input<typeof ApprovalListFiltersSchema>;

export interface ApprovalCursor {
  createdAt: string;
  id: string;
}

const ApprovalCursorSchema = z.object({ createdAt: expiresAt, id: uuid }).strict();

export function encodeApprovalCursor(cursor: ApprovalCursor): string {
  return Buffer.from(JSON.stringify(ApprovalCursorSchema.parse(cursor))).toString('base64url');
}

export function decodeApprovalCursor(cursor: string | undefined): ApprovalCursor | null {
  if (!cursor) return null;
  try {
    return ApprovalCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    );
  } catch {
    throw appError('validation_error', 400, 'Approval cursor is invalid');
  }
}

export interface ApprovalDecision {
  id: string;
  requestId: string;
  decision: Exclude<ApprovalStatus, 'pending'>;
  decidedBy: string | null;
  deciderRole: ActorRole | null;
  origin: 'human' | 'system';
  comment: string | null;
  eligibilitySnapshot: Record<string, unknown>;
  correlationId: string;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  campaignId: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  requestedBy: string;
  reason: string;
  riskLevel: ApprovalRisk;
  contentAssetId: string | null;
  contentVersionNumber: number | null;
  actionPackageId: string | null;
  targetHash: string;
  supersedesRequestId: string | null;
  expiresAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  decision: ApprovalDecision | null;
  actionPackage: ActionPackage | null;
  editorialTarget: {
    assetKind: string;
    title: string;
    body: string | null;
    metadata: Record<string, unknown>;
    frozenAt: string;
  } | null;
  capabilities: {
    decide: boolean;
    cancel: boolean;
  };
}

export interface ApprovalRequestPage {
  data: ApprovalRequest[];
  nextCursor: string | null;
}

interface ApprovalRow {
  id: string;
  campaign_id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  requested_by: string;
  reason: string;
  risk_level: ApprovalRisk;
  content_asset_id: string | null;
  content_version_number: number | null;
  action_package_id: string | null;
  target_hash: string;
  supersedes_request_id: string | null;
  expires_at: Date | string;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  actual_hash?: string | null;
}

interface DecisionRow {
  id: string;
  request_id: string;
  decision: Exclude<ApprovalStatus, 'pending'>;
  decided_by: string | null;
  decider_role: ActorRole | null;
  decision_origin: 'human' | 'system';
  comment: string | null;
  eligibility_snapshot: Record<string, unknown>;
  correlation_id: string;
  created_at: Date | string;
}

interface ActionPackageDbRow {
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
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EditorialTargetRow {
  asset_kind: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  frozen_at: Date | string;
}

const iso = (value: Date | string) => new Date(value).toISOString();

function mapDecision(row: DecisionRow | undefined): ApprovalDecision | null {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    decision: row.decision,
    decidedBy: row.decided_by,
    deciderRole: row.decider_role,
    origin: row.decision_origin ?? 'human',
    comment: row.comment,
    eligibilitySnapshot: row.eligibility_snapshot,
    correlationId: row.correlation_id,
    createdAt: iso(row.created_at)
  };
}

function capabilities(context: CommandContext, row: ApprovalRow) {
  const pending = row.status === 'pending' && new Date(row.expires_at).getTime() > Date.now();
  return {
    decide: pending && (context.actor.role === 'manager' || context.actor.role === 'admin') &&
      (row.kind === 'editorial' || row.requested_by !== context.actor.userId),
    cancel: pending && row.requested_by === context.actor.userId
  };
}

function mapRequest(
  context: CommandContext,
  row: ApprovalRow,
  decision?: DecisionRow,
  actionPackage?: ActionPackageDbRow,
  editorialTarget?: EditorialTargetRow
): ApprovalRequest {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    kind: row.kind,
    status: row.status,
    requestedBy: row.requested_by,
    reason: row.reason,
    riskLevel: row.risk_level,
    contentAssetId: row.content_asset_id,
    contentVersionNumber: row.content_version_number,
    actionPackageId: row.action_package_id,
    targetHash: row.target_hash,
    supersedesRequestId: row.supersedes_request_id,
    expiresAt: iso(row.expires_at),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    decision: mapDecision(decision),
    actionPackage: actionPackage ? mapActionPackage(actionPackage) : null,
    editorialTarget: editorialTarget ? {
      assetKind: editorialTarget.asset_kind,
      title: editorialTarget.title,
      body: editorialTarget.body,
      metadata: editorialTarget.metadata,
      frozenAt: iso(editorialTarget.frozen_at)
    } : null,
    capabilities: capabilities(context, row)
  };
}

function requireFutureExpiration(value: string, now = new Date()): void {
  if (new Date(value).getTime() <= now.getTime()) {
    throw appError('validation_error', 400, 'Approval expiration must be in the future');
  }
}

export function assertApprovalDecisionEligible(input: {
  actorRole: ActorRole;
  actorUserId: string;
  requestedBy: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
}): void {
  if (input.actorRole !== 'manager' && input.actorRole !== 'admin') {
    throw appError('forbidden', 403, 'Only a manager or admin can decide approval requests');
  }
  if (input.status !== 'pending') {
    throw appError('approval_conflict', 409, 'Approval request already has a terminal status');
  }
  if (input.kind === 'operational' && input.actorUserId === input.requestedBy) {
    throw appError('self_approval_forbidden', 403, 'Operational approval requires a different approver');
  }
}

export function assertApprovalTargetCurrent(input: {
  status: ApprovalStatus;
  expiresAt: string;
  expectedHash: string;
  actualHash: string | null;
}, now = new Date()): void {
  if (input.status !== 'pending') {
    throw appError('approval_conflict', 409, 'Approval request already has a terminal status');
  }
  if (new Date(input.expiresAt).getTime() <= now.getTime()) {
    throw appError('approval_expired', 409, 'Approval request has expired');
  }
  if (!input.actualHash || input.expectedHash !== input.actualHash) {
    throw appError('approval_target_changed', 409, 'The frozen approval target no longer matches');
  }
}

export function assertValidApprovalSupersession(input: {
  predecessor: Pick<ApprovalRow, 'campaign_id' | 'kind' | 'requested_by' | 'status' | 'target_hash'>;
  campaignId: string;
  kind: ApprovalKind;
  requestedBy: string;
  targetHash: string;
}): void {
  const predecessor = input.predecessor;
  if (predecessor.campaign_id !== input.campaignId || predecessor.kind !== input.kind ||
      predecessor.requested_by !== input.requestedBy || predecessor.status !== 'changes_requested' ||
      predecessor.target_hash === input.targetHash) {
    throw appError('invalid_supersession', 422,
      'Superseded approval must be a changed target from the same campaign, kind and requester');
  }
}

async function notifyReviewers(client: PoolClient, context: CommandContext, request: ApprovalRequest) {
  await client.query(`
    insert into marketing_ops.in_app_notifications (
      tenant_id, user_id, event_key, notification_type, campaign_id,
      item_id, approval_request_id, label, payload, occurred_at
    )
    select $1, membership.user_id, 'approval-review:' || $2::text,
      'approval_review', $3, null, $2::uuid, 'Aprovação aguardando decisão',
      jsonb_build_object('campaignId', $3::uuid, 'approvalRequestId', $2::uuid), now()
    from marketing_ops.memberships as membership
    where membership.tenant_id = $1 and membership.active
      and membership.role in ('manager', 'admin')
      and ($4::marketing_ops.approval_kind = 'editorial' or membership.user_id <> $5::uuid)
  `, [context.actor.tenantId, request.id, request.campaignId, request.kind, request.requestedBy]);
}

async function notifyRequester(
  client: PoolClient,
  context: CommandContext,
  request: ApprovalRequest,
  status: ApprovalStatus
) {
  await client.query(`
    insert into marketing_ops.in_app_notifications (
      tenant_id, user_id, event_key, notification_type, campaign_id,
      item_id, approval_request_id, label, payload, occurred_at
    ) values ($1, $2, 'approval-status:' || $3::text || ':' || $4,
      'approval_status', $5, null, $3::uuid, 'Solicitação de aprovação atualizada',
      jsonb_build_object('campaignId', $5::uuid, 'approvalRequestId', $3::uuid,
        'status', $4::text), now())
  `, [context.actor.tenantId, request.requestedBy, request.id, status, request.campaignId]);
}

async function insertRequest(
  client: PoolClient,
  context: CommandContext,
  input: {
    campaignId: string;
    kind: ApprovalKind;
    reason: string;
    riskLevel: ApprovalRisk;
    expiresAt: string;
    targetHash: string;
    contentAssetId?: string;
    contentVersionNumber?: number;
    actionPackageId?: string;
    supersedesRequestId?: string;
  }
): Promise<ApprovalRequest> {
  if (input.supersedesRequestId) {
    const predecessor = await client.query<ApprovalRow>(`
      select * from marketing_ops.approval_requests
      where id = $1
      for update
    `, [input.supersedesRequestId]);
    if (!predecessor.rows[0]) {
      throw appError('not_found', 404, 'Superseded approval request not found');
    }
    assertValidApprovalSupersession({
      predecessor: predecessor.rows[0],
      campaignId: input.campaignId,
      kind: input.kind,
      requestedBy: context.actor.userId,
      targetHash: input.targetHash
    });
  }
  const result = await client.query<ApprovalRow>(`
    insert into marketing_ops.approval_requests (
      tenant_id, campaign_id, kind, requested_by, reason, risk_level,
      content_asset_id, content_version_number, action_package_id, target_hash,
      supersedes_request_id, expires_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    returning *
  `, [
    context.actor.tenantId, input.campaignId, input.kind, context.actor.userId,
    input.reason, input.riskLevel, input.contentAssetId ?? null,
    input.contentVersionNumber ?? null, input.actionPackageId ?? null,
    input.targetHash, input.supersedesRequestId ?? null, input.expiresAt
  ]);
  if (!result.rows[0]) throw new Error('Approval request insertion returned no row');
  return mapRequest(context, result.rows[0]);
}

async function recordRequested(
  client: PoolClient,
  context: CommandContext,
  request: ApprovalRequest
) {
  await writeAudit(client, context, 'approval_request', request.id, 'approval.requested', null, {
    requestId: request.id,
    campaignId: request.campaignId,
    kind: request.kind,
    status: request.status,
    riskLevel: request.riskLevel,
    contentAssetId: request.contentAssetId,
    contentVersionNumber: request.contentVersionNumber,
    actionPackageId: request.actionPackageId,
    targetHash: request.targetHash,
    expiresAt: request.expiresAt
  });
  await writeDomainEvent(
    client, context, 'approval_request', request.id,
    'marketing_ops.approval.requested.v1',
    { requestId: request.id, campaignId: request.campaignId, kind: request.kind,
      riskLevel: request.riskLevel, expiresAt: request.expiresAt }
  );
  await notifyReviewers(client, context, request);
}

export async function submitEditorialApproval(
  context: CommandContext,
  input: EditorialApprovalInput
): Promise<ApprovalRequest> {
  authorize(context.actor, 'approval.submit');
  const parsed = EditorialApprovalCommandSchema.parse(input);
  requireFutureExpiration(parsed.expiresAt);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    return executeIdempotentCommand(
      client, context, `approval.submit_editorial:${parsed.assetId}`,
      input.idempotencyKey, parsed, async () => {
        const target = await client.query<{
          campaign_id: string;
          content_hash: string;
          frozen_at: Date | string | null;
          allowed: boolean;
        }>(`
          select asset.campaign_id, version.content_hash, version.frozen_at,
            marketing_ops_private.can_edit_campaign(asset.campaign_id) as allowed
          from marketing_ops.content_versions as version
          join marketing_ops.content_assets as asset
            on asset.tenant_id = version.tenant_id and asset.id = version.asset_id
          where version.asset_id = $1 and version.version_number = $2
            and asset.campaign_id = $3
        `, [parsed.assetId, parsed.versionNumber, parsed.campaignId]);
        const row = target.rows[0];
        if (!row) throw appError('not_found', 404, 'Frozen content version not found');
        if (!row.allowed) throw appError('forbidden', 403, 'Campaign does not grant approval authority');
        if (!row.frozen_at) throw appError('content_not_frozen', 422, 'Content version must be frozen');
        const request = await insertRequest(client, context, {
          campaignId: parsed.campaignId,
          kind: 'editorial',
          reason: parsed.reason,
          riskLevel: parsed.riskLevel,
          expiresAt: parsed.expiresAt,
          targetHash: row.content_hash,
          contentAssetId: parsed.assetId,
          contentVersionNumber: parsed.versionNumber,
          ...(parsed.supersedesRequestId ? { supersedesRequestId: parsed.supersedesRequestId } : {})
        });
        await recordRequested(client, context, request);
        return request;
      }
    );
  });
}

export async function submitOperationalApproval(
  context: CommandContext,
  input: OperationalApprovalInput
): Promise<ApprovalRequest> {
  authorize(context.actor, 'approval.submit');
  const parsed = OperationalApprovalCommandSchema.parse(input);
  requireFutureExpiration(parsed.expiresAt);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    return executeIdempotentCommand(
      client, context, `approval.submit_operational:${parsed.campaignId}`,
      input.idempotencyKey, parsed, async () => {
        const access = await client.query<{ allowed: boolean }>(`
          select marketing_ops_private.can_edit_campaign(id) as allowed
          from marketing_ops.campaigns where id = $1
        `, [parsed.campaignId]);
        if (!access.rows[0]) throw appError('not_found', 404, 'Campaign not found');
        if (!access.rows[0].allowed) throw appError('forbidden', 403, 'Campaign does not grant approval authority');
        const actionPackage = await insertActionPackage(
          client, context, parsed.campaignId, parsed.actionPackage as ActionPackageInput,
          parsed.expiresAt
        );
        const request = await insertRequest(client, context, {
          campaignId: parsed.campaignId,
          kind: 'operational',
          reason: parsed.reason,
          riskLevel: parsed.riskLevel,
          expiresAt: parsed.expiresAt,
          targetHash: actionPackage.payloadHash,
          actionPackageId: actionPackage.id,
          ...(parsed.supersedesRequestId ? { supersedesRequestId: parsed.supersedesRequestId } : {})
        });
        await recordRequested(client, context, request);
        return { ...request, actionPackage };
      }
    );
  });
}

async function loadRequestForUpdate(client: PoolClient, requestId: string): Promise<ApprovalRow> {
  const result = await client.query<ApprovalRow>(`
    select request.*,
      case when request.kind = 'editorial'
        then version.content_hash else package.payload_hash end as actual_hash
    from marketing_ops.approval_requests as request
    left join marketing_ops.content_versions as version
      on version.tenant_id = request.tenant_id
      and version.asset_id = request.content_asset_id
      and version.version_number = request.content_version_number
    left join marketing_ops.action_packages as package
      on package.tenant_id = request.tenant_id and package.id = request.action_package_id
    where request.id = $1
    for update of request
  `, [requestId]);
  if (!result.rows[0]) throw appError('not_found', 404, 'Approval request not found');
  return result.rows[0];
}

export async function decideApprovalRequest(
  context: CommandContext,
  requestId: string,
  expectedVersion: number,
  input: ApprovalDecisionInput,
  now = new Date()
): Promise<ApprovalRequest> {
  authorize(context.actor, 'approval.decide');
  const parsed = ApprovalDecisionCommandSchema.parse(input);
  const expiration = await expireApprovalRequestsBatch(context.pool, {
    now,
    limit: 1,
    tenantId: context.actor.tenantId,
    requestId
  });
  if (expiration.expired > 0) {
    throw appError('approval_expired', 409, 'Approval request has expired');
  }
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    return executeIdempotentCommand(
      client, context, `approval.decide:${requestId}`, input.idempotencyKey,
      { requestId, expectedVersion, ...parsed }, async () => {
        const row = await loadRequestForUpdate(client, requestId);
        if (Number(row.version) !== expectedVersion) {
          throw appError('version_conflict', 409, 'Approval request version is stale', {
            currentVersion: Number(row.version)
          });
        }
        assertApprovalDecisionEligible({
          actorRole: context.actor.role,
          actorUserId: context.actor.userId,
          requestedBy: row.requested_by,
          kind: row.kind,
          status: row.status
        });
        assertApprovalTargetCurrent({
          status: row.status,
          expiresAt: iso(row.expires_at),
          expectedHash: row.target_hash,
          actualHash: row.actual_hash ?? null
        }, now);
        const decision = await client.query<DecisionRow>(`
          insert into marketing_ops.approval_decisions (
            tenant_id, request_id, decision, decided_by, decider_role,
            comment, eligibility_snapshot, correlation_id
          ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
          returning *
        `, [
          context.actor.tenantId, requestId, parsed.decision, context.actor.userId,
          context.actor.role, parsed.comment ?? null,
          JSON.stringify({ role: context.actor.role, separationOfDuties:
            row.kind === 'operational' ? row.requested_by !== context.actor.userId : true }),
          context.correlationId
        ]);
        const updated = await client.query<ApprovalRow>(`
          update marketing_ops.approval_requests
          set status = $2, version = version + 1
          where id = $1 and status = 'pending' and version = $3
          returning *
        `, [requestId, parsed.decision, expectedVersion]);
        if (!updated.rows[0]) throw appError('approval_conflict', 409, 'Approval request was decided concurrently');
        let updatedPackage: ActionPackageDbRow | undefined;
        if (row.kind === 'operational' && row.action_package_id) {
          if (parsed.decision === 'approved') {
            const packageResult = await client.query<ActionPackageDbRow>(`
              update marketing_ops.action_packages
              set status = 'authorized', authorized_by_request_id = $2,
                authorized_at = $3, version = version + 1
              where id = $1 and status = 'pending_approval' and payload_hash = $4
              returning *
            `, [row.action_package_id, requestId, now.toISOString(), row.target_hash]);
            updatedPackage = packageResult.rows[0];
            if (!updatedPackage) {
              throw appError('approval_target_changed', 409, 'Operational package could not be authorized');
            }
            await writeDomainEvent(client, context, 'action_package', row.action_package_id,
              'marketing_ops.action_package.authorized.v1',
              { requestId, actionPackageId: row.action_package_id, payloadHash: row.target_hash });
          } else {
            const packageResult = await client.query<ActionPackageDbRow>(`
              update marketing_ops.action_packages
              set status = 'invalidated', invalidated_at = $2,
                invalidation_reason = $3, version = version + 1
              where id = $1 and status = 'pending_approval'
              returning *
            `, [row.action_package_id, now.toISOString(), `approval_${parsed.decision}`]);
            updatedPackage = packageResult.rows[0];
            if (!updatedPackage) {
              throw appError('approval_target_changed', 409, 'Operational package could not be invalidated');
            }
            await writeDomainEvent(client, context, 'action_package', row.action_package_id,
              'marketing_ops.action_package.invalidated.v1',
              { requestId, actionPackageId: row.action_package_id, reason: parsed.decision });
          }
        }
        const request = mapRequest(context, updated.rows[0], decision.rows[0], updatedPackage);
        await writeAudit(client, context, 'approval_request', requestId,
          `approval.${parsed.decision}`, { status: row.status, version: Number(row.version) },
          { status: parsed.decision, version: request.version, comment: parsed.comment ?? null });
        await writeDomainEvent(client, context, 'approval_request', requestId,
          `marketing_ops.approval.${parsed.decision}.v1`,
          { requestId, campaignId: row.campaign_id, kind: row.kind, status: parsed.decision });
        await notifyRequester(client, context, request, parsed.decision);
        return request;
      }
    );
  }).catch((error: unknown) => {
    const db = error as { constraint?: string };
    if (db.constraint === 'approval_decisions_request_id_key') {
      throw appError('approval_conflict', 409, 'Approval request was decided concurrently');
    }
    throw error;
  });
}

export async function cancelApprovalRequest(
  context: CommandContext,
  requestId: string,
  expectedVersion: number,
  idempotencyKey: string,
  now = new Date()
): Promise<ApprovalRequest> {
  authorize(context.actor, 'approval.submit');
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    return executeIdempotentCommand(
      client, context, `approval.cancel:${requestId}`, idempotencyKey,
      { requestId, expectedVersion }, async () => {
        const row = await loadRequestForUpdate(client, requestId);
        if (row.requested_by !== context.actor.userId) {
          throw appError('forbidden', 403, 'Only the requester can cancel this approval');
        }
        if (row.status !== 'pending') throw appError('approval_conflict', 409, 'Approval is already terminal');
        if (Number(row.version) !== expectedVersion) {
          throw appError('version_conflict', 409, 'Approval request version is stale', {
            currentVersion: Number(row.version)
          });
        }
        const decision = await client.query<DecisionRow>(`
          insert into marketing_ops.approval_decisions (
            tenant_id, request_id, decision, decided_by, decider_role,
            comment, eligibility_snapshot, correlation_id
          ) values ($1, $2, 'cancelled', $3, $4, null, $5::jsonb, $6)
          returning *
        `, [context.actor.tenantId, requestId, context.actor.userId, context.actor.role,
          JSON.stringify({ requester: true }), context.correlationId]);
        const updated = await client.query<ApprovalRow>(`
          update marketing_ops.approval_requests set status = 'cancelled', version = version + 1
          where id = $1 and status = 'pending' and version = $2 returning *
        `, [requestId, expectedVersion]);
        if (!updated.rows[0]) throw appError('approval_conflict', 409, 'Approval was changed concurrently');
        let updatedPackage: ActionPackageDbRow | undefined;
        if (row.action_package_id) {
          const packageResult = await client.query<ActionPackageDbRow>(`
            update marketing_ops.action_packages
            set status = 'invalidated', invalidated_at = $2,
              invalidation_reason = 'approval_cancelled', version = version + 1
            where id = $1 and status = 'pending_approval'
            returning *
          `, [row.action_package_id, now.toISOString()]);
          updatedPackage = packageResult.rows[0];
          if (!updatedPackage) {
            throw appError('approval_target_changed', 409, 'Operational package could not be cancelled');
          }
        }
        const request = mapRequest(context, updated.rows[0], decision.rows[0], updatedPackage);
        await writeAudit(client, context, 'approval_request', requestId, 'approval.cancelled',
          { status: row.status }, { status: 'cancelled' });
        await writeDomainEvent(client, context, 'approval_request', requestId,
          'marketing_ops.approval.cancelled.v1',
          { requestId, campaignId: row.campaign_id, kind: row.kind, status: 'cancelled' });
        await notifyRequester(client, context, request, 'cancelled');
        return request;
      }
    );
  });
}

export async function listApprovalRequests(
  context: CommandContext,
  input: ApprovalListFilters = {}
): Promise<ApprovalRequestPage> {
  authorize(context.actor, 'approval.read');
  const filters = ApprovalListFiltersSchema.parse(input);
  const cursor = decodeApprovalCursor(filters.cursor);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const result = await client.query<ApprovalRow>(`
      select request.*
      from marketing_ops.approval_requests as request
      where ($1::marketing_ops.approval_status is null or request.status = $1)
        and ($2::marketing_ops.approval_kind is null or request.kind = $2)
        and ($3::marketing_ops.approval_risk is null or request.risk_level = $3)
        and ($4::uuid is null or request.campaign_id = $4)
        and ($5::uuid is null or request.requested_by = $5)
        and ($6::timestamptz is null or request.expires_at <= $6)
        and ($7::timestamptz is null or request.expires_at >= $7)
        and ($8::timestamptz is null or (request.created_at, request.id) < ($8, $9::uuid))
      order by request.created_at desc, request.id desc
      limit $10
    `, [
      filters.status ?? null, filters.kind ?? null, filters.riskLevel ?? null,
      filters.campaignId ?? null, filters.requestedBy ?? null,
      filters.expiresBefore ?? null, filters.expiresAfter ?? null,
      cursor?.createdAt ?? null, cursor?.id ?? null, filters.limit + 1
    ]);
    const hasNext = result.rows.length > filters.limit;
    const data = result.rows.slice(0, filters.limit).map((row) => mapRequest(context, row));
    const last = data.at(-1);
    return {
      data,
      nextCursor: hasNext && last ? encodeApprovalCursor({ createdAt: last.createdAt, id: last.id }) : null
    };
  });
}

export async function getApprovalRequest(
  context: CommandContext,
  requestId: string
): Promise<ApprovalRequest> {
  authorize(context.actor, 'approval.read');
  const id = uuid.parse(requestId);
  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const request = await client.query<ApprovalRow>(
      'select * from marketing_ops.approval_requests where id = $1', [id]
    );
    const row = request.rows[0];
    if (!row) throw appError('not_found', 404, 'Approval request not found');
    const decision = await client.query<DecisionRow>(
      'select * from marketing_ops.approval_decisions where request_id = $1', [id]
    );
    const actionPackage = row.action_package_id
      ? await client.query<ActionPackageDbRow>(
        'select * from marketing_ops.action_packages where id = $1', [row.action_package_id]
      )
      : null;
    const editorialTarget = row.kind === 'editorial'
      ? await client.query<EditorialTargetRow>(`
        select asset.asset_kind, asset.title, version.body, version.metadata, version.frozen_at
        from marketing_ops.content_assets as asset
        join marketing_ops.content_versions as version
          on version.tenant_id = asset.tenant_id and version.asset_id = asset.id
        where asset.id = $1 and version.version_number = $2 and version.frozen_at is not null
      `, [row.content_asset_id, row.content_version_number])
      : null;
    return mapRequest(context, row, decision.rows[0], actionPackage?.rows[0], editorialTarget?.rows[0]);
  });
}
