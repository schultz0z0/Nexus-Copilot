// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { CampaignWebAnalytics } from './CampaignWebAnalytics';
import type { AnalyticsClient } from '@/lib/marketingOps/analytics';
vi.mock('@/components/dashboard/WebAnalyticsResults', () => ({ WebAnalyticsResults: () => <div>Resultados atribuídos</div> }));
afterEach(cleanup);
it('keeps Clarity accessible after an invalid GA4 date selection', async () => {
  const api = { connections: vi.fn().mockResolvedValue({ data: [] }), links: vi.fn().mockResolvedValue({ data: [] }), campaignResults: vi.fn().mockResolvedValue({ data: { ga4: null, clarity: {} } }) } as unknown as AnalyticsClient;
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CampaignWebAnalytics campaignId="campaign1" canManage api={api} /></MemoryRouter></QueryClientProvider>);
  const user = userEvent.setup(); await screen.findByText(/Ainda não há leitura atribuída/);
  await user.clear(screen.getByLabelText('De'));
  await user.click(screen.getByRole('button', { name: 'Clarity' }));
  await screen.findByText('Resultados atribuídos');
  expect(screen.queryByText(/Escolha até 30 dias completos/)).toBeNull();
});
it('links a campaign only after explicitly entering its exact UTM and confirming', async () => {
  const api = { connections: vi.fn().mockResolvedValue({ data: [{ provider: 'ga4', status: 'connected', version: 2, selectedResourceId: 'properties/1', resources: [{ id: 'properties/1', name: 'Site', timeZone: 'UTC' }] }] }), links: vi.fn().mockResolvedValue({ data: [] }), campaignResults: vi.fn().mockResolvedValue({ data: { ga4: null, clarity: null } }), createLink: vi.fn().mockResolvedValue({ data: {} }) } as unknown as AnalyticsClient;
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CampaignWebAnalytics campaignId="campaign1" canManage api={api} /></MemoryRouter></QueryClientProvider>);
  const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Vincular navegação' }));
  await user.type(screen.getByLabelText('Valor de utm_campaign'), 'oferta_outubro');
  expect(api.createLink).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
  await waitFor(() => expect(api.createLink).toHaveBeenCalledWith('campaign1', { provider: 'ga4', utmCampaign: 'oferta_outubro' }, expect.any(String)));
});
