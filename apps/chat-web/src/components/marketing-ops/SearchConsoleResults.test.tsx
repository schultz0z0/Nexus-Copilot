// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchConsoleResults } from './SearchConsoleResults';
import type { WorkspaceClient, WorkspaceConnection } from '@/lib/marketingOps/workspace';
afterEach(cleanup);
it('uses the dashboard period and shares a saved report without querying the provider', async () => {
  const report = { from: '2026-09-01', to: '2026-09-07', totals: null, daily: [], pages: [], queries: [], truncated: false };
  const api = { report: vi.fn().mockResolvedValue({ data: report }), syncReport: vi.fn() } as unknown as WorkspaceClient;
  const onReport = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SearchConsoleResults connection={{ generation: 1, status: 'connected', version: 1, selectedResource: { id: 'site', name: 'Site' } } as WorkspaceConnection} canManage={false} api={api} period={{ from: '2026-09-01', to: '2026-09-07' }} embedded onReport={onReport} /></QueryClientProvider>);
  await screen.findByText(/Ainda não há leitura salva/);
  expect(api.report).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-07' });
  await waitFor(() => expect(onReport).toHaveBeenCalledWith(report));
  expect(api.syncReport).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('De')).toBeNull();
});

it('fills default dates when the hub supplies blank or a single-bound filter', async () => {
  const api = { report: vi.fn().mockResolvedValue({ data: { totals: null, daily: [], pages: [], queries: [] } }) } as unknown as WorkspaceClient;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = { generation: 1, status: 'connected', selectedResource: { id: 'site', name: 'Site' } } as WorkspaceConnection;
  const view = (period: { from?: string; to?: string }) => <QueryClientProvider client={qc}><SearchConsoleResults connection={connection} canManage={false} api={api} period={period} embedded /></QueryClientProvider>;
  const { rerender } = render(view({}));
  await waitFor(() => expect(api.report).toHaveBeenCalled());
  const first = (api.report as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(first.from).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(first.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  rerender(view({ to: '2026-09-30' }));
  await waitFor(() => expect(api.report).toHaveBeenCalledWith({ from: first.from, to: '2026-09-30' }));
});

it('clears the shared report when another period fails instead of retaining old insights', async () => {
  const previous = { totals: null, daily: [], pages: [], queries: [], from: '2026-09-01', to: '2026-09-07' };
  const api = { report: vi.fn().mockResolvedValueOnce({ data: previous }).mockRejectedValueOnce(new Error('Leitura indisponível')) } as unknown as WorkspaceClient;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const onReport = vi.fn();
  const connection = { generation: 1, status: 'connected', selectedResource: { id: 'site', name: 'Site' } } as WorkspaceConnection;
  const view = (from: string) => <QueryClientProvider client={qc}><SearchConsoleResults connection={connection} canManage={false} api={api} period={{ from, to: '2026-09-07' }} embedded onReport={onReport} /></QueryClientProvider>;
  const { rerender } = render(view('2026-09-01'));
  await waitFor(() => expect(onReport).toHaveBeenCalledWith(previous)); onReport.mockClear();
  rerender(view('2026-09-02'));
  await screen.findByRole('alert');
  await waitFor(() => expect(onReport).toHaveBeenLastCalledWith(null));
});
