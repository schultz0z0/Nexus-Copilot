import { AppError, appError } from '../errors.js';
import {
  appendCampaignNote,
  createCampaignDraft,
  updateCampaign
} from '../domain/campaigns.js';
import type { CommandContext } from '../domain/context.js';
import { createProductionItem, updateProductionItem } from '../domain/items.js';
import { createContentAsset, createContentVersion } from '../domain/content.js';
import {
  linkExistingItemArtifact,
  type ItemArtifactCommandContext
} from '../domain/itemArtifacts.js';
import type { ArtifactClient } from '../integrations/artifactClient.js';
import type { MarketingOpsPlanAction } from './contracts.js';
import { submitEditorialApproval, submitOperationalApproval } from '../domain/approvals.js';
import type { MarketingOpsPlan } from './token.js';
import {
  deepLinkForCompletedAction,
  type MarketingOpsDeepLink
} from './deepLinks.js';

export interface PlanExecutorContext extends CommandContext {
  artifacts?: ArtifactClient;
}

export interface PlanExecutorDependencies {
  createCampaignDraft: typeof createCampaignDraft;
  updateCampaign: typeof updateCampaign;
  createProductionItem: typeof createProductionItem;
  updateProductionItem: typeof updateProductionItem;
  createContentAsset: typeof createContentAsset;
  createContentVersion: typeof createContentVersion;
  linkExistingItemArtifact: typeof linkExistingItemArtifact;
  appendCampaignNote: typeof appendCampaignNote;
  submitEditorialApproval: typeof submitEditorialApproval;
  submitOperationalApproval: typeof submitOperationalApproval;
}

const defaultDependencies: PlanExecutorDependencies = {
  createCampaignDraft,
  updateCampaign,
  createProductionItem,
  updateProductionItem,
  createContentAsset,
  createContentVersion,
  linkExistingItemArtifact,
  appendCampaignNote,
  submitEditorialApproval,
  submitOperationalApproval
};

type ActionType = MarketingOpsPlanAction['type'];

export interface MarketingOpsPlanExecutionResult {
  plan_id: string;
  status: 'completed' | 'partial' | 'failed';
  completed: Array<{
    action_index: number;
    action_type: ActionType;
    resource: unknown;
    idempotency_hit: boolean;
  }>;
  failed: Array<{
    action_index: number;
    action_type: ActionType;
    error: { code: string; message: string; status: number };
  }>;
  pending: Array<{
    action_index: number;
    action_type: ActionType;
    reason: 'dependency_failed';
  }>;
  deep_links: MarketingOpsDeepLink[];
}

function mapCampaignPatch(action: Extract<MarketingOpsPlanAction, { type: 'campaign.update' }>) {
  const patch = action.patch;
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.objective !== undefined ? { objective: patch.objective } : {}),
    ...(patch.audience !== undefined ? { audience: patch.audience } : {}),
    ...(patch.starts_on !== undefined ? { startsOn: patch.starts_on } : {}),
    ...(patch.ends_on !== undefined ? { endsOn: patch.ends_on } : {}),
    ...(patch.primary_channel !== undefined ? { primaryChannel: patch.primary_channel } : {}),
    ...(patch.secondary_channels !== undefined
      ? { secondaryChannels: patch.secondary_channels }
      : {}),
    ...(patch.briefing !== undefined ? { briefing: patch.briefing } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {})
  };
}

function failedDependency(
  action: MarketingOpsPlanAction,
  failedRefs: ReadonlySet<string>
): boolean {
  if (action.type === 'campaign_item.create' && action.campaign_ref) {
    return failedRefs.has(`campaign:${action.campaign_ref}`);
  }
  if (action.type === 'content.version_create' && action.asset_ref) {
    return failedRefs.has(`asset:${action.asset_ref}`);
  }
  return false;
}

function safeError(error: unknown) {
  return error instanceof AppError
    ? { code: error.code, message: error.message, status: error.status }
    : { code: 'internal_error', message: 'Internal server error', status: 500 };
}

