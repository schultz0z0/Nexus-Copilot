// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardAnalyticsPanel } from './DashboardAnalyticsPanel';
import { defaultAnalyticsPeriod, type AnalyticsClient } from '@/lib/marketingOps/analytics';
vi.mock('./WebAnalyticsResults', () => ({ WebAnalyticsResults: () => <p>Leitura salva</p> }));
afterEach(cleanup);
const mount = (api: AnalyticsClient, props: { organic?: boolean; campaignId?: string; provider: 'ga4' | 'clarity' }) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><DashboardAnalyticsPanel {...props} period={{ from: '2026-01-01', to: '2026-09-30' }} canRead canWrite api={api} /></MemoryRouter></QueryClientProvider>);
it('keeps Clarity campaign snapshots independent of a long commercial period', async () => {
  const api = { connections: vi.fn().mockResolvedValue({ data: [
    { provider: 'ga4', selectedResourceId: 'property', resources: [{ id: 'property', name: 'Site', timeZone: 'America/Sao_Paulo' }] },
    { provider: 'clarity', selectedResourceId: 'project', resources: [{ id: 'project', name: 'Clarity', timeZone: 'UTC' }] },
  ] }), campaignResults: vi.fn().mockResolvedValue({ data: {} }), sync: vi.fn() } as unknown as AnalyticsClient;
  mount(api, { provider: 'clarity', campaignId: '11111111-1111-4111-8111-111111111111' });
  await waitFor(() => expect(api.campaignResults).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', defaultAnalyticsPeriod('America/Sao_Paulo')));
  expect(await screen.findByText(/Última janela móvel de 24 horas/)).toBeTruthy();
  expect(api.sync).not.toHaveBeenCalled();
});
it('does not read or synchronize GA4 for an invalid closed-date range', async () => {
  const api = { connections: vi.fn().mockResolvedValue({ data: [{ provider: 'ga4', selectedResourceId: 'property', resources: [{ id: 'property', name: 'Site', timeZone: 'UTC' }] }] }), results: vi.fn(), sync: vi.fn() } as unknown as AnalyticsClient;
  mount(api, { provider: 'ga4', organic: true });
  expect((await screen.findByRole('alert')).textContent).toContain('Escolha até 30 dias completos');
  expect(api.results).not.toHaveBeenCalled(); expect(api.sync).not.toHaveBeenCalled();
});
