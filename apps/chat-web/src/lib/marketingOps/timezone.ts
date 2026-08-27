export type ProductionCalendarView = 'week' | 'month';

interface DateParts {
  year: number;
  month: number;
  day: number;
}

interface DateTimeParts extends DateParts {
  hour: number;
  minute: number;
  second: number;
}

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateKey(parts: DateParts): string {
  return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}`;
}

function parseDate(value: string): DateParts {
  const match = datePattern.exec(value);
  if (!match) throw new RangeError(`Invalid calendar date: ${value}`);
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    date.getUTCFullYear() !== parts.year
    || date.getUTCMonth() !== parts.month - 1
    || date.getUTCDate() !== parts.day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return parts;
}

function parseLocalDateTime(value: string): DateTimeParts {
  const match = localDateTimePattern.exec(value);
  if (!match) throw new RangeError(`Invalid local date-time: ${value}`);
  const date = parseDate(`${match[1]}-${match[2]}-${match[3]}`);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) throw new RangeError(`Invalid local date-time: ${value}`);
  return { ...date, hour, minute, second: 0 };
}

function utcDate(value: string): Date {
  const parts = parseDate(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function addDays(value: string, amount: number): string {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function startOfWeek(value: string): string {
  const date = utcDate(value);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addDays(value, -daysSinceMonday);
}

function startOfMonth(value: string): string {
  const parts = parseDate(value);
  return dateKey({ ...parts, day: 1 });
}

function shiftMonth(value: string, amount: number): string {
  const parts = parseDate(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + amount, 1));
  return date.toISOString().slice(0, 10);
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw new RangeError(`Invalid IANA time zone: ${timeZone}`);
  }
}

function partsInTimeZone(instant: Date, timeZone: string): DateTimeParts {
  assertTimeZone(timeZone);
  if (Number.isNaN(instant.getTime())) throw new RangeError('Invalid UTC instant');
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(instant).reduce<Record<string, number>>((current, part) => {
    if (part.type !== 'literal') current[part.type] = Number(part.value);
    return current;
  }, {});
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function wallClockMillis(parts: DateTimeParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

export function utcToLocalDateTime(instant: string, timeZone: string): string {
  const date = new Date(instant);
  const parts = partsInTimeZone(date, timeZone);
  return `${dateKey(parts)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function localDateTimeToUtc(localDateTime: string, timeZone: string): string {
  const desired = parseLocalDateTime(localDateTime);
  assertTimeZone(timeZone);
  const desiredWallClock = wallClockMillis(desired);
  let candidate = desiredWallClock;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = partsInTimeZone(new Date(candidate), timeZone);
    const difference = desiredWallClock - wallClockMillis(actual);
    if (difference === 0) break;
    candidate += difference;
  }

  const result = new Date(candidate).toISOString();
  if (utcToLocalDateTime(result, timeZone) !== localDateTime) {
    throw new RangeError(`Nonexistent or ambiguous local date-time: ${localDateTime}`);
  }
  return result;
}

export function dateKeyInTimeZone(instant: string, timeZone: string): string {
  return utcToLocalDateTime(instant, timeZone).slice(0, 10);
}

export function calendarRange(
  view: ProductionCalendarView,
  anchorDate: string,
  timeZone: string
): { anchorDate: string; from: string; to: string } {
  assertTimeZone(timeZone);
  const anchor = view === 'week' ? startOfWeek(anchorDate) : startOfMonth(anchorDate);
  const next = view === 'week' ? addDays(anchor, 7) : shiftMonth(anchor, 1);
  return {
    anchorDate: anchor,
    from: localDateTimeToUtc(`${anchor}T00:00`, timeZone),
    to: localDateTimeToUtc(`${next}T00:00`, timeZone)
  };
}

export function calendarDays(view: ProductionCalendarView, anchorDate: string): string[] {
  const first = view === 'week'
    ? startOfWeek(anchorDate)
    : startOfWeek(startOfMonth(anchorDate));
  const count = view === 'week' ? 7 : 42;
  return Array.from({ length: count }, (_, index) => addDays(first, index));
}

export function shiftCalendarAnchor(
  view: ProductionCalendarView,
  anchorDate: string,
  amount: number
): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError('Calendar shift must be an integer');
  return view === 'week'
    ? addDays(startOfWeek(anchorDate), amount * 7)
    : shiftMonth(startOfMonth(anchorDate), amount);
}

export function todayInTimeZone(timeZone: string): string {
  return dateKeyInTimeZone(new Date().toISOString(), timeZone);
}
