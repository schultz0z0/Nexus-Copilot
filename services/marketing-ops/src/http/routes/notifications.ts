import type { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  listInAppNotifications,
  markInAppNotificationsRead,
  projectInAppNotifications
} from '../../domain/notifications.js';
import {
  actorFrom,
  asyncRoute,
  requireFeature,
  requireIdempotencyKey
} from '../middleware.js';

const notificationListQuerySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
}).strict();
const notificationReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100)
}).strict().superRefine((input, context) => {
  if (new Set(input.ids).size !== input.ids.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ids'],
      message: 'Notification IDs must be unique'
    });
  }
});

export const parseNotificationListQuery = (value: unknown) =>
  notificationListQuerySchema.parse(value);
export const parseNotificationReadBody = (value: unknown) =>
  notificationReadSchema.parse(value);

export function registerNotifications(
  router: Router,
  pool: Pool,
  features: { read: boolean; write: boolean }
): void {
  router.get('/v1/in-app-notifications', asyncRoute(async (request, response) => {
    requireFeature(features.read, 'read');
    const filters = parseNotificationListQuery(request.query);
    const context = {
      pool,
      actor: actorFrom(request),
      correlationId: request.correlationId,
      origin: 'rest' as const
    };
    const projection = await projectInAppNotifications(context);
    response.locals.notificationsProduced = projection.produced;
    const result = await listInAppNotifications(context, {
      limit: filters.limit,
      ...(filters.unreadOnly === undefined ? {} : { unreadOnly: filters.unreadOnly }),
      ...(filters.cursor === undefined ? {} : { cursor: filters.cursor })
    });
    response.json({
      data: result.data,
      page: {
        limit: filters.limit,
        count: result.data.length,
        nextCursor: result.nextCursor
      }
    });
  }));

  router.patch('/v1/in-app-notifications', asyncRoute(async (request, response) => {
    requireFeature(features.write, 'write');
    const { ids } = parseNotificationReadBody(request.body);
    const data = await markInAppNotificationsRead(
      {
        pool,
        actor: actorFrom(request),
        correlationId: request.correlationId,
        origin: 'rest'
      },
      ids,
      requireIdempotencyKey(request)
    );
    response.json({ data });
  }));
}
