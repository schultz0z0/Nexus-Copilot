// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { LiveMarketingDashboard } from './LiveMarketingDashboard';
import type { LeadClient, LeadResults } from '@/lib/marketingOps/leads';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type { AnalyticsClient, AnalyticsResults } from '@/lib/marketingOps/analytics';
import type { WorkspaceClient } from '@/lib/marketingOps/workspace';
const role = vi.hoisted(() => ({ value: 'manager' }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ normalizedRole: role.value }) }));
vi.mock('@/components/marketing-ops/WorkspaceWorkbench', () => ({ WorkspaceWorkbench: ({ service, onServiceChange }: { service: string; onServiceChange: (value: string) => void }) => <div>Trabalho: {service}<button onClick={() => onServiceChange('google_gmail')}>Abrir Gmail</button></div> }));
vi.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/marketing-ops/MarketingOpsMobileBar', () => ({ MarketingOpsMobileBar: () => null }));
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, AreaChart: () => null, Area: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, PieChart: () => null, Pie: () => null, Cell: () => null }));
const real: LeadResults = { capturedLeads: 2, contactsCold: 8, whatsappClicks: 7, qualified: null, sales: 0, revenue: 123.45, spend: null, channels: [{ channel: 'meta_ads', leads: 2 }], weekly: [{ week: '2026-09-28', leads: 2 }], campaigns: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Campanha real', capturedLeads: 2, contactsCold: 8, qualified: null, sales: 0, revenue: 123.45, spend: null }], coverage: { sources: 1, reports: 1, partialReportsExcluded: 0, metricReports: { qualified: 0, sales: 1, revenue: 1, spend: 0 } }, lastUpdated: '2026-09-30T10:00:00Z' };
const ops = { listCampaigns: vi.fn().mockResolvedValue({ data: [], page: { nextCursor: null } }) } as unknown as MarketingOpsClient;
const analytics = { connections: vi.fn().mockResolvedValue({ data: [] }), results: vi.fn(), sync: vi.fn(), campaignResults: vi.fn() } as unknown as AnalyticsClient;
const workspace = { connections: vi.fn().mockResolvedValue({ data: [] }), report: vi.fn(), syncReport: vi.fn() } as unknown as WorkspaceClient;
function Location() { const location = useLocation(); return <output data-testid="location">{location.search}</output>; }
function mount(api: LeadClient, url = '/marketing-ops/dashboard') { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[url]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><LiveMarketingDashboard api={api} ops={ops} analytics={analytics} workspace={workspace} /><Location /></MemoryRouter></QueryClientProvider>); }
afterEach(() => { cleanup(); vi.clearAllMocks(); (analytics.connections as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] }); role.value = 'manager'; });
describe('Live dashboard', () => {
  it('uses measured values and preserves unknowns without cold contacts becoming leads', async () => {
    const api = { results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient; mount(api);
    expect((await screen.findByTestId('live-kpi-leads')).textContent).toBe('2');
    expect(screen.getByTestId('live-kpi-sales').textContent).toBe('0');
    expect(screen.getByTestId('live-kpi-spend').textContent).toBe('—');
    expect(screen.queryByText('Crescimento B2B')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ver resultados de Campanha real' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ver demonstração' }).getAttribute('href')).toBe('/marketing-ops/dashboard?mode=demo');
  });
  it('renders source failure as an error rather than an empty success', async () => {
    mount({ results: vi.fn().mockRejectedValue(new Error('Resultados temporariamente indisponíveis')) } as unknown as LeadClient);
    expect((await screen.findByRole('alert')).textContent).toContain('Resultados temporariamente indisponíveis');
    expect(screen.queryByTestId('live-kpi-leads')).toBeNull();
  });
  it('retains the persisted campaign and date scope from the URL', async () => {
    const api = { results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient;
    mount(api, '/marketing-ops/dashboard?tab=campaigns&campaignId=11111111-1111-4111-8111-111111111111&from=2026-09-01&to=2026-09-30');
    await screen.findByTestId('live-kpi-leads');
    expect(api.results).toHaveBeenCalledWith({ campaignId: '11111111-1111-4111-8111-111111111111', from: '2026-09-01', to: '2026-09-30' });
    expect(screen.getByRole('link', { name: 'Ver resultados de Campanha real' }).getAttribute('href')).toBe('/marketing-ops/campaigns/11111111-1111-4111-8111-111111111111?from=2026-09-01&to=2026-09-30');
  });
  it('persists tab navigation and preserves filters while leaving details off the overview', async () => {
    mount({ results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient, '/marketing-ops/dashboard?from=2026-09-01&to=2026-09-30');
    await screen.findByTestId('live-kpi-leads');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Visão geral' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('Indicadores de navegação')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Campanhas' }));
    expect((await screen.findByTestId('location')).textContent).toContain('tab=campaigns');
    expect(screen.getByTestId('location').textContent).toContain('from=2026-09-01');
    expect(await screen.findByRole('link', { name: 'Ver resultados de Campanha real' })).toBeTruthy();
  });
  it('opens the work service directly and persists the chosen service without analytics sync', async () => {
    const api = { results: vi.fn() } as unknown as LeadClient;
    mount(api, '/marketing-ops/dashboard?tab=work&service=google_sheets');
    expect(screen.getByText('Trabalho: google_sheets')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Gmail' }));
    expect(screen.getByTestId('location').textContent).toContain('service=google_gmail');
    expect(api.results).not.toHaveBeenCalled();
    expect(analytics.sync).not.toHaveBeenCalled();
  });
  it('does not query manager-only site analysis for members even with a detail deep link', async () => {
    role.value = 'member';
    mount({ results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient, '/marketing-ops/dashboard?detail=site&provider=ga4');
    expect(await screen.findByText(/disponível para gestores e administradores/)).toBeTruthy();
    expect(analytics.connections).not.toHaveBeenCalled();
    expect(analytics.results).not.toHaveBeenCalled();
  });
  it('clears result filters without losing the selected dashboard tab', async () => {
    mount({ results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient, '/marketing-ops/dashboard?tab=campaigns&from=2026-09-01');
    await screen.findByTestId('live-kpi-leads');
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByTestId('location').textContent).toBe('?tab=campaigns');
  });
  it('does not fetch attributed site analysis until the campaign detail is opened', async () => {
    mount({ results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient, '/marketing-ops/dashboard?tab=campaigns&campaignId=11111111-1111-4111-8111-111111111111');
    await screen.findByTestId('live-kpi-leads');
    expect(screen.getByText('Ver navegação e experiência atribuídas à campanha')).toBeTruthy();
    expect(analytics.connections).not.toHaveBeenCalled();
    expect(analytics.campaignResults).not.toHaveBeenCalled();
  });
  it('reads saved site signals independently of commercial failures without synchronizing providers', async () => {
    (analytics.connections as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [{ provider: 'ga4', status: 'connected', selectedResourceId: '123', resources: [{ id: '123', name: 'Site', timeZone: 'UTC' }] }] });
    const site: AnalyticsResults = { provider: 'ga4', resource: null, from: '2026-09-01', to: '2026-09-30', lastSyncAt: null, totals: { sessions: 42, engagedSessions: 10, pageViews: 50, keyEvents: 0, rageClicks: null, deadClicks: null, scrollDepth: null }, daily: [], channels: [], campaigns: [], warnings: [], stale: false, window: null };
    (analytics.results as ReturnType<typeof vi.fn>).mockResolvedValue({ data: site });
    mount({ results: vi.fn().mockRejectedValue(new Error('Resultados indisponíveis')) } as unknown as LeadClient, '/marketing-ops/dashboard?from=2026-09-01&to=2026-09-30');
    expect(await screen.findByText('Consulte o caminho até o site')).toBeTruthy();
    expect(analytics.results).toHaveBeenCalledWith('ga4', { from: '2026-09-01', to: '2026-09-30' });
    expect(analytics.sync).not.toHaveBeenCalled();
    expect(screen.queryByTestId('live-kpi-leads')).toBeNull();
  });
  it('ignores the campaign filter for whole-site organic cold prospecting', async () => {
    const api = { results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient;
    mount(api, '/marketing-ops/dashboard?tab=organic&campaignId=11111111-1111-4111-8111-111111111111&from=2026-09-01&to=2026-09-30');
    await waitFor(() => expect(api.results).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' }));
  });
  it('does not fetch or render manager-only work and search for members', async () => {
    role.value = 'member';
    mount({ results: vi.fn() } as unknown as LeadClient, '/marketing-ops/dashboard?tab=work&service=google_gmail');
    expect(await screen.findByText(/disponível para gestores e administradores/)).toBeTruthy();
    expect(screen.queryByText('Trabalho: google_gmail')).toBeNull();
    expect(workspace.connections).not.toHaveBeenCalled();
    cleanup();
    mount({ results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient, '/marketing-ops/dashboard?tab=organic');
    await screen.findByText(/disponível para gestores e administradores/);
    expect(workspace.connections).not.toHaveBeenCalled();
    expect(workspace.report).not.toHaveBeenCalled();
  });
  it('does not diagnose campaign attribution before the on-demand measurement is read', async () => {
    mount({ results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient, '/marketing-ops/dashboard?tab=campaigns&campaignId=11111111-1111-4111-8111-111111111111');
    await screen.findByTestId('live-kpi-leads');
    expect(screen.queryByText('Revise a atribuição da navegação')).toBeNull();
  });
  it('returns keyboard focus to the opener after dismissing site analysis', async () => {
    mount({ results: vi.fn().mockResolvedValue({ data: real }) } as unknown as LeadClient);
    const opener = await screen.findByRole('button', { name: 'Análise do site e experiência' });
    await userEvent.click(opener); await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
