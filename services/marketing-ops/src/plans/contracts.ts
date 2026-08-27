import { z } from 'zod/v4';

const planRef = z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/);
const courseSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,127}$/);
const uuid = z.string().uuid();
const positiveInteger = z.union([
  z.number().int().positive(),
  z.string().regex(/^[1-9]\d*$/)
]).transform((value) => typeof value === 'string' ? Number(value) : value);
const nullableText = (maximum: number) => z.string().trim().max(maximum).nullable();
const instant = z.iso.datetime({ offset: true });
const channel = z.enum([
  'email', 'instagram', 'linkedin', 'facebook', 'whatsapp',
  'website', 'paid_media', 'events', 'press', 'other'
]);
const itemKind = z.enum(['task', 'email', 'whatsapp', 'post', 'creative', 'review', 'milestone']);
const priority = z.enum(['low', 'normal', 'high', 'urgent']);

const createCampaignAction = z.object({
  type: z.literal('campaign.create_draft'),
  ref: planRef,
  name: z.string().trim().min(1).max(200),
  course_slug: courseSlug.optional()
}).strict();

const campaignPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  objective: nullableText(2_000).optional(),
  audience: nullableText(2_000).optional(),
  starts_on: z.iso.date().nullable().optional(),
  ends_on: z.iso.date().nullable().optional(),
  primary_channel: channel.nullable().optional(),
  secondary_channels: z.array(channel).max(9).optional(),
  briefing: nullableText(20_000).optional(),
  notes: nullableText(10_000).optional()
}).strict().superRefine((patch, context) => {
  if (Object.keys(patch).length === 0) {
    context.addIssue({ code: 'custom', message: 'Campaign patch must include at least one field' });
  }
  if (patch.starts_on && patch.ends_on && patch.ends_on < patch.starts_on) {
    context.addIssue({ code: 'custom', path: ['ends_on'], message: 'ends_on cannot precede starts_on' });
  }
  if (patch.secondary_channels && new Set(patch.secondary_channels).size !== patch.secondary_channels.length) {
    context.addIssue({ code: 'custom', path: ['secondary_channels'], message: 'secondary_channels must be unique' });
  }
  if (patch.primary_channel && patch.secondary_channels?.includes(patch.primary_channel)) {
    context.addIssue({ code: 'custom', path: ['secondary_channels'], message: 'primary_channel cannot be secondary' });
  }
});

const updateCampaignAction = z.object({
  type: z.literal('campaign.update'),
  campaign_id: uuid,
  expected_version: positiveInteger,
  patch: campaignPatch
}).strict();

const campaignSelector = z.object({
  campaign_id: uuid.optional(),
  campaign_ref: planRef.optional()
}).refine(
  (value) => Boolean(value.campaign_id) !== Boolean(value.campaign_ref),
  { message: 'Exactly one campaign_id or campaign_ref is required' }
);

