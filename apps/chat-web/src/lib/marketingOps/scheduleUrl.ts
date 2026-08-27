import type {
  MarketingOpsCampaignChannel,
  MarketingOpsItemKind,
  MarketingOpsItemPriority,
  MarketingOpsItemStatus,
  MarketingOpsProductionScheduleFilters
} from './types';

export type ProductionScheduleUrlFilter = Exclude<
  keyof MarketingOpsProductionScheduleFilters,
  'cursor' | 'limit' | 'from' | 'to'
>;

const urlKeys: ProductionScheduleUrlFilter[] = [
  'campaignId',
  'kind',
  'channel',
  'assigneeId',
  'status',
  'priority'
];
const kinds = new Set<MarketingOpsItemKind>([
  'task', 'email', 'whatsapp', 'post', 'creative', 'review', 'milestone'
]);
const channels = new Set<MarketingOpsCampaignChannel>([
  'email', 'instagram', 'linkedin', 'facebook', 'whatsapp',
  'website', 'paid_media', 'events', 'press', 'other'
]);
const statuses = new Set<MarketingOpsItemStatus>([
  'draft', 'ready', 'in_review', 'completed', 'cancelled'
]);
const priorities = new Set<MarketingOpsItemPriority>(['low', 'normal', 'high', 'urgent']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function productionScheduleFiltersFrom(
  searchParams: URLSearchParams
): MarketingOpsProductionScheduleFilters {
  const filters: MarketingOpsProductionScheduleFilters = { limit: 25 };
  const campaignId = searchParams.get('campaignId');
  const kind = searchParams.get('kind') as MarketingOpsItemKind | null;
  const channel = searchParams.get('channel') as MarketingOpsCampaignChannel | null;
  const assigneeId = searchParams.get('assigneeId');
  const status = searchParams.get('status') as MarketingOpsItemStatus | null;
  const priority = searchParams.get('priority') as MarketingOpsItemPriority | null;

  if (campaignId && uuidPattern.test(campaignId)) filters.campaignId = campaignId;
  if (kind && kinds.has(kind)) filters.kind = kind;
  if (channel && channels.has(channel)) filters.channel = channel;
  if (assigneeId && uuidPattern.test(assigneeId)) filters.assigneeId = assigneeId;
  if (status && statuses.has(status)) filters.status = status;
  if (priority && priorities.has(priority)) filters.priority = priority;
  return filters;
}

export function setProductionScheduleFilter(
  current: URLSearchParams,
  key: ProductionScheduleUrlFilter,
  value?: string
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

export function hasProductionScheduleFilters(searchParams: URLSearchParams): boolean {
  return urlKeys.some((key) => searchParams.has(key));
}
