import { describe, expect, it } from 'vitest';
import {
  calendarDays,
  calendarRange,
  dateKeyInTimeZone,
  localDateTimeToUtc,
  shiftCalendarAnchor,
  utcToLocalDateTime
} from './timezone';

describe('production calendar timezone', () => {
  it('builds a São Paulo week across the year boundary with [from,to) UTC limits', () => {
    expect(calendarRange('week', '2026-12-31', 'America/Sao_Paulo')).toEqual({
      anchorDate: '2026-12-28',
      from: '2026-12-28T03:00:00.000Z',
      to: '2027-01-04T03:00:00.000Z'
    });
    expect(calendarDays('week', '2026-12-31')).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
      '2027-01-01', '2027-01-02', '2027-01-03'
    ]);
  });

  it('builds a month grid and moves anchors without skipping short months', () => {
    const days = calendarDays('month', '2026-12-15');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-11-30');
    expect(days[41]).toBe('2027-01-10');
    expect(calendarRange('month', '2026-12-15', 'America/Sao_Paulo')).toEqual({
      anchorDate: '2026-12-01',
      from: '2026-12-01T03:00:00.000Z',
      to: '2027-01-01T03:00:00.000Z'
    });
    expect(shiftCalendarAnchor('month', '2026-01-31', 1)).toBe('2026-02-01');
  });

  it('uses IANA offsets across a DST change instead of fixed arithmetic', () => {
    expect(calendarRange('week', '2026-03-08', 'America/New_York')).toEqual({
      anchorDate: '2026-03-02',
      from: '2026-03-02T05:00:00.000Z',
      to: '2026-03-09T04:00:00.000Z'
    });
    expect(localDateTimeToUtc('2026-11-05T09:30', 'America/New_York'))
      .toBe('2026-11-05T14:30:00.000Z');
    expect(utcToLocalDateTime('2026-11-05T14:30:00.000Z', 'America/New_York'))
      .toBe('2026-11-05T09:30');
    expect(dateKeyInTimeZone('2027-01-01T01:00:00.000Z', 'America/Sao_Paulo'))
      .toBe('2026-12-31');
  });

  it('rejects invalid dates, zones and nonexistent DST wall times', () => {
    expect(() => calendarRange('week', '2026-02-30', 'America/Sao_Paulo')).toThrow();
    expect(() => calendarRange('month', '2026-02-01', 'Invalid/Zone')).toThrow();
    expect(() => localDateTimeToUtc('2026-03-08T02:30', 'America/New_York')).toThrow();
  });
});
