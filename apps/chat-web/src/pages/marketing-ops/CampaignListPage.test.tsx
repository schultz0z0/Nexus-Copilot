// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MarketingOpsApiError, type MarketingOpsClient } from '@/lib/marketingOps/client';
import type { MarketingOpsCampaignSummary, MarketingOpsResult } from '@/lib/marketingOps/types';
import CampaignListPage from './CampaignListPage';

type Client = MarketingOpsClient;

const campaign = (id: string, name: string): MarketingOpsCampaignSummary => ({
  id,
  tenantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  name,
  courseSlug: null,
  objective: null,
  referenceType: 'course',
  referenceKey: 'curso-1',
  referenceTitleSnapshot: 'Gestão de Seguros',
  referenceDocumentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  referenceVerifiedAt: '2026-07-14T12:00:00.000Z',
  audience: null,
  startsOn: '2026-07-20',
  endsOn: '2026-08-20',
  primaryChannel: 'email',
  secondaryChannels: ['linkedin'],
  briefing: null,
  notes: null,
  status: 'planned',
  version: 3,
  createdBy: '11111111-1111-4111-8111-111111111111',
  updatedBy: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-07-14T12:00:00.000Z',
  updatedAt: '2026-07-14T13:00:00.000Z',
  archivedAt: null,
  responsibles: [{
    userId: '11111111-1111-4111-8111-111111111111',
    displayName: 'Ana Lima',
    isPrimary: true
  }],
  attention: []
});

const result = <T,>(data: T, nextCursor: string | null = null): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-list',
  etag: null,
  page: { limit: 25, count: Array.isArray(data) ? data.length : 1, nextCursor }
});

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    listCampaigns: vi.fn().mockResolvedValue(result([])),
    createCampaign: vi.fn().mockResolvedValue(result(campaign(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'Lançamento'
    ))),
    ...overrides
  } as unknown as Client;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(
  client: Client,
  initialEntry = '/marketing-ops/campaigns',
  searchDebounceMs = 0
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[initialEntry]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <CampaignListPage
          client={client}
          canWrite
          searchDebounceMs={searchDebounceMs}
          createIdempotencyKey={() => 'idem-create'}
        />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe('CampaignListPage', () => {
  it('syncs filters to the URL and opens the created campaign', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    renderPage(client);

    expect(await screen.findByText('Nenhuma campanha ainda')).toBeTruthy();
    await user.type(screen.getByRole('searchbox', { name: /buscar campanhas/i }), 'gestão');
    await user.selectOptions(screen.getByLabelText(/^status$/i), 'planned');

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toContain('q=gest%C3%A3o');
      expect(screen.getByTestId('location').textContent).toContain('status=planned');
    });

    await user.click(screen.getAllByRole('button', { name: /nova campanha/i })[0]);
    await user.type(screen.getByLabelText(/^nome$/i), 'Lançamento');
    await user.click(screen.getByRole('button', { name: /^criar$/i }));

    await waitFor(() => expect(screen.getByTestId('location').textContent)
      .toBe('/marketing-ops/campaigns/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    expect(screen.queryByRole('dialog', { name: /nova campanha/i })).toBeNull();
    expect(client.createCampaign).toHaveBeenCalledWith({ name: 'Lançamento' }, 'idem-create');
  });

  it('commits a pending search atomically when another filter changes', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    renderPage(client, '/marketing-ops/campaigns', 60_000);

    expect(await screen.findByText('Nenhuma campanha ainda')).toBeTruthy();
    await user.type(screen.getByRole('searchbox', { name: /buscar campanhas/i }), 'gestão');
    expect(screen.getByTestId('location').textContent).toBe('/marketing-ops/campaigns');

    await user.selectOptions(screen.getByLabelText(/^status$/i), 'planned');

    await waitFor(() => expect(screen.getByTestId('location').textContent)
      .toBe('/marketing-ops/campaigns?q=gest%C3%A3o&status=planned'));
  });

  it('loads the next cursor page without replacing visible campaigns', async () => {
    const first = campaign('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Campanha A');
    const second = campaign('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Campanha B');
    const listCampaigns = vi.fn()
      .mockResolvedValueOnce(result([first], 'next-page'))
      .mockResolvedValueOnce(result([second]));
    const client = makeClient({ listCampaigns });
    const user = userEvent.setup();
    renderPage(client);

    expect(await screen.findAllByText('Campanha A')).toHaveLength(2);
    expect(screen.getByRole('cell', { name: 'E-mail' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /carregar mais/i }));
    expect(await screen.findAllByText('Campanha B')).toHaveLength(2);
    expect(screen.getAllByText('Campanha A')).toHaveLength(2);
    expect(listCampaigns).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next-page' }));
  });

  it('distinguishes filtered empty state and exposes the correlation id on failure', async () => {
    const emptyClient = makeClient();
    const { unmount } = renderPage(emptyClient, '/marketing-ops/campaigns?status=archived');
    expect(await screen.findByText('Nenhuma campanha encontrada')).toBeTruthy();
    unmount();

    const error = Object.assign(new Error('Falha'), { correlationId: 'corr-failure' });
    const failedClient = makeClient({ listCampaigns: vi.fn().mockRejectedValue(error) });
    renderPage(failedClient);
    expect((await screen.findByRole('alert')).textContent).toContain('corr-failure');
  });

  it('keeps the campaign name in the dialog when creation fails', async () => {
    const createCampaign = vi.fn().mockRejectedValue(new MarketingOpsApiError(
      'request_failed',
      503,
      'Serviço indisponível',
      'corr-create'
    ));
    const client = makeClient({ createCampaign });
    const user = userEvent.setup();
    renderPage(client);
    await screen.findByText('Nenhuma campanha ainda');

    await user.click(screen.getAllByRole('button', { name: /nova campanha/i })[0]);
    const nameInput = screen.getByLabelText(/^nome$/i) as HTMLInputElement;
    await user.type(nameInput, 'Campanha preservada');
    await user.click(screen.getByRole('button', { name: /^criar$/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('corr-create');
    expect(nameInput.value).toBe('Campanha preservada');
  });

  it('clears an abandoned name when the creation dialog is reopened', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    renderPage(client);
    await screen.findByText('Nenhuma campanha ainda');

    await user.click(screen.getAllByRole('button', { name: /nova campanha/i })[0]);
    await user.type(screen.getByLabelText(/^nome$/i), 'Rascunho abandonado');
    await user.click(screen.getByRole('button', { name: /cancelar/i }));
    await user.click(screen.getAllByRole('button', { name: /nova campanha/i })[0]);

    expect((screen.getByLabelText(/^nome$/i) as HTMLInputElement).value).toBe('');
  });
});