const createItemAction = z.object({
  type: z.literal('campaign_item.create'),
  campaign_id: uuid.optional(),
  campaign_ref: planRef.optional(),
  kind: itemKind,
  title: z.string().trim().min(1).max(200),
  assignee_user_id: uuid.nullable().optional(),
  priority: priority.optional(),
  channel: channel.nullable().optional(),
  description: nullableText(10_000).optional(),
  starts_at: instant.nullable().optional(),
  due_at: instant.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict().superRefine((action, context) => {
  const selector = campaignSelector.safeParse(action);
  if (!selector.success) {
    context.addIssue({ code: 'custom', path: ['campaign_id'], message: 'Exactly one campaign_id or campaign_ref is required' });
  }
  if (action.starts_at && action.due_at && Date.parse(action.due_at) < Date.parse(action.starts_at)) {
    context.addIssue({ code: 'custom', path: ['due_at'], message: 'due_at cannot precede starts_at' });
  }
});

const rescheduleItemAction = z.object({
  type: z.literal('campaign_item.reschedule'),
  item_id: uuid,
  expected_version: positiveInteger,
  starts_at: instant.nullable().optional(),
  due_at: instant.nullable().optional()
}).strict().superRefine((action, context) => {
  if (action.starts_at === undefined && action.due_at === undefined) {
    context.addIssue({ code: 'custom', message: 'At least one schedule field is required' });
  }
  if (action.starts_at && action.due_at && Date.parse(action.due_at) < Date.parse(action.starts_at)) {
    context.addIssue({ code: 'custom', path: ['due_at'], message: 'due_at cannot precede starts_at' });
  }
});

const createContentAction = z.object({
  type: z.literal('content.create_draft'),
  ref: planRef,
  item_id: uuid,
  expected_item_version: positiveInteger,
  asset_kind: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
  title: z.string().trim().min(1).max(200)
}).strict();

const createContentVersionAction = z.object({
  type: z.literal('content.version_create'),
  asset_id: uuid.optional(),
  asset_ref: planRef.optional(),
  expected_asset_version: positiveInteger,
  body: z.string().max(1_048_576).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  freeze: z.boolean().default(false)
}).strict().superRefine((action, context) => {
  if (Boolean(action.asset_id) === Boolean(action.asset_ref)) {
    context.addIssue({ code: 'custom', path: ['asset_id'], message: 'Exactly one asset_id or asset_ref is required' });
  }
  if (Buffer.byteLength(JSON.stringify(action.metadata), 'utf8') > 16_384) {
    context.addIssue({ code: 'custom', path: ['metadata'], message: 'metadata cannot exceed 16384 bytes' });
  }
});

const linkArtifactAction = z.object({
  type: z.literal('artifact.link_existing'),
  item_id: uuid,
  expected_item_version: positiveInteger,
  artifact_id: uuid,
  asset_id: uuid.optional()
}).strict();

const addCampaignNoteAction = z.object({
  type: z.literal('campaign.note_add'),
  campaign_id: uuid,
  expected_version: positiveInteger,
  note: z.string().trim().min(1).max(2_000)
}).strict();

const canonicalActionPackage = z.object({
  actionType: z.string().trim().min(1).max(100),
  channel: z.string().trim().min(1).max(64),
  audienceSnapshot: z.record(z.string(), z.unknown()),
  scheduledFor: instant.nullable().default(null),
  timeZone: z.string().trim().min(1).max(100),
  configuration: z.record(z.string(), z.unknown()),
  successCriteria: z.string().trim().max(2000).nullable().default(null),
  riskSummary: z.string().trim().max(2000).nullable().default(null),
  payload: z.record(z.string(), z.unknown())
}).strict();

const submitEditorialApprovalAction = z.object({
  type: z.literal('approval.submit_editorial'),
  campaign_id: uuid,
  asset_id: uuid,
  version_number: positiveInteger,
  reason: z.string().trim().min(1).max(4000),
  expires_at: instant
}).strict();

const submitOperationalApprovalAction = z.object({
  type: z.literal('approval.submit_operational'),
  campaign_id: uuid,
  action_package: canonicalActionPackage,
  reason: z.string().trim().min(1).max(4000),
  expires_at: instant
}).strict();

export const marketingOpsPlanActionSchema = z.discriminatedUnion('type', [
  createCampaignAction,
  updateCampaignAction,
  createItemAction,
  rescheduleItemAction,
  createContentAction,
  createContentVersionAction,
  linkArtifactAction,
  addCampaignNoteAction,
  submitEditorialApprovalAction,
  submitOperationalApprovalAction
]);

export const marketingOpsPlanActionsSchema = z.array(marketingOpsPlanActionSchema)
  .min(1)
  .max(20)
  .superRefine((actions, context) => {
    const campaignRefs = new Set<string>();
    const assetRefs = new Set<string>();
    for (const [index, action] of actions.entries()) {
      if (action.type === 'campaign.create_draft') {
        if (campaignRefs.has(action.ref)) {
          context.addIssue({ code: 'custom', message: `Duplicate campaign ref ${action.ref}`, path: [index, 'ref'] });
        }
        campaignRefs.add(action.ref);
      }
      if (action.type === 'campaign_item.create' && action.campaign_ref && !campaignRefs.has(action.campaign_ref)) {
        context.addIssue({ code: 'custom', message: `Unknown earlier campaign ref ${action.campaign_ref}`, path: [index, 'campaign_ref'] });
      }
      if (action.type === 'content.create_draft') {
        if (assetRefs.has(action.ref)) {
          context.addIssue({ code: 'custom', message: `Duplicate content asset ref ${action.ref}`, path: [index, 'ref'] });
        }
        assetRefs.add(action.ref);
      }
      if (action.type === 'content.version_create' && action.asset_ref && !assetRefs.has(action.asset_ref)) {
        context.addIssue({ code: 'custom', message: `Unknown earlier content asset ref ${action.asset_ref}`, path: [index, 'asset_ref'] });
      }
    }
  });

export type MarketingOpsPlanAction = z.infer<typeof marketingOpsPlanActionSchema>;

export function requiredScopesForPlan(actions: MarketingOpsPlanAction[]): string[] {
  const scopes = new Set<string>();
  for (const action of actions) {
    if (action.type.startsWith('approval.')) scopes.add('approval:submit');
    else if (action.type.startsWith('campaign_item.')) scopes.add('item:write');
    else if (action.type.startsWith('content.')) scopes.add('content:write');
    else if (action.type.startsWith('artifact.')) scopes.add('artifact:write');
    else scopes.add('campaign:write');
  }
  return [...scopes].sort();
}
