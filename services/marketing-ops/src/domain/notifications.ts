import type { PoolClient } from 'pg';
import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import { writeAudit } from './audit.js';
import type { CommandContext } from './context.js';
import { writeDomainEvent } from './events.js';
import { executeIdempotentCommand } from './idempotency.js';

export const NotificationTypeSchema = z.enum([
  'assignment', 'due_soon', 'overdue', 'approval_review', 'approval_status'
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export interface InAppNotification {
  id: string;
  eventKey: string;
  notificationType: NotificationType;
  campaignId: string;
  itemId: string | null;
  approvalRequestId: string | null;
  label: string;
  payload: Record<string, unknown> & { campaignId: string };
  occurredAt: string;
  readAt: string | null;
  createdAt: string;
}

export interface InAppNotificationPage {
  data: InAppNotification[];
  nextCursor: string | null;
}

interface NotificationRow {
  id: string;
  event_key: string;
  notification_type: NotificationType;
  campaign_id: string;
  item_id: string | null;
  approval_request_id: string | null;
  label: string;
  payload: InAppNotification['payload'];
  occurred_at: Date | string;
  read_at: Date | string | null;
  created_at: Date | string;
}

interface NotificationCursor {
  occurredAt: string;
  id: string;
}

const uuid = z.string().uuid();
const cursorSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  id: uuid
}).strict();
const listSchema = z.object({
  unreadOnly: z.boolean().optional().default(false),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.number().int().min(1).max(100).optional().default(25)
}).strict();
const readIdsSchema = z.array(uuid).min(1).max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Notification IDs must be unique');

function validationError(message: string) {
  return appError('validation_error', 400, message);
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function mapNotification(row: NotificationRow): InAppNotification {
  return {
    id: row.id,
    eventKey: row.event_key,
    notificationType: row.notification_type,
    campaignId: row.campaign_id,
    itemId: row.item_id,
    approvalRequestId: row.approval_request_id,
    label: row.label,
    payload: row.payload,
    occurredAt: iso(row.occurred_at),
    readAt: nullableIso(row.read_at),
    createdAt: iso(row.created_at)
  };
}

function encodeCursor(notification: InAppNotification): string {
  const cursor: NotificationCursor = {
    occurredAt: notification.occurredAt,
    id: notification.id
  };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string | undefined): NotificationCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const result = cursorSchema.safeParse(parsed);
    if (!result.success) throw new Error('invalid cursor');
    return result.data;
  } catch {
    throw validationError('Notification cursor is invalid');
  }
}

export async function projectInAppNotifications(
  context: CommandContext,
  now = new Date()
): Promise<{ produced: number }> {
  authorize(context.actor, 'notification.read');
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      const result = await client.query(`
        with assigned_items as (
          select
            item.id,
            item.campaign_id,
            item.priority::text as priority,
            item.due_at,
            item.created_at
          from marketing_ops.campaign_items as item
          join marketing_ops.campaigns as campaign
            on campaign.tenant_id = item.tenant_id
            and campaign.id = item.campaign_id
          where item.tenant_id = $1
            and item.assignee_user_id = $2
            and item.status not in ('completed', 'cancelled')
            and campaign.status <> 'archived'
            and marketing_ops_private.can_access_campaign_item(item.id)
        ),
        candidates as (
          select
            'assignment:' || id::text as event_key,
            'assignment'::text as notification_type,
            campaign_id,
            id as item_id,
            'Novo item atribuído'::text as label,
            jsonb_build_object(
              'campaignId', campaign_id,
              'itemId', id,
              'dueAt', due_at,
              'priority', priority
            ) as payload,
            created_at as occurred_at
          from assigned_items
          union all
          select
            'due-soon:' || id::text || ':' || due_at::text,
            'due_soon',
            campaign_id,
            id,
            'Prazo próximo',
            jsonb_build_object(
              'campaignId', campaign_id,
              'itemId', id,
              'dueAt', due_at,
              'priority', priority
            ),
            greatest(created_at, due_at - interval '48 hours')
          from assigned_items
          where due_at >= $3::timestamptz
            and due_at <= $3::timestamptz + interval '48 hours'
          union all
          select
            'overdue:' || id::text || ':' || due_at::text,
            'overdue',
            campaign_id,
            id,
            'Item em atraso',
            jsonb_build_object(
              'campaignId', campaign_id,
              'itemId', id,
              'dueAt', due_at,
              'priority', priority
            ),
            due_at
          from assigned_items
          where due_at < $3::timestamptz
        )
        insert into marketing_ops.in_app_notifications (
          tenant_id, user_id, event_key, notification_type, campaign_id,
          item_id, label, payload, occurred_at
        )
        select $1, $2, event_key, notification_type, campaign_id,
          item_id, label, payload, occurred_at
        from candidates
        on conflict (tenant_id, user_id, event_key) do nothing
        returning id
      `, [context.actor.tenantId, context.actor.userId, now.toISOString()]);
      return { produced: result.rowCount ?? 0 };
    }
  );
}

