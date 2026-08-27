import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import type { ActorRole } from '../auth/actor.js';
import { appError } from '../errors.js';

export const CampaignStatusSchema = z.enum([
  'draft', 'planned', 'active', 'completed', 'archived'
]);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const ReferenceTypeSchema = z.enum(['course', 'product', 'initiative']);
export type ReferenceType = z.infer<typeof ReferenceTypeSchema>;

export const CampaignChannelSchema = z.enum([
  'email', 'instagram', 'linkedin', 'facebook', 'whatsapp',
  'website', 'paid_media', 'events', 'press', 'other'
]);
export type CampaignChannel = z.infer<typeof CampaignChannelSchema>;

export const ItemKindSchema = z.enum([
  'task', 'email', 'whatsapp', 'post', 'creative', 'review', 'milestone'
]);
export type ItemKind = z.infer<typeof ItemKindSchema>;

export const ItemStatusSchema = z.enum([
  'draft', 'ready', 'in_review', 'completed', 'cancelled'
]);
export type ItemStatus = z.infer<typeof ItemStatusSchema>;

export const ItemPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type ItemPriority = z.infer<typeof ItemPrioritySchema>;

export const ItemChannelSchema = CampaignChannelSchema;
export type ItemChannel = z.infer<typeof ItemChannelSchema>;

const nullableTrimmedText = (maximum: number) => z.string().trim().max(maximum).nullable();

const nullableItemText = (maximum: number) => z.string().trim().max(maximum).nullable();
const nullableInstant = z.string().datetime({ offset: true }).nullable();
const itemMetadata = z.record(z.unknown()).superRefine((metadata, context) => {
  let encoded: string;
  try {
    encoded = JSON.stringify(metadata);
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Item metadata must be JSON serializable'
    });
    return;
  }

  if (Buffer.byteLength(encoded, 'utf8') > 16_384) {
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      type: 'string',
      maximum: 16_384,
      inclusive: true,
      message: 'Item metadata cannot exceed 16384 bytes'
    });
  }
});

const productionItemEditableShape = {
  kind: ItemKindSchema,
  title: z.string().trim().min(1).max(200),
  assigneeUserId: z.string().uuid().nullable(),
  priority: ItemPrioritySchema,
  channel: ItemChannelSchema.nullable(),
  description: nullableItemText(10_000),
  startsAt: nullableInstant,
  dueAt: nullableInstant,
  metadata: itemMetadata
};

type ProductionItemEditableFields = {
  kind?: ItemKind | undefined;
  title?: string | undefined;
  assigneeUserId?: string | null | undefined;
  priority?: ItemPriority | undefined;
  channel?: ItemChannel | null | undefined;
  description?: string | null | undefined;
  startsAt?: string | null | undefined;
  dueAt?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
};

function validateProductionItemConsistency(
  fields: ProductionItemEditableFields,
  context: z.RefinementCtx
): void {
  if (fields.startsAt && fields.dueAt) {
    const startsAt = Date.parse(fields.startsAt);
    const dueAt = Date.parse(fields.dueAt);
    if (dueAt < startsAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueAt'],
        message: 'Production item due date cannot precede its start date'
      });
    }
  }
}

export const ProductionItemInputSchema = z.object({
  kind: productionItemEditableShape.kind,
  title: productionItemEditableShape.title,
  assigneeUserId: productionItemEditableShape.assigneeUserId.default(null),
  priority: productionItemEditableShape.priority.default('normal'),
  channel: productionItemEditableShape.channel.default(null),
  description: productionItemEditableShape.description.default(null),
  startsAt: productionItemEditableShape.startsAt.default(null),
  dueAt: productionItemEditableShape.dueAt.default(null),
  metadata: productionItemEditableShape.metadata.default({})
}).strict().superRefine(validateProductionItemConsistency);
export type ProductionItemInput = z.input<typeof ProductionItemInputSchema>;
export type ParsedProductionItemInput = z.output<typeof ProductionItemInputSchema>;

export const ProductionItemPatchSchema = z.object(productionItemEditableShape)
  .partial()
  .strict()
  .superRefine((fields, context) => {
    if (Object.keys(fields).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Production item patch must include at least one editable field'
      });
    }
    validateProductionItemConsistency(fields, context);
  });
export type ProductionItemPatch = z.infer<typeof ProductionItemPatchSchema>;

const campaignEditableShape = {
  name: z.string().trim().min(1).max(200),
  objective: nullableTrimmedText(2_000),
  referenceType: ReferenceTypeSchema.nullable(),
  referenceKey: nullableTrimmedText(200),
  referenceTitleSnapshot: nullableTrimmedText(300),
  referenceDocumentId: z.string().uuid().nullable(),
  audience: nullableTrimmedText(2_000),
  startsOn: z.string().date().nullable(),
  endsOn: z.string().date().nullable(),
  primaryChannel: CampaignChannelSchema.nullable(),
  secondaryChannels: z.array(CampaignChannelSchema).max(9),
  briefing: nullableTrimmedText(20_000),
  notes: nullableTrimmedText(10_000)
};

export const CampaignEditableFieldsSchema = z.object(campaignEditableShape).strict();

type EditableFields = {
  name?: string | undefined;
  objective?: string | null | undefined;
  referenceType?: ReferenceType | null | undefined;
  referenceKey?: string | null | undefined;
  referenceTitleSnapshot?: string | null | undefined;
  referenceDocumentId?: string | null | undefined;
  audience?: string | null | undefined;
  startsOn?: string | null | undefined;
  endsOn?: string | null | undefined;
  primaryChannel?: CampaignChannel | null | undefined;
  secondaryChannels?: CampaignChannel[] | undefined;
  briefing?: string | null | undefined;
  notes?: string | null | undefined;
};

