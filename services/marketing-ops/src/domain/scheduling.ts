import { z } from 'zod';
import { appError } from '../errors.js';
import {
  CampaignChannelSchema,
  ItemKindSchema,
  ItemPrioritySchema,
  ItemStatusSchema,
  type ItemChannel,
  type ItemKind,
  type ItemPriority,
  type ItemStatus
} from './contracts.js';

export const DEFAULT_TENANT_TIME_ZONE = 'America/Sao_Paulo';

export interface ScheduleFilters {
  from?: string;
  to?: string;
  campaignId?: string;
  kind?: ItemKind;
  channel?: ItemChannel;
  assigneeId?: string;
  status?: ItemStatus;
  priority?: ItemPriority;
  cursor?: string;
  limit: number;
}

export interface ScheduleCursor {
  effectiveAt: string | null;
  priority: ItemPriority;
  id: string;
}

export interface NormalizedScheduleFilters {
  from: string | null;
  to: string | null;
  campaignId: string | null;
  kind: ItemKind | null;
  channel: ItemChannel | null;
  assigneeId: string | null;
  status: ItemStatus | null;
  priority: ItemPriority | null;
  cursor: ScheduleCursor | null;
  limit: number;
}

const instantSchema = z.string().datetime({ offset: true });
const scheduleCursorSchema = z.object({
  effectiveAt: instantSchema.nullable(),
  priority: ItemPrioritySchema,
  id: z.string().uuid()
}).strict();

const scheduleFiltersSchema = z.object({
  from: instantSchema.optional(),
  to: instantSchema.optional(),
  campaignId: z.string().uuid().optional(),
  kind: ItemKindSchema.optional(),
  channel: CampaignChannelSchema.optional(),
  assigneeId: z.string().uuid().optional(),
  status: ItemStatusSchema.optional(),
  priority: ItemPrioritySchema.optional(),
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.number().int().min(1).max(100)
}).strict().superRefine((filters, context) => {
  if (Boolean(filters.from) !== Boolean(filters.to)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: filters.from ? ['to'] : ['from'],
      message: 'Schedule from and to must be provided together'
    });
  }
  if (
    filters.from &&
    filters.to &&
    Date.parse(filters.to) <= Date.parse(filters.from)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['to'],
      message: 'Schedule to must be after from'
    });
  }
});

export const PRIORITY_RANK: Record<ItemPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4
};

export function encodeScheduleCursor(cursor: ScheduleCursor): string {
  return Buffer.from(JSON.stringify(scheduleCursorSchema.parse(cursor))).toString('base64url');
}

export function decodeScheduleCursor(value?: string): ScheduleCursor | undefined {
  if (!value) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    return scheduleCursorSchema.parse(decoded);
  } catch {
    throw appError('validation_error', 400, 'Production schedule cursor is invalid');
  }
}

export function normalizeScheduleFilters(filters: ScheduleFilters): NormalizedScheduleFilters {
  const parsed = scheduleFiltersSchema.parse(filters);
  return {
    from: parsed.from ? new Date(parsed.from).toISOString() : null,
    to: parsed.to ? new Date(parsed.to).toISOString() : null,
    campaignId: parsed.campaignId ?? null,
    kind: parsed.kind ?? null,
    channel: parsed.channel ?? null,
    assigneeId: parsed.assigneeId ?? null,
    status: parsed.status ?? null,
    priority: parsed.priority ?? null,
    cursor: decodeScheduleCursor(parsed.cursor) ?? null,
    limit: parsed.limit
  };
}

export function scheduleIntersects(
  item: { startsAt: string | null; dueAt: string | null },
  from: string,
  to: string
): boolean {
  const effectiveStart = item.startsAt ?? item.dueAt;
  const effectiveEnd = item.dueAt ?? item.startsAt;
  if (!effectiveStart || !effectiveEnd) return false;
  return Date.parse(effectiveStart) < Date.parse(to) &&
    Date.parse(effectiveEnd) >= Date.parse(from);
}

export function getScheduleIndicators(
  item: { status: ItemStatus; dueAt: string | null },
  hasIncompleteDependency: boolean,
  now = new Date().toISOString()
): { isOverdue: boolean; isBlocked: boolean } {
  return {
    isOverdue:
      item.status !== 'completed' &&
      item.status !== 'cancelled' &&
      item.dueAt !== null &&
      Date.parse(item.dueAt) < Date.parse(now),
    isBlocked: hasIncompleteDependency
  };
}

export function assertIanaTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    throw new Error(`Invalid IANA timezone: ${value}`);
  }
}

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getZonedDateTimeParts(
  instant: string,
  timeZone: string
): ZonedDateTimeParts {
  const validatedTimeZone = assertIanaTimeZone(timeZone);
  const parsedInstant = instantSchema.parse(instant);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validatedTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(parsedInstant));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
    second: Number(values.get('second'))
  };
}