export async function listInAppNotifications(
  context: CommandContext,
  input: { unreadOnly?: boolean; cursor?: string; limit?: number } = {}
): Promise<InAppNotificationPage> {
  authorize(context.actor, 'notification.read');
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) throw validationError('Notification filters are invalid');
  const cursor = decodeCursor(parsed.data.cursor);
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => {
      const result = await client.query<NotificationRow>(`
        select *
        from marketing_ops.in_app_notifications
        where tenant_id = $1
          and user_id = $2
          and ($3::boolean = false or read_at is null)
          and (
            $4::timestamptz is null
            or (occurred_at, id) < ($4::timestamptz, $5::uuid)
          )
        order by occurred_at desc, id desc
        limit $6
      `, [
        context.actor.tenantId,
        context.actor.userId,
        parsed.data.unreadOnly,
        cursor?.occurredAt ?? null,
        cursor?.id ?? null,
        parsed.data.limit + 1
      ]);
      const hasNext = result.rows.length > parsed.data.limit;
      const data = result.rows.slice(0, parsed.data.limit).map(mapNotification);
      return {
        data,
        nextCursor: hasNext && data.length > 0
          ? encodeCursor(data[data.length - 1]!)
          : null
      };
    }
  );
}

async function ownedNotifications(
  client: PoolClient,
  context: CommandContext,
  ids: string[]
): Promise<NotificationRow[]> {
  const result = await client.query<NotificationRow>(`
    select *
    from marketing_ops.in_app_notifications
    where tenant_id = $1 and user_id = $2 and id = any($3::uuid[])
    order by occurred_at desc, id desc
  `, [context.actor.tenantId, context.actor.userId, ids]);
  if (result.rows.length !== ids.length) {
    throw appError('not_found', 404, 'In-app notification not found');
  }
  return result.rows;
}

export async function markInAppNotificationsRead(
  context: CommandContext,
  ids: string[],
  idempotencyKey: string,
  now = new Date()
): Promise<InAppNotification[]> {
  authorize(context.actor, 'notification.update');
  const parsed = readIdsSchema.safeParse(ids);
  if (!parsed.success) throw validationError('Notification IDs are invalid');
  const orderedIds = [...parsed.data].sort();
  return withActorTransaction(
    context.pool,
    context.actor,
    context.correlationId,
    async (client) => executeIdempotentCommand(
      client,
      context,
      'in_app_notification.read',
      idempotencyKey,
      { ids: orderedIds },
      async () => {
        const before = await ownedNotifications(client, context, orderedIds);
        const earliestOccurredAt = before.reduce((earliest, notification) => {
          const occurredAt = new Date(notification.occurred_at);
          return occurredAt > earliest ? occurredAt : earliest;
        }, new Date(0));
        const readAt = now < earliestOccurredAt ? earliestOccurredAt : now;
        const result = await client.query<NotificationRow>(`
          update marketing_ops.in_app_notifications
          set read_at = coalesce(read_at, $4::timestamptz)
          where tenant_id = $1 and user_id = $2 and id = any($3::uuid[])
          returning *
        `, [
          context.actor.tenantId,
          context.actor.userId,
          orderedIds,
          readAt.toISOString()
        ]);
        const notifications = result.rows.map(mapNotification)
          .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) ||
            right.id.localeCompare(left.id));
        await writeAudit(
          client,
          context,
          'in_app_notification',
          context.actor.userId,
          'in_app_notification.read',
          { ids: orderedIds, read: false },
          { ids: orderedIds, read: true }
        );
        await writeDomainEvent(
          client,
          context,
          'in_app_notification',
          context.actor.userId,
          'marketing_ops.in_app_notification.read.v1',
          { ids: orderedIds, count: notifications.length }
        );
        return notifications;
      }
    )
  );
}
