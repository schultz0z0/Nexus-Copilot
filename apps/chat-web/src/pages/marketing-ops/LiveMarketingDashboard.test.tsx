// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { LiveMarketingDashboard } from './LiveMarketingDashboard';
import type { LeadClient, LeadResults } from '@/lib/marketingOps/leads';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
vi.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/marketing-ops/MarketingOpsMobileBar', () => ({ MarketingOpsMobileBar: () => null }));
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, AreaChart: () => null, Area: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, PieChart: () => null, Pie: () => null, Cell: () => null }));
const real: LeadResults = { capturedLeads: 2, contactsCold: 8, whatsappClicks: 7, qualified: null, sales: 0, revenue: 123.45, spend: null, channels: [{ channel: 'meta_ads', leads: 2 }], weekly: [{ week: '2026-09-28', leads: 2 }], campaigns: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Campanha real', capturedLeads: 2, contactsCold: 8, qualified: null, sales: 0, revenue: 123.45, spend: null }], coverage: { sources: 1, reports: 1, partialReportsExcluded: 0, metricReports: { qualified: 0, sales: 1, revenue: 1, spend: 0 } }, lastUpdated: '2026-09-30T10:00:00Z' };
const ops = { listCampaigns: vi.fn().mockResolvedValue({ data: [], page: { nextCursor: null } }) } as unknown as MarketingOpsClient;
function mount(api: LeadClient, url = '/marketing-ops/dashboard') { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><LiveMarketingDashboard api={api} ops={ops} /></MemoryRouter></QueryClientProvider>); }
afterEach(cleanup);
describe('Live dashboard', () => {
  it('uses measured values and preserves unknowns without cold contacts becoming leads', async () => {
    const api = { results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient; mount(api);
    expect((await screen.findByTestId('live-kpi-leads')).textContent).toBe('2');
    expect(screen.getByTestId('live-kpi-sales').textContent).toBe('0');
    expect(screen.getByTestId('live-kpi-spend').textContent).toBe('—');
    expect(screen.queryByText('Crescimento B2B')).toBeNull();
    expect(screen.getByRole('link', { name: 'Ver resultados de Campanha real' }).getAttribute('href')).toBe('/marketing-ops/campaigns/11111111-1111-4111-8111-111111111111');
    expect(screen.getByRole('link', { name: 'Ver demonstração' }).getAttribute('href')).toBe('/marketing-ops/dashboard?mode=demo');
  });
  it('renders source failure as an error rather than an empty success', async () => {
    mount({ results: vi.fn().mockRejectedValue(new Error('Resultados temporariamente indisponíveis')) } as unknown as LeadClient);
    expect((await screen.findByRole('alert')).textContent).toContain('Resultados temporariamente indisponíveis');
    expect(screen.queryByTestId('live-kpi-leads')).toBeNull();
  });
  it('retains the persisted campaign and date scope from the URL', async () => {
    const api = { results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient;
    mount(api, '/marketing-ops/dashboard?campaignId=11111111-1111-4111-8111-111111111111&from=2026-09-01&to=2026-09-30');
    await screen.findByTestId('live-kpi-leads');
    expect(api.results).toHaveBeenCalledWith({ campaignId: '11111111-1111-4111-8111-111111111111', from: '2026-09-01', to: '2026-09-30' });
    expect(screen.getByRole('link', { name: 'Ver resultados de Campanha real' }).getAttribute('href')).toBe('/marketing-ops/campaigns/11111111-1111-4111-8111-111111111111?from=2026-09-01&to=2026-09-30');
  });
});
