import { describe, expect, it } from 'vitest';
import { shortDate } from './leadUiHelpers';

describe('campaign date presentation', () => {
  it('converts UTC timestamps to the operation date in São Paulo', () => {
    expect(shortDate('2026-09-29T01:00:00.000Z')).toBe('28/09/2026');
    expect(shortDate('2026-09-29T04:00:00.000Z')).toBe('29/09/2026');
  });
  it('preserves literal dates used by report windows and week labels', () => {
    expect(shortDate('2026-09-29')).toBe('29/09/2026');
  });
});
