import { describe, expect, it } from 'vitest';
import { buildDashboard, compare, validateWeeklyReport } from './model';

describe('marketing dashboard read model', () => {
  it('keeps filtered totals additive and paid cost separate from organic leads', () => {
    const all = buildDashboard({ weeks: 4, channel: 'all', campaign: 'all' });
    const channels = all.channels.map(row => buildDashboard({ weeks: 4, channel: row.id, campaign: 'all' }));
    expect(channels.reduce((sum, row) => sum + row.current.leads, 0)).toBe(all.current.leads);
    expect(all.costPerQualified).toBe(all.current.spend / all.paidQualified);
    expect(all.paidQualified).toBeLessThan(all.current.qualified);
  });
  it('filters both campaign and time, and derives period sales independently of cohort wins', () => {
    const narrow = buildDashboard({ weeks: 1, channel: 'google', campaign: 'growth' });
    const broad = buildDashboard({ weeks: 4, channel: 'google', campaign: 'growth' });
    expect(narrow.current.leads).toBeLessThan(broad.current.leads);
    expect(narrow.trend).toHaveLength(1);
    expect(narrow.current.sales).not.toBe(narrow.current.won);
    expect(narrow.current.won).toBeLessThanOrEqual(narrow.current.proposals);
    expect(narrow.campaigns).toHaveLength(1);
    expect(narrow.channels).toHaveLength(1);
  });
  it('represents unavailable data without a healthy score or invented zeros', () => {
    const missing = buildDashboard({ weeks: 4, channel: 'all', campaign: 'all', unavailable: true });
    expect(missing.available).toBe(false);
    expect(missing.costPerQualified).toBeNull();
    expect(missing.resultHealth).toBe('unavailable');
    expect(compare(10, 0)).toBeNull();
    expect(compare(0, 10)).toBe(-100);
  });
  it('does not attribute unpaid channels to media cost', () => {
    const organic = buildDashboard({ weeks: 4, channel: 'organic', campaign: 'all' });
    expect(organic.current.spend).toBe(0);
    expect(organic.costPerQualified).toBeNull();
  });
  it('leaves a gap for an absent weekly report instead of plotting zero', () => {
    const whatsapp = buildDashboard({ weeks: 2, channel: 'whatsapp', campaign: 'all' });
    expect(whatsapp.trend[0].leads).toBeGreaterThan(0);
    expect(whatsapp.trend[1].leads).toBeNull();
    expect(whatsapp.trend[1].complete).toBe(false);
    const mixed = buildDashboard({ weeks: 2, channel: 'all', campaign: 'all' });
    expect(mixed.trend[1].leads).toBeGreaterThan(0);
    expect(mixed.trend[1].complete).toBe(false);
  });
  it('rejects inconsistent weekly delivery reports and reversed periods', () => {
    expect(validateWeeklyReport({ sent: 100, delivered: 120, responses: 5, from: '2026-09-14', to: '2026-09-20' })).toMatch(/entregas/i);
    expect(validateWeeklyReport({ sent: 100, delivered: 90, responses: 91, from: '2026-09-14', to: '2026-09-20' })).toMatch(/interações/i);
    expect(validateWeeklyReport({ sent: 100, delivered: 90, responses: 5, from: '2026-09-20', to: '2026-09-14' })).toMatch(/período/i);
    expect(validateWeeklyReport({ sent: 100, delivered: 90, responses: 5, from: '2026-09-14', to: '2026-09-20' })).toBeNull();
  });
});
