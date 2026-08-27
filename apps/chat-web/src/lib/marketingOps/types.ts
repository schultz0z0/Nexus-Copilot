export type MarketingOpsCampaignStatus = 'draft' | 'planned' | 'active' | 'completed' | 'archived';
export type MarketingOpsTransitionTarget = Exclude<MarketingOpsCampaignStatus, 'archived'>;
export type MarketingOpsReferenceType = 'course' | 'product' | 'initiative';
export type MarketingOpsCampaignChannel =
  | 'email'
  | 'instagram'
  | 'linkedin'
  | 'facebook'
  | 'whatsapp'
  | 'website'
  | 'paid_media'
  | 'events'
  | 'press'
  | 'other';

export interface MarketingOpsCampaignEditableFields {
  name: string;
  objective: string | null;
  referenceType: MarketingOpsReferenceType | null;
  referenceKey: string | null;
  referenceTitleSnapshot: string | null;
  referenceDocumentId: string | null;
  audience: string | null;
  startsOn: string | null;
  endsOn: string | null;
  primaryChannel: MarketingOpsCampaignChannel | null;
  secondaryChannels: MarketingOpsCampaignChannel[];
  briefing: string | null;
  notes: string | null;
}

export interface MarketingOpsCampaign extends MarketingOpsCampaignEditableFields {
  id: string;
  tenantId: string;
  courseSlug: string | null;
  referenceVerifiedAt: string | null;
  status: MarketingOpsCampaignStatus;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type MarketingOpsCampaignAttention =
  | 'missing_primary_owner'
  | 'planned_start_due'
  | 'active_past_end';

export interface MarketingOpsCampaignResponsibleSummary {
  userId: string;
  displayName: string;
  isPrimary: boolean;
}

export interface MarketingOpsCampaignSummary extends MarketingOpsCampaign {
  responsibles: MarketingOpsCampaignResponsibleSummary[];
  attention: MarketingOpsCampaignAttention[];
}

export type MarketingOpsCampaignCreate = Pick<MarketingOpsCampaignEditableFields, 'name'> &
  Partial<Omit<MarketingOpsCampaignEditableFields, 'name'>> & {
    courseSlug?: string;
  };

export type MarketingOpsCampaignPatch = Partial<MarketingOpsCampaignEditableFields>;

export interface MarketingOpsResult<T> {
  data: T;
  correlationId: string | null;
  etag: string | null;
  page?: MarketingOpsPage;
  meta?: MarketingOpsResponseMeta;
}

export interface MarketingOpsResponseMeta {
  timeZone?: string;
}

export interface MarketingOpsPage {
  limit: number;
  count: number;
  nextCursor: string | null;
}

export interface MarketingOpsCampaignFilters {
  q?: string;
  status?: MarketingOpsCampaignStatus;
  referenceType?: MarketingOpsReferenceType;
  referenceKey?: string;
  channel?: MarketingOpsCampaignChannel;
  responsible?: string;
  periodFrom?: string;
  periodTo?: string;
  cursor?: string;
  limit?: number;
  course?: string;
  owner?: string;
  from?: string;
  to?: string;
}

export type MarketingOpsParticipantRole = 'owner' | 'editor' | 'viewer';
export type MarketingOpsTenantRole = 'member' | 'manager' | 'admin';

export interface MarketingOpsParticipant {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  memberRole: MarketingOpsParticipantRole;
  isPrimary: boolean;
}

export interface MarketingOpsParticipantCandidate {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  tenantRole: MarketingOpsTenantRole;
}

export interface MarketingOpsParticipantCreate {
  userId: string;
  memberRole: MarketingOpsParticipantRole;
  isPrimary?: boolean;
}

export interface MarketingOpsParticipantPatch {
  memberRole?: MarketingOpsParticipantRole;
  isPrimary?: boolean;
}

export interface MarketingOpsParticipantMutation {
  participant: MarketingOpsParticipant;
  campaignVersion: number;
}

export interface MarketingOpsParticipantRemoval {
  removedUserId: string;
  campaignVersion: number;
}

export interface MarketingOpsParticipantCandidateFilters {
  q?: string;
  limit?: number;
}

export interface MarketingOpsMaterial {
  id: string;
  campaignId: string;
  artifactId: string;
  artifactOwnerId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  source: 'upload' | 'existing_artifact';
  createdBy: string;
  createdAt: string;
}

export interface MarketingOpsMaterialMutation {
  material: MarketingOpsMaterial;
  campaignVersion: number;
}

export interface MarketingOpsMaterialRemoval {
  materialId: string;
  campaignVersion: number;
}

export interface MarketingOpsMaterialAccessLink {
  url: string;
  expiresAt: string;
}

export interface MarketingOpsTimelineChange {
  field: string;
  kind: 'added' | 'removed' | 'changed';
}

export interface MarketingOpsTimelineEvent {
  id: string;
  action: string;
  occurredAt: string;
  actor: { displayName: string };
  origin: 'rest' | 'mcp' | 'internal';
  changes: MarketingOpsTimelineChange[];
  correlationId: string;
}

export interface MarketingOpsTimelineFilters {
  limit?: number;
  cursor?: string;
}

export interface MarketingOpsCourseReference {
  referenceKey: string;
  title: string;
  documentId: string;
  collection: 'courses';
  category: string | null;
  courseType: string | null;
  offerMetadata: {
    modalities: string[];
    locations: string[];
    statuses: string[];
  };
  verifiedAt: string;
}

export interface MarketingOpsErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    correlationId?: string;
    details?: unknown;
  };
}

