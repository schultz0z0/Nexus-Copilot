import { z } from 'zod/v4';
import type { MarketingOpsPlanAction } from './contracts.js';

const uuid = z.string().uuid();

export interface MarketingOpsDeepLink {
  resource_type: 'campaign' | 'campaign_item' | 'content_asset' | 'approval_request';
  resource_id: string;
  label: string;
  href: string;
  open_in: 'campaign_workspace' | 'campaign_item' | 'content_asset' | 'approval_request';
}

export function campaignDeepLink(campaignId: string): MarketingOpsDeepLink {
  const id = uuid.parse(campaignId);
  return {
    resource_type: 'campaign',
    resource_id: id,
    label: 'Abrir campanha',
    href: `/marketing-ops/campaigns/${id}`,
    open_in: 'campaign_workspace'
  };
}

export function itemDeepLink(itemId: string): MarketingOpsDeepLink {
  const id = uuid.parse(itemId);
  return {
    resource_type: 'campaign_item',
    resource_id: id,
    label: 'Abrir item',
    href: `/marketing-ops/production/items/${id}`,
    open_in: 'campaign_item'
  };
}

export function contentDeepLink(itemId: string, assetId: string): MarketingOpsDeepLink {
  const parsedItemId = uuid.parse(itemId);
  const parsedAssetId = uuid.parse(assetId);
  return {
    resource_type: 'content_asset',
    resource_id: parsedAssetId,
    label: 'Abrir conteúdo',
    href: `/marketing-ops/production/items/${parsedItemId}?contentAssetId=${parsedAssetId}`,
    open_in: 'content_asset'
  };
}

export function approvalDeepLink(requestId: string): MarketingOpsDeepLink {
  const id = uuid.parse(requestId);
  return {
    resource_type: 'approval_request',
    resource_id: id,
    label: 'Abrir solicitação de aprovação',
    href: `/marketing-ops/approvals/${id}`,
    open_in: 'approval_request'
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

export function deepLinkForCompletedAction(
  actionType: MarketingOpsPlanAction['type'],
  resource: unknown
): MarketingOpsDeepLink | null {
  const value = object(resource);
  if (!value) return null;
  if (actionType.startsWith('approval.submit_') && typeof value.id === 'string') {
    return approvalDeepLink(value.id);
  }
  if (actionType.startsWith('campaign.') && typeof value.id === 'string') {
    return campaignDeepLink(value.id);
  }
  if (actionType.startsWith('campaign_item.') && typeof value.id === 'string') {
    return itemDeepLink(value.id);
  }
  if (
    actionType === 'content.create_draft' &&
    typeof value.itemId === 'string' &&
    typeof value.id === 'string'
  ) {
    return contentDeepLink(value.itemId, value.id);
  }
  if (
    actionType === 'content.version_create' &&
    typeof value.itemId === 'string' &&
    typeof value.assetId === 'string'
  ) {
    return contentDeepLink(value.itemId, value.assetId);
  }
  if (actionType === 'artifact.link_existing') {
    const artifact = object(value.artifact);
    if (artifact && typeof artifact.itemId === 'string') return itemDeepLink(artifact.itemId);
  }
  return null;
}
