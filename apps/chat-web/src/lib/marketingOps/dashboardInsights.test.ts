import { describe, expect, it } from 'vitest';
import { buildMarketingInsights } from './dashboardInsights';
import type { AnalyticsResults } from './analytics';
import type { LeadResults } from './leads';
import type { SearchConsoleReport } from './workspace';
const leads: LeadResults = { capturedLeads: 6, contactsCold: 24, whatsappClicks: 90, qualified: null, sales: 2, revenue: 1000, spend: null, channels: [{ channel: 'organic', leads: 6 }], weekly: [], campaigns: [], coverage: { sources: 1, reports: 1, partialReportsExcluded: 0, metricReports: { qualified: 0, sales: 1, revenue: 1, spend: 0 } }, lastUpdated: null };
const organic: AnalyticsResults = { provider: 'ga4', resource: { id: '1', name: 'Site', timeZone: 'UTC' }, from: '2026-09-01', to: '2026-09-07', lastSyncAt: '2026-09-08T00:00:00Z', totals: { sessions: 100, engagedSessions: 50, pageViews: 130, keyEvents: 4, rageClicks: null, deadClicks: null, scrollDepth: null }, daily: [], channels: [], campaigns: [], warnings: [], stale: false, window: null };
const search: SearchConsoleReport = { from: organic.from, to: organic.to, totals: { clicks: 80, impressions: 1000, ctr: .08, position: 5 }, daily: [], pages: [{ page: 'https://example.com/servicos', clicks: 10, impressions: 500, ctr: .02, position: 6 }], queries: [], truncated: false, lastSyncAt: '2026-09-08T00:00:00Z' };
describe('Marketing insight evidence', () => {
  it('prioritizes measurement gaps and does not calculate sales conversion from visits or aggregates', () => {
    const insights = buildMarketingInsights({ scope: 'overview', leads, ga4: organic });
    expect(insights.length).toBeLessThanOrEqual(3);
    expect(insights.find(i => i.id === 'commercial-coverage')?.evidence).toContain('qualificação');
    expect(JSON.stringify(insights)).not.toMatch(/operação saudável|taxa de conversão|33,3%/i);
    expect(insights.every(i => i.source && i.evidence && i.action)).toBe(true);
  });
  it('discloses stale and reduced organic measurements before drawing performance conclusions', () => {
    const insights = buildMarketingInsights({ scope: 'organic', organic: { ...organic, stale: true, warnings: ['analytics_sampled'] }, search: { ...search, truncated: true } });
    expect(insights[0].tone).toBe('attention');
    expect(insights.some(i => i.id === 'organic-engagement')).toBe(false);
    expect(insights.some(i => i.id === 'search-page-opportunity')).toBe(false);
  });
  it('shows a relative search opportunity with the actual property period and a next action', () => {
    const insights = buildMarketingInsights({ scope: 'organic', search });
    const opportunity = insights.find(i => i.id === 'search-page-opportunity');
    expect(opportunity?.evidence).toContain('500');
    expect(opportunity?.evidence).toContain('01/09/2026');
    expect(opportunity?.source).toBe('Search Console');
    expect(opportunity?.action).toContain('título');
  });
  it('keeps cold prospecting separate and never presents untagged sessions as identified leads', () => {
    const insights = buildMarketingInsights({ scope: 'organic', organic, leads });
    expect(insights.find(i => i.id === 'cold-prospecting')?.evidence).toContain('24');
    expect(insights.find(i => i.id === 'organic-engagement')?.evidence).toContain('100 sessões');
    expect(JSON.stringify(insights)).not.toContain('100 leads');
  });
  it('requires campaign attribution even when the global site has measured traffic', () => {
    const insights = buildMarketingInsights({ scope: 'campaigns', leads, campaignSelected: true, ga4: null });
    expect(insights.some(i => i.id === 'campaign-attribution')).toBe(true);
    expect(JSON.stringify(insights)).not.toMatch(/custo por lead|ROAS|ROI/);
  });
  it('states Clarity exact rolling window without inventing friction or adding GA4 sessions', () => {
    const clarity = { ...organic, provider: 'clarity' as const, window: { from: '2026-09-07T12:00:00Z', to: '2026-09-08T12:00:00Z' } };
    const insights = buildMarketingInsights({ scope: 'overview', clarity });
    const item = insights.find(i => i.id === 'clarity-window');
    expect(item?.evidence).toContain('UTC');
    expect(item?.action).toContain('Clarity');
    expect(JSON.stringify(insights)).not.toMatch(/cliques de frustração|200 sessões|ontem/);
  });
  it('keeps the current period and campaign when drilling into an insight', () => {
    const period = { from: '2026-09-01', to: '2026-09-07' };
    const item = buildMarketingInsights({ scope: 'overview', ga4: organic, period, campaignId: '11111111-1111-4111-8111-111111111111' })[0];
    const params = new URLSearchParams(item.href?.split('?')[1]);
    expect(params.get('from')).toBe(period.from); expect(params.get('to')).toBe(period.to);
    expect(params.get('campaignId')).toBe('11111111-1111-4111-8111-111111111111');
    expect(params.get('detail')).toBe('site');
  });
});