export type MarketingOpsItemKind =
  | 'task'
  | 'email'
  | 'whatsapp'
  | 'post'
  | 'creative'
  | 'review'
  | 'milestone';
export type MarketingOpsItemStatus =
  | 'draft'
  | 'ready'
  | 'in_review'
  | 'completed'
  | 'cancelled';
export type MarketingOpsItemPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface MarketingOpsProductionItemEditableFields {
  kind: MarketingOpsItemKind;
  title: string;
  assigneeUserId: string | null;
  priority: MarketingOpsItemPriority;
  channel: MarketingOpsCampaignChannel | null;
  description: string | null;
  startsAt: string | null;
  dueAt: string | null;
  metadata: Record<string, unknown>;
}

export interface MarketingOpsProductionItem
  extends MarketingOpsProductionItemEditableFields {
  id: string;
  tenantId: string;
  campaignId: string;
  content: unknown;
  status: MarketingOpsItemStatus;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface MarketingOpsProductionScheduleItem
  extends MarketingOpsProductionItem {
  campaignName: string;
  effectiveAt: string | null;
  isOverdue: boolean;
  isBlocked: boolean;
}

export type MarketingOpsProductionItemCreate =
  Pick<MarketingOpsProductionItemEditableFields, 'kind' | 'title'> &
  Partial<Omit<MarketingOpsProductionItemEditableFields, 'kind' | 'title'>> & {
    campaignId: string;
  };

export type MarketingOpsProductionItemPatch =
  Partial<MarketingOpsProductionItemEditableFields>;

export interface MarketingOpsProductionScheduleFilters {
  view?: 'list' | 'week' | 'month';
  from?: string;
  to?: string;
  campaignId?: string;
  kind?: MarketingOpsItemKind;
  channel?: MarketingOpsCampaignChannel;
  assigneeId?: string;
  status?: MarketingOpsItemStatus;
  priority?: MarketingOpsItemPriority;
  cursor?: string;
  limit?: number;
}

export interface MarketingOpsItemDependency {
  itemId: string;
  dependsOnItemId: string;
  predecessorTitle: string;
  predecessorStatus: MarketingOpsItemStatus;
  createdBy: string;
  createdAt: string;
  isBlocking: boolean;
}

export interface MarketingOpsItemDependencyMutation
  extends MarketingOpsItemDependency {
  itemVersion: number;
}

export interface MarketingOpsItemDependencyRemoval {
  itemId: string;
  dependsOnItemId: string;
  itemVersion: number;
  removed: true;
}

export interface MarketingOpsContentAssetCreate {
  assetKind: string;
  title: string;
}

export interface MarketingOpsContentAsset {
  id: string;
  itemId: string;
  campaignId: string;
  assetKind: string;
  title: string;
  currentVersionNumber: number;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingOpsContentAssetMutation
  extends MarketingOpsContentAsset {
  itemVersion: number;
}

export interface MarketingOpsContentVersionCreate {
  body: string | null;
  metadata: Record<string, unknown>;
  freeze: boolean;
}

export interface MarketingOpsContentVersion {
  assetId: string;
  versionNumber: number;
  body: string | null;
  metadata: Record<string, unknown>;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  frozenAt: string | null;
}

export interface MarketingOpsContentVersionMutation
  extends MarketingOpsContentVersion {
  assetVersion: number;
}

export interface MarketingOpsItemArtifactLink {
  artifactId: string;
  assetId?: string;
}

export interface MarketingOpsItemArtifact {
  id: string;
  itemId: string;
  campaignId: string;
  assetId: string | null;
  artifactId: string;
  artifactOwnerId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdBy: string;
  createdAt: string;
}

export interface MarketingOpsItemArtifactMutation {
  artifact: MarketingOpsItemArtifact;
  itemVersion: number;
}

export interface MarketingOpsItemArtifactRemoval {
  artifactLinkId: string;
  itemVersion: number;
}

export type MarketingOpsNotificationType =
  | 'assignment' | 'due_soon' | 'overdue' | 'approval_review' | 'approval_status';

export interface MarketingOpsInAppNotification {
  id: string;
  eventKey: string;
  notificationType: MarketingOpsNotificationType;
  campaignId: string;
  itemId: string | null;
  approvalRequestId: string | null;
  label: string;
  payload: Record<string, unknown> & { campaignId: string };
  occurredAt: string;
  readAt: string | null;
  createdAt: string;
}

export interface MarketingOpsNotificationFilters {
  unreadOnly?: boolean;
  cursor?: string;
  limit?: number;
}

export interface MarketingOpsProductionBatchItem {
  itemId: string;
  version: number;
}

export type MarketingOpsProductionBatchAction =
  | { type: 'reassign'; assigneeUserId: string | null }
  | { type: 'priority'; priority: MarketingOpsItemPriority }
  | { type: 'reschedule'; startsAt?: string | null; dueAt?: string | null };

export interface MarketingOpsProductionBatchInput {
  items: MarketingOpsProductionBatchItem[];
  action: MarketingOpsProductionBatchAction;
}

export type MarketingOpsProductionBatchItemResult =
  | { itemId: string; ok: true; item: MarketingOpsProductionItem }
  | {
    itemId: string;
    ok: false;
    error: {
      code: string;
      status: number;
      message: string;
      currentVersion?: number;
    };
  };

export interface MarketingOpsProductionBatchResult {
  results: MarketingOpsProductionBatchItemResult[];
  succeeded: number;
  failed: number;
}

export type MarketingOpsApprovalKind = 'editorial' | 'operational';
export type MarketingOpsApprovalStatus =
  | 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'cancelled' | 'expired';
export type MarketingOpsApprovalRisk = 'low' | 'medium' | 'high' | 'critical';

export interface MarketingOpsCanonicalActionPackageInput {
  actionType: string;
  channel: string;
  audienceSnapshot: Record<string, unknown>;
  scheduledFor?: string | null;
  timeZone: string;
  configuration: Record<string, unknown>;
  successCriteria?: string | null;
  riskSummary?: string | null;
  payload: Record<string, unknown>;
}

export interface MarketingOpsActionPackage extends Required<MarketingOpsCanonicalActionPackageInput> {
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

export interface MarketingOpsApprovalDecision {
  id: string;
  requestId: string;
  decision: Exclude<MarketingOpsApprovalStatus, 'pending'>;
  decidedBy: string | null;
  deciderRole: MarketingOpsTenantRole | null;
  origin: 'human' | 'system';
  comment: string | null;
  eligibilitySnapshot: Record<string, unknown>;
  correlationId: string;
  createdAt: string;
}

export interface MarketingOpsApprovalRequest {
  id: string;
  campaignId: string;
  kind: MarketingOpsApprovalKind;
  status: MarketingOpsApprovalStatus;
  requestedBy: string;
  reason: string;
  riskLevel: MarketingOpsApprovalRisk;
  contentAssetId: string | null;
  contentVersionNumber: number | null;
  actionPackageId: string | null;
  targetHash: string;
  supersedesRequestId: string | null;
  expiresAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  decision: MarketingOpsApprovalDecision | null;
  actionPackage: MarketingOpsActionPackage | null;
  editorialTarget?: {
    assetKind: string;
    title: string;
    body: string | null;
    metadata: Record<string, unknown>;
    frozenAt: string;
  } | null;
  capabilities: { decide: boolean; cancel: boolean };
}

export interface MarketingOpsApprovalFilters {
  status?: MarketingOpsApprovalStatus;
  kind?: MarketingOpsApprovalKind;
  riskLevel?: MarketingOpsApprovalRisk;
  campaignId?: string;
  requestedBy?: string;
  expiresBefore?: string;
  expiresAfter?: string;
  cursor?: string;
  limit?: number;
}

interface MarketingOpsApprovalSubmissionBase {
  campaignId: string;
  reason: string;
  riskLevel?: MarketingOpsApprovalRisk;
  expiresAt: string;
  supersedesRequestId?: string;
}

export interface MarketingOpsEditorialApprovalSubmission
  extends MarketingOpsApprovalSubmissionBase {
  assetId: string;
  versionNumber: number;
}

export interface MarketingOpsOperationalApprovalSubmission
  extends MarketingOpsApprovalSubmissionBase {
  actionPackage: MarketingOpsCanonicalActionPackageInput;
}

export interface MarketingOpsApprovalDecisionInput {
  decision: 'approved' | 'rejected' | 'changes_requested';
  comment?: string;
}
