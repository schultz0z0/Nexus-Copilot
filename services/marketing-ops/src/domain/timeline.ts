import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import type { CommandContext } from './context.js';

const TimelineChangeSchema = z.object({
  field: z.string().trim().min(1).max(100),
  kind: z.enum(['added', 'removed', 'changed'])
}).strict();

const TimelineCursorSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  id: z.string().uuid()
}).strict();

const TimelineInputSchema = z.object({
  limit: z.number().int().min(1).max(100),
  cursor: z.string().min(1).max(1024).optional()
}).strict();

const SAFE_TIMELINE_ACTIONS = new Set([
  'campaign.created',
  'campaign.updated',
  'campaign.status_changed',
  'campaign.archived',
  'participant.added',
  'participant.updated',
  'participant.removed',
  'material.linked',
  'material.unlinked',
  'campaign.changed'
]);

const SAFE_TIMELINE_FIELDS = new Set([
  'name',
  'courseSlug',
  'objective',
  'referenceType',
  'referenceKey',
  'referenceTitleSnapshot',
  'referenceDocumentId',
  'referenceVerifiedAt',
  'audience',
  'startsOn',
  'endsOn',
  'primaryChannel',
  'secondaryChannels',
  'briefing',
  'notes',
  'status',
  'archivedAt',
  'participant',
  'userId',
  'memberRole',
  'isPrimary',
  'material',
  'materialId',
  'artifactId'
]);

const TimelineRowSchema = z.object({
  id: z.string().uuid(),
  action: z.string().trim().min(1).max(200),
  occurredAt: z.union([z.date(), z.string().datetime({ offset: true })]),
  actorDisplayName: z.string().trim().min(1).max(300),
  origin: z.enum(['rest', 'mcp', 'internal']),
  changes: z.array(TimelineChangeSchema).max(100),
  correlationId: z.string().uuid()
});

export interface TimelineCursor {
  occurredAt: string;
  id: string;
}

export interface CampaignTimelineEvent {
  id: string;
  action: string;
  occurredAt: string;
  actor: { displayName: string };
  origin: 'rest' | 'mcp' | 'internal';
  changes: Array<{ field: string; kind: 'added' | 'removed' | 'changed' }>;
  correlationId: string;
}

export interface CampaignTimelineInput {
  limit: number;
  cursor?: string;
}

export interface CampaignTimelinePage {
  data: CampaignTimelineEvent[];
  nextCursor: string | null;
}

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(TimelineCursorSchema.parse(cursor))).toString('base64url');
}

export function decodeTimelineCursor(value?: string): TimelineCursor | undefined {
  if (!value) return undefined;
  try {
    return TimelineCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    );
  } catch {
    throw appError('validation_error', 400, 'Timeline cursor is invalid');
  }
}

function mapTimelineEvent(candidate: unknown): CampaignTimelineEvent {
  const row = TimelineRowSchema.parse(candidate);
  return {
    id: row.id,
    action: SAFE_TIMELINE_ACTIONS.has(row.action) ? row.action : 'campaign.changed',
    occurredAt: row.occurredAt instanceof Date
      ? row.occurredAt.toISOString()
      : new Date(row.occurredAt).toISOString(),
    actor: { displayName: row.actorDisplayName },
    origin: row.origin,
    changes: row.changes.filter((change) => SAFE_TIMELINE_FIELDS.has(change.field)),
    correlationId: row.correlationId
  };
}

export async function listCampaignTimeline(
  context: CommandContext,
  campaignId: string,
  input: CampaignTimelineInput
): Promise<CampaignTimelinePage> {
  const parsedCampaignId = z.string().uuid().parse(campaignId);
  const parsedInput = TimelineInputSchema.parse(input);
  const cursor = decodeTimelineCursor(parsedInput.cursor);
  authorize(context.actor, 'timeline.read');

  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const campaign = await client.query(
      'select id from marketing_ops.campaigns where id = $1',
      [parsedCampaignId]
    );
    if (!campaign.rows[0]) throw appError('not_found', 404, 'Campaign not found');

    const result = await client.query(`
      select
        timeline.id,
        timeline.action,
        timeline.occurred_at as "occurredAt",
        timeline.actor_display_name as "actorDisplayName",
        timeline.origin::text,
        timeline.changes,
        timeline.correlation_id as "correlationId"
      from marketing_ops_private.list_campaign_timeline($1, $2, $3, $4) as timeline
    `, [
      parsedCampaignId,
      parsedInput.limit + 1,
      cursor?.occurredAt ?? null,
      cursor?.id ?? null
    ]);
    const rows = result.rows.map(mapTimelineEvent);
    const hasNextPage = rows.length > parsedInput.limit;
    const data = rows.slice(0, parsedInput.limit);
    const last = data.at(-1);
    return {
      data,
      nextCursor: hasNextPage && last
        ? encodeTimelineCursor({ occurredAt: last.occurredAt, id: last.id })
        : null
    };
  });
}