function validateEditableConsistency(fields: EditableFields, context: z.RefinementCtx): void {
  if (fields.startsOn && fields.endsOn && fields.endsOn < fields.startsOn) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsOn'],
      message: 'Campaign end date cannot precede its start date'
    });
  }

  if (fields.secondaryChannels) {
    const uniqueChannels = new Set(fields.secondaryChannels);
    if (uniqueChannels.size !== fields.secondaryChannels.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondaryChannels'],
        message: 'Secondary channels must be unique'
      });
    }
    if (fields.primaryChannel && uniqueChannels.has(fields.primaryChannel)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondaryChannels'],
        message: 'Primary channel cannot be repeated as secondary'
      });
    }
  }

  if (
    fields.referenceDocumentId &&
    fields.referenceType !== undefined &&
    fields.referenceType !== 'course'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['referenceDocumentId'],
      message: 'Only a course reference can use an official document'
    });
  }
}

export const CampaignInputSchema = CampaignEditableFieldsSchema
  .superRefine(validateEditableConsistency);
export type CampaignInput = z.infer<typeof CampaignInputSchema>;

export const CampaignPatchSchema = CampaignEditableFieldsSchema
  .partial()
  .superRefine((fields, context) => {
    if (Object.keys(fields).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Campaign patch must include at least one editable field'
      });
    }
    validateEditableConsistency(fields, context);
  });
export type CampaignPatch = z.infer<typeof CampaignPatchSchema>;

export interface CampaignPlanningReadiness {
  name: string;
  objective: string | null;
  referenceType: ReferenceType | null;
  referenceKey: string | null;
  referenceTitleSnapshot: string | null;
  referenceDocumentId: string | null;
  referenceVerifiedAt: string | null;
  startsOn: string | null;
  endsOn: string | null;
  hasPrimaryOwner: boolean;
}

const isNonBlank = (value: string | null): value is string => Boolean(value?.trim());
const isIsoDate = (value: string): boolean => z.string().date().safeParse(value).success;

export function validatePlanningReadiness(campaign: CampaignPlanningReadiness): void {
  const missingFields: string[] = [];
  if (!isNonBlank(campaign.name)) missingFields.push('name');
  if (!isNonBlank(campaign.objective)) missingFields.push('objective');
  if (!campaign.referenceType) missingFields.push('referenceType');
  if (!isNonBlank(campaign.referenceTitleSnapshot)) missingFields.push('referenceTitleSnapshot');
  if (!campaign.startsOn) missingFields.push('startsOn');
  if (!campaign.endsOn) missingFields.push('endsOn');
  if (!campaign.hasPrimaryOwner) missingFields.push('primaryOwner');

  if (missingFields.length > 0) {
    throw appError(
      'campaign_requirements_missing',
      422,
      'Campaign is missing required planning fields',
      { fields: missingFields }
    );
  }

  if (
    !isIsoDate(campaign.startsOn!) ||
    !isIsoDate(campaign.endsOn!) ||
    campaign.endsOn! < campaign.startsOn!
  ) {
    throw appError(
      'campaign_requirements_missing',
      422,
      'Campaign planning period is invalid',
      { fields: ['period'] }
    );
  }

  if (
    campaign.referenceType === 'course' &&
    (
      !isNonBlank(campaign.referenceKey) ||
      !campaign.referenceDocumentId ||
      !campaign.referenceVerifiedAt
    )
  ) {
    throw appError(
      'reference_not_verified',
      422,
      'Course reference must be verified before planning',
      { referenceType: 'course' }
    );
  }
}

export interface CampaignParticipantAuthority {
  memberRole: 'owner' | 'editor' | 'viewer';
  isPrimary: boolean;
}

type TransitionActor = { role: ActorRole };

const forwardTransitions = new Set([
  'draft:planned',
  'planned:active',
  'active:completed'
]);
const reopenTransitions = new Set([
  'planned:draft',
  'active:planned',
  'completed:active'
]);

export function assertTransitionAllowed(
  actor: TransitionActor,
  participant: CampaignParticipantAuthority | null,
  from: CampaignStatus,
  to: CampaignStatus
): void {
  const edge = `${from}:${to}`;

  if (from === 'archived' || from === to) {
    throw appError('invalid_transition', 409, `Campaign transition ${from} -> ${to} is not allowed`, {
      from,
      to
    });
  }

  if (to === 'archived') {
    authorize(actor, 'campaign.archive');
    return;
  }

  if (forwardTransitions.has(edge)) {
    authorize(actor, 'campaign.transition');
    if (
      actor.role === 'member' &&
      !(participant?.memberRole === 'owner' && participant.isPrimary)
    ) {
      throw appError('forbidden', 403, 'Primary campaign owner is required to advance status', {
        permission: 'campaign.transition'
      });
    }
    return;
  }

  if (reopenTransitions.has(edge)) {
    authorize(actor, 'campaign.reopen');
    return;
  }

  throw appError('invalid_transition', 409, `Campaign transition ${from} -> ${to} is not allowed`, {
    from,
    to
  });
}

const itemTransitions = new Set([
  'draft:ready',
  'draft:cancelled',
  'ready:draft',
  'ready:in_review',
  'ready:cancelled',
  'in_review:ready',
  'in_review:completed',
  'in_review:cancelled'
]);

export function assertItemTransitionAllowed(from: ItemStatus, to: ItemStatus): void {
  if (!itemTransitions.has(`${from}:${to}`)) {
    throw appError(
      'invalid_item_transition',
      409,
      `Production item transition ${from} -> ${to} is not allowed`,
      { from, to }
    );
  }
}