export async function executeMarketingOpsPlan(
  context: PlanExecutorContext,
  plan: MarketingOpsPlan,
  dependencies: PlanExecutorDependencies = defaultDependencies
): Promise<MarketingOpsPlanExecutionResult> {
  const campaignRefs = new Map<string, string>();
  const assetRefs = new Map<string, string>();
  const failedRefs = new Set<string>();
  const completed: MarketingOpsPlanExecutionResult['completed'] = [];
  const failed: MarketingOpsPlanExecutionResult['failed'] = [];
  const pending: MarketingOpsPlanExecutionResult['pending'] = [];

  for (const [index, action] of plan.actions.entries()) {
    if (failedDependency(action, failedRefs)) {
      pending.push({
        action_index: index,
        action_type: action.type,
        reason: 'dependency_failed'
      });
      continue;
    }

    let idempotencyHit = false;
    const actionContext: PlanExecutorContext = {
      ...context,
      planId: plan.plan_id,
      planActionIndex: index,
      idempotencyTracker: (hit) => { idempotencyHit = hit; }
    };
    const idempotencyKey = `plan:${plan.plan_id}:${index}`;
    try {
      let resource: unknown;
      if (action.type === 'campaign.create_draft') {
        resource = await dependencies.createCampaignDraft(actionContext, {
          name: action.name,
          idempotencyKey,
          ...(action.course_slug ? { courseSlug: action.course_slug } : {})
        });
        campaignRefs.set(action.ref, (resource as { id: string }).id);
      } else if (action.type === 'campaign.update') {
        resource = await dependencies.updateCampaign(
          actionContext,
          action.campaign_id,
          action.expected_version,
          { ...mapCampaignPatch(action), idempotencyKey }
        );
      } else if (action.type === 'campaign_item.create') {
        const campaignId = action.campaign_id ?? campaignRefs.get(action.campaign_ref ?? '');
        if (!campaignId) throw appError('plan_invalid', 400, 'Campaign reference could not be resolved');
        resource = await dependencies.createProductionItem(actionContext, campaignId, {
          kind: action.kind,
          title: action.title,
          idempotencyKey,
          ...(action.assignee_user_id !== undefined
            ? { assigneeUserId: action.assignee_user_id }
            : {}),
          ...(action.priority !== undefined ? { priority: action.priority } : {}),
          ...(action.channel !== undefined ? { channel: action.channel } : {}),
          ...(action.description !== undefined ? { description: action.description } : {}),
          ...(action.starts_at !== undefined ? { startsAt: action.starts_at } : {}),
          ...(action.due_at !== undefined ? { dueAt: action.due_at } : {}),
          ...(action.metadata !== undefined ? { metadata: action.metadata } : {})
        });
      } else if (action.type === 'campaign_item.reschedule') {
        resource = await dependencies.updateProductionItem(
          actionContext,
          action.item_id,
          action.expected_version,
          {
            idempotencyKey,
            ...(action.starts_at !== undefined ? { startsAt: action.starts_at } : {}),
            ...(action.due_at !== undefined ? { dueAt: action.due_at } : {})
          }
        );
      } else if (action.type === 'content.create_draft') {
        resource = await dependencies.createContentAsset(
          actionContext,
          action.item_id,
          action.expected_item_version,
          {
            assetKind: action.asset_kind,
            title: action.title,
            idempotencyKey
          }
        );
        assetRefs.set(action.ref, (resource as { id: string }).id);
      } else if (action.type === 'content.version_create') {
        const assetId = action.asset_id ?? assetRefs.get(action.asset_ref ?? '');
        if (!assetId) throw appError('plan_invalid', 400, 'Content asset reference could not be resolved');
        resource = await dependencies.createContentVersion(
          actionContext,
          assetId,
          action.expected_asset_version,
          {
            body: action.body,
            metadata: action.metadata,
            freeze: action.freeze,
            idempotencyKey
          }
        );
      } else if (action.type === 'artifact.link_existing') {
        if (!actionContext.artifacts) {
          throw appError('dependency_unavailable', 503, 'Artifact service is unavailable');
        }
        resource = await dependencies.linkExistingItemArtifact(
          actionContext as ItemArtifactCommandContext,
          action.item_id,
          action.expected_item_version,
          {
            artifactId: action.artifact_id,
            ...(action.asset_id ? { assetId: action.asset_id } : {})
          },
          idempotencyKey
        );
      } else if (action.type === 'campaign.note_add') {
        resource = await dependencies.appendCampaignNote(
          actionContext,
          action.campaign_id,
          action.expected_version,
          action.note,
          idempotencyKey
        );
      } else if (action.type === 'approval.submit_editorial') {
        resource = await dependencies.submitEditorialApproval(actionContext, {
          campaignId: action.campaign_id,
          assetId: action.asset_id,
          versionNumber: action.version_number,
          reason: action.reason,
          expiresAt: action.expires_at,
          idempotencyKey
        });
      } else if (action.type === 'approval.submit_operational') {
        resource = await dependencies.submitOperationalApproval(actionContext, {
          campaignId: action.campaign_id,
          actionPackage: action.action_package,
          reason: action.reason,
          expiresAt: action.expires_at,
          idempotencyKey
        });
      } else {
        throw appError('plan_invalid', 400, 'Unsupported plan action');
      }
      completed.push({
        action_index: index,
        action_type: action.type,
        resource,
        idempotency_hit: idempotencyHit
      });
    } catch (error) {
      if (action.type === 'campaign.create_draft') failedRefs.add(`campaign:${action.ref}`);
      if (action.type === 'content.create_draft') failedRefs.add(`asset:${action.ref}`);
      failed.push({ action_index: index, action_type: action.type, error: safeError(error) });
    }
  }

  const status = failed.length === 0 && pending.length === 0
    ? 'completed'
    : completed.length === 0
      ? 'failed'
      : 'partial';
  const deepLinks = new Map<string, MarketingOpsDeepLink>();
  for (const entry of completed) {
    const link = deepLinkForCompletedAction(entry.action_type, entry.resource);
    if (link) deepLinks.set(`${link.resource_type}:${link.resource_id}`, link);
  }
  return {
    plan_id: plan.plan_id,
    status,
    completed,
    failed,
    pending,
    deep_links: [...deepLinks.values()]
  };
}
