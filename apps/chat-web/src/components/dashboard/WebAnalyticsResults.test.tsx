// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAnalyticsResults } from './WebAnalyticsResults';
import type { AnalyticsResults } from '@/lib/marketingOps/analytics';
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, AreaChart: () => null, Area: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, PieChart: () => null, Pie: () => null, Cell: () => null, BarChart: () => null, Bar: () => null }));
const results: AnalyticsResults = { provider: 'ga4', resource: { id: 'properties/1', name: 'Site', timeZone: 'UTC' }, from: '2026-09-24', to: '2026-09-30', totals: { sessions: 20, engagedSessions: 10, pageViews: 50, keyEvents: 3, rageClicks: null, deadClicks: null, scrollDepth: null }, daily: [{ date: '2026-09-30', sessions: 20, engagedSessions: 10, pageViews: 50, keyEvents: 3 }], channels: [{ source: 'google', medium: 'cpc', sessions: 20 }], campaigns: [], lastSyncAt: '2026-10-01T00:00:00Z', warnings: [], window: null, stale: false };
afterEach(cleanup);
describe('Site analytics presentation', () => {
  it('has accessible chart data and keeps key events separate from sales and leads', () => {
    render(<WebAnalyticsResults results={results} />);
    expect(screen.getByText('Eventos-chave')).toBeTruthy();
    expect(screen.getByText(/não representam leads identificados nem vendas/)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Sessões por dia' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Sessões por origem' })).toBeTruthy();
    expect(screen.getAllByText('google / cpc')).toHaveLength(2);
  });
  it('shows no measurements honestly and offers direction without fake graphs', () => {
    render(<WebAnalyticsResults results={{ ...results, totals: null, daily: [], channels: [] }} />);
    expect(screen.getByText('Sem medições neste recorte')).toBeTruthy();
    expect(screen.queryByText('20')).toBeNull();
  });
  it('labels Clarity rolling windows, unknown friction metrics and stale reads without adding snapshots', () => {
    render(<WebAnalyticsResults results={{ ...results, provider: 'clarity', totals: { ...results.totals, engagedSessions: null, pageViews: null, keyEvents: null }, daily: [], window: { from: '2026-09-30T00:00:00Z', to: '2026-10-01T00:00:00Z' }, stale: true }} />);
    expect(screen.getByText(/Janela móvel de 24 horas/)).toBeTruthy();
    expect(screen.getByText(/Leitura desatualizada/)).toBeTruthy();
    expect(screen.getByText('Sessões de bots')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(1);
  });
});
