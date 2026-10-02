// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceWorkbench } from './WorkspaceWorkbench';
import type { WorkspaceClient, WorkspaceService } from '@/lib/marketingOps/workspace';
afterEach(cleanup);
it('reports service navigation to its dashboard and follows back/forward selection', async () => {
  const api = { connections: vi.fn().mockResolvedValue({ data: [] }) } as unknown as WorkspaceClient;
  const onServiceChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (service: WorkspaceService) => <QueryClientProvider client={client}><MemoryRouter><WorkspaceWorkbench api={api} canManage={false} service={service} onServiceChange={onServiceChange} /></MemoryRouter></QueryClientProvider>;
  const { rerender } = render(view('google_drive'));
  const select = screen.getByLabelText('Serviço de trabalho') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'google_sheets' } });
  expect(onServiceChange).toHaveBeenCalledWith('google_sheets');
  rerender(view('google_calendar'));
  expect(select.value).toBe('google_calendar');
});
