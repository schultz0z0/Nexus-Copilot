import type {
  MarketingOpsCampaignFilters,
  MarketingOpsNotificationFilters,
  MarketingOpsProductionScheduleFilters,
  MarketingOpsParticipantCandidateFilters,
  MarketingOpsTimelineFilters,
  MarketingOpsApprovalFilters
} from './types';

export const marketingOpsKeys = {
  all: ['marketing-ops'] as const,
  campaigns: (filters?: MarketingOpsCampaignFilters) => filters === undefined
    ? ['marketing-ops', 'campaigns'] as const
    : ['marketing-ops', 'campaigns', { ...filters }] as const,
  campaign: (campaignId: string) => ['marketing-ops', 'campaign', campaignId] as const,
  participants: (campaignId: string) =>
    ['marketing-ops', 'campaign', campaignId, 'participants'] as const,
  participantCandidates: (
    campaignId: string,
    filters: MarketingOpsParticipantCandidateFilters = {}
  ) => ['marketing-ops', 'campaign', campaignId, 'participant-candidates', { ...filters }] as const,
  materials: (campaignId: string) =>
    ['marketing-ops', 'campaign', campaignId, 'materials'] as const,
  timeline: (campaignId: string, filters?: MarketingOpsTimelineFilters) => filters === undefined
    ? ['marketing-ops', 'campaign', campaignId, 'timeline'] as const
    : ['marketing-ops', 'campaign', campaignId, 'timeline', { ...filters }] as const,
  courseReferences: (query: string, limit = 10) =>
    ['marketing-ops', 'references', 'courses', query, limit] as const,
  productionSchedule: (filters: MarketingOpsProductionScheduleFilters = {}) =>
    ['marketing-ops', 'production', 'schedule', { ...filters }] as const,
  productionItem: (itemId: string) =>
    ['marketing-ops', 'production', 'item', itemId] as const,
  productionItemDependencies: (itemId: string) =>
    ['marketing-ops', 'production', 'item', itemId, 'dependencies'] as const,
  contentAssets: (itemId: string) =>
    ['marketing-ops', 'production', 'item', itemId, 'content-assets'] as const,
  contentVersions: (assetId: string) =>
    ['marketing-ops', 'production', 'content-asset', assetId, 'versions'] as const,
  productionItemArtifacts: (itemId: string) =>
    ['marketing-ops', 'production', 'item', itemId, 'artifacts'] as const,
  notifications: (filters: MarketingOpsNotificationFilters = {}) =>
    ['marketing-ops', 'notifications', { ...filters }] as const,
  approvals: (filters: MarketingOpsApprovalFilters = {}) =>
    ['marketing-ops', 'approvals', { ...filters }] as const,
  approval: (requestId: string) =>
    ['marketing-ops', 'approval', requestId] as const
};
