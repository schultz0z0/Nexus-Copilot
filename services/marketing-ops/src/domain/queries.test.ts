import { describe, expect, it } from 'vitest';
import {
  decodeCampaignCursor,
  encodeCampaignCursor,
  getCampaignAttention,
  normalizeCampaignFilters
} from './queries.js';
import { normalizeScheduleFilters } from './scheduling.js';

describe('campaign query contracts', () => {
  it('normalizes search text and escapes a parameterized ILIKE prefix', () => {
    expect(normalizeCampaignFilters({ q: '  Camp_100%  ', limit: 25 })).toMatchObject({
      q: 'Camp_100%',
      searchPrefix: 'Camp\\_100\\%%',
      limit: 25
    });
  });

  it('round-trips a stable campaign cursor', () => {
    const cursor = {
      updatedAt: '2026-07-14T12:00:00.000Z',
      id: 'c1111111-1111-4111-8111-111111111111'
    };
    expect(decodeCampaignCursor(encodeCampaignCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed cursor, filters, dates, and limits before opening the database', () => {
    expect(() => decodeCampaignCursor('not-a-cursor')).toThrowError(expect.objectContaining({
      code: 'validation_error'
    }));
    expect(() => normalizeCampaignFilters({ status: 'unknown', limit: 25 } as never)).toThrow();
    expect(() => normalizeCampaignFilters({ periodFrom: '14/07/2026', limit: 25 })).toThrow();
    expect(() => normalizeCampaignFilters({ responsibleId: 'not-a-uuid', limit: 25 })).toThrow();
    expect(() => normalizeCampaignFilters({ limit: 101 })).toThrow();
  });

  it('derives stable attention indicators for campaign list summaries', () => {
    expect(getCampaignAttention({
      status: 'planned',
      startsOn: '2026-07-14',
      endsOn: '2026-07-20'
    }, [], '2026-07-14')).toEqual(['missing_primary_owner', 'planned_start_due']);

    expect(getCampaignAttention({
      status: 'active',
      startsOn: '2026-07-01',
      endsOn: '2026-07-13'
    }, [{ isPrimary: true }], '2026-07-14')).toEqual(['active_past_end']);
  });

  it('keeps campaign and production schedule filter contracts independent', () => {
    expect(normalizeCampaignFilters({ status: 'planned', limit: 25 }).status).toBe('planned');
    expect(normalizeScheduleFilters({ status: 'in_review', limit: 25 }).status)
      .toBe('in_review');
  });
});
