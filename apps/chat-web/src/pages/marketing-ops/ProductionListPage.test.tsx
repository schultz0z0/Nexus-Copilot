// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MarketingOpsApiError, type MarketingOpsClient } from '@/lib/marketingOps/client';
import type {
  MarketingOpsCampaignSummary,
  MarketingOpsProductionItem,
  MarketingOpsProductionScheduleItem,
  MarketingOpsResult
} from '@/lib/marketingOps/types';
import ProductionListPage from './ProductionListPage';

type Client = MarketingOpsClient;

const actorId = '11111111-1111-4111-8111-111111111111';
const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const result = <T,>(data: T, nextCursor: string | null = null): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-production',
  etag: null,
  page: { limit: 25, count: Array.isArray(data) ? data.length : 1, nextCursor },
  meta: { timeZone: 'America/Sao_Paulo' }
});

const item = (
  overrides: Partial<MarketingOpsProductionScheduleItem> = {}
): MarketingOpsProductionScheduleItem => ({
  id: itemId,
  tenantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  campaignId,
  campaignName: 'Campanha de Inverno',
  kind: 'email',
  title: 'Disparo de abertura',
  content: null,
  status: 'ready',
  assigneeUserId: actorId,
  priority: 'urgent',
  channel: 'email',
  description: null,
  startsAt: '2026-07-20T12:00:00.000Z',
  dueAt: '2026-07-20T15:00:00.000Z',
  metadata: {},
  version: 2,
  createdBy: actorId,
  updatedBy: actorId,
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T13:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
  effectiveAt: '2026-07-20T12:00:00.000Z',
  isOverdue: true,
  isBlocked: true,
  ...overrides
});

const campaign = (): MarketingOpsCampaignSummary => ({
  id: campaignId,
  tenantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  name: 'Campanha de Inverno',
  courseSlug: null,
  objective: null,
  referenceType: null,
  referenceKey: null,
  referenceTitleSnapshot: null,
  referenceDocumentId: null,
  referenceVerifiedAt: null,
  audience: null,
  startsOn: null,
  endsOn: null,
  primaryChannel: null,
  secondaryChannels: [],
  briefing: null,
  notes: null,
  status: 'planned',
  version: 1,
  createdBy: actorId,
  updatedBy: actorId,
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T12:00:00.000Z',
  archivedAt: null,
  responsibles: [],
  attention: []
});

function makeClient(overrides: Partial<Client> = {}): Client {
  const current = item();
  return {
    listProductionSchedule: vi.fn().mockResolvedValue(result([])),
    listCampaigns: vi.fn().mockResolvedValue(result([campaign()])),
    getProductionItem: vi.fn().mockResolvedValue(result(current as MarketingOpsProductionItem)),
    createProductionItem: vi.fn().mockResolvedValue(result(current as MarketingOpsProductionItem)),
    updateProductionItem: vi.fn().mockResolvedValue(result(current as MarketingOpsProductionItem)),
    transitionProductionItem: vi.fn().mockResolvedValue(result({
      ...current,
      status: 'in_review',
      version: 3
    } as MarketingOpsProductionItem)),
    listInAppNotifications: vi.fn().mockResolvedValue(result([])),
    markInAppNotificationsRead: vi.fn().mockResolvedValue(result([])),
    listParticipants: vi.fn().mockResolvedValue(result([])),
    listContentAssets: vi.fn().mockResolvedValue(result([{
      id: assetId,
      itemId,
      campaignId,
      assetKind: 'copy',
      title: 'Draft copy',
      currentVersionNumber: 1,
      version: 1,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: '2026-07-18T12:00:00.000Z',
      updatedAt: '2026-07-18T12:00:00.000Z'
    }])),
    listContentVersions: vi.fn().mockResolvedValue(result([{
      assetId,
      versionNumber: 1,
      body: 'Draft body',
      metadata: { source: 'chat' },
      contentHash: 'a'.repeat(64),
      createdBy: actorId,
      createdAt: '2026-07-18T12:00:00.000Z',
      frozenAt: null
    }])),
    createContentVersion: vi.fn(),
    executeProductionBatch: vi.fn().mockResolvedValue(result({
      results: [],
      succeeded: 0,
      failed: 0
    })),
    ...overrides
  } as unknown as Client;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(
  client: Client,
  initialEntry = '/marketing-ops/production',
  canBatch = false,
  canWrite = true
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
        <Routes>
          <Route
            path="/marketing-ops/production"
            element={<ProductionListPage client={client} canWrite={canWrite} canBatch={canBatch} createIdempotencyKey={() => 'idem-ui'} />}
          />
          <Route
            path="/marketing-ops/production/items/:itemId"
            element={<ProductionListPage client={client} canWrite={canWrite} canBatch={canBatch} createIdempotencyKey={() => 'idem-ui'} />}
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe('ProductionListPage', () => {
  it('exposes batch selection only when the caller has manager authority', async () => {
    const current = item();
    const client = makeClient({
      listProductionSchedule: vi.fn().mockResolvedValue(result([current]))
    });
    const user = userEvent.setup();
    const view = renderPage(client);

    await screen.findAllByText(current.title);
    expect(screen.queryByRole('button', { name: /lote \(0\)/i })).toBeNull();
    view.unmount();

    renderPage(client, '/marketing-ops/production', true);
    await screen.findAllByText(current.title);
    await user.click(screen.getAllByRole('checkbox', {
      name: `Selecionar ${current.title}`
    })[0]!);
    await user.click(screen.getByRole('button', { name: /lote \(1\)/i }));
    expect(await screen.findByRole('dialog', { name: /ação em lote/i })).toBeTruthy();
  });

  it('uses URL filters, exposes operational states and appends cursor pages', async () => {
    const first = item();
    const second = item({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      title: 'Marco sem data',
      kind: 'milestone',
      effectiveAt: null,
      startsAt: null,
      dueAt: null,
      isOverdue: false,
      isBlocked: false
    });
    const listProductionSchedule = vi.fn()
      .mockResolvedValueOnce(result([first], 'next-production-page'))
      .mockResolvedValueOnce(result([second]));
    const client = makeClient({ listProductionSchedule });
    const user = userEvent.setup();
    renderPage(client, '/marketing-ops/production?status=ready&priority=urgent&kind=email');

    expect(await screen.findAllByText('Disparo de abertura')).toHaveLength(2);
    expect(screen.getAllByText('Em atraso')).toHaveLength(2);
    expect(screen.getAllByText('Bloqueado')).toHaveLength(2);
    expect(listProductionSchedule).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ready',
      priority: 'urgent',
      kind: 'email',
      limit: 25
    }));

    await user.click(screen.getByRole('button', { name: /carregar mais/i }));
    expect(await screen.findAllByText('Marco sem data')).toHaveLength(2);
    expect(screen.getAllByText('Sem data').length).toBeGreaterThanOrEqual(1);
    expect(listProductionSchedule).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: 'next-production-page'
    }));

    await user.selectOptions(screen.getByLabelText(/^status$/i), 'completed');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('status=completed'));
  });

  it('creates a draft with an explicit tenant timezone and preserves the canonical fields', async () => {
    const createProductionItem = vi.fn().mockResolvedValue(result(item() as MarketingOpsProductionItem));
    const client = makeClient({ createProductionItem });
    const user = userEvent.setup();
    renderPage(client);

    await screen.findByText('Nenhum item de produção ainda');
    await user.click(screen.getAllByRole('button', { name: /novo item/i })[0]);
    const dialog = screen.getByRole('dialog', { name: /novo item/i });
    expect(within(dialog).getAllByText(/America\/Sao_Paulo/)).toHaveLength(3);
    await user.selectOptions(within(dialog).getByLabelText(/^campanha$/i), campaignId);
    await user.clear(within(dialog).getByLabelText(/^título$/i));
    await user.type(within(dialog).getByLabelText(/^título$/i), 'Novo e-mail');
    await user.selectOptions(within(dialog).getByLabelText(/^tipo$/i), 'email');
    await user.selectOptions(within(dialog).getByLabelText(/^prioridade$/i), 'high');
    await user.click(within(dialog).getByRole('button', { name: /criar item/i }));

    await waitFor(() => expect(createProductionItem).toHaveBeenCalledWith({
      campaignId,
      title: 'Novo e-mail',
      kind: 'email',
      priority: 'high',
      assigneeUserId: null,
      channel: null,
      description: null,
      startsAt: null,
      dueAt: null,
      metadata: {}
    }, 'idem-ui'));
  });

  it('opens a deep link, edits scheduling and performs an allowed transition', async () => {
    const updated = item({ title: 'Disparo revisado', version: 3 });
    const updateProductionItem = vi.fn().mockResolvedValue(result(updated as MarketingOpsProductionItem));
    const transitionProductionItem = vi.fn().mockResolvedValue(result({
      ...updated,
      status: 'in_review',
      version: 4
    } as MarketingOpsProductionItem));
    const client = makeClient({ updateProductionItem, transitionProductionItem });
    const user = userEvent.setup();
    renderPage(client, `/marketing-ops/production/items/${itemId}?priority=urgent`);

    const dialog = await screen.findByRole('dialog', { name: /detalhes do item/i });
    const title = await within(dialog).findByLabelText(/^título$/i);
    const dueAt = within(dialog).getByLabelText(/^prazo \(America\/Sao_Paulo\)$/i);
    await user.clear(title);
    await user.type(title, 'Disparo revisado');
    fireEvent.change(dueAt, { target: { value: '2026-07-26T16:30' } });
    await user.click(within(dialog).getByRole('button', { name: /salvar alterações/i }));
    await waitFor(() => expect(updateProductionItem).toHaveBeenCalledWith(
      itemId,
      2,
      expect.objectContaining({
        title: 'Disparo revisado',
        dueAt: '2026-07-26T19:30:00.000Z'
      }),
      'idem-ui'
    ));

    await user.click(within(dialog).getByRole('button', { name: /enviar para revisão/i }));
    await waitFor(() => expect(transitionProductionItem).toHaveBeenCalledWith(
      itemId,
      3,
      'in_review',
      'idem-ui'
    ));
  });

  it('opens the exact content asset from a frozen deep link and rejects invalid routes', async () => {
    const view = renderPage(
      makeClient(),
      `/marketing-ops/production/items/${itemId}?contentAssetId=${assetId}`
    );
    const dialog = await screen.findByRole('dialog', { name: /detalhes do item/i });
    expect((await within(dialog).findByRole('region', { name: /conteúdo selecionado/i })).textContent)
      .toContain('Draft copy');
    view.unmount();

    renderPage(makeClient(), '/marketing-ops/production/items/not-a-uuid');
    expect((await screen.findByRole('alert')).textContent).toContain('Deep link inválido');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('creates an immutable frozen copy of the selected current version', async () => {
    const createContentVersion = vi.fn().mockResolvedValue(result({
      assetId,
      versionNumber: 2,
      body: 'Draft body',
      metadata: { source: 'chat' },
      contentHash: 'b'.repeat(64),
      createdBy: actorId,
      createdAt: '2026-08-21T19:00:00.000Z',
      frozenAt: '2026-08-21T19:00:00.000Z',
      assetVersion: 2
    }));
    const client = makeClient({ createContentVersion });
    const user = userEvent.setup();
    renderPage(client, `/marketing-ops/production/items/${itemId}?contentAssetId=${assetId}`);

    const dialog = await screen.findByRole('dialog', { name: /detalhes do item/i });
    expect(await within(dialog).findByText(/versão 1.*rascunho/i)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /criar versão congelada/i }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: /confirmar congelamento/i }));

    await waitFor(() => expect(createContentVersion).toHaveBeenCalledWith(
      assetId,
      1,
      { body: 'Draft body', metadata: { source: 'chat' }, freeze: true },
      'idem-ui'
    ));
  });

  it('does not expose freezing for an already frozen version or a read-only caller', async () => {
    const frozenClient = makeClient({
      listContentVersions: vi.fn().mockResolvedValue(result([{
        assetId,
        versionNumber: 1,
        body: 'Frozen body',
        metadata: { source: 'chat' },
        contentHash: 'a'.repeat(64),
        createdBy: actorId,
        createdAt: '2026-07-18T12:00:00.000Z',
        frozenAt: '2026-07-18T12:05:00.000Z'
      }]))
    });
    const frozenView = renderPage(
      frozenClient,
      `/marketing-ops/production/items/${itemId}?contentAssetId=${assetId}`
    );

    const frozenDialog = await screen.findByRole('dialog', { name: /detalhes do item/i });
    expect(await within(frozenDialog).findByText(/versão 1.*congelada/i)).toBeTruthy();
    expect(within(frozenDialog).queryByRole('button', { name: /criar versão congelada/i })).toBeNull();
    frozenView.unmount();

    renderPage(
      makeClient(),
      `/marketing-ops/production/items/${itemId}?contentAssetId=${assetId}`,
      false,
      false
    );
    const readOnlyDialog = await screen.findByRole('dialog', { name: /detalhes do item/i });
    expect(await within(readOnlyDialog).findByText(/versão 1.*rascunho/i)).toBeTruthy();
    expect(within(readOnlyDialog).queryByRole('button', { name: /criar versão congelada/i })).toBeNull();
  });

  it('requires confirmation and does not freeze when the caller cancels', async () => {
    const createContentVersion = vi.fn();
    const user = userEvent.setup();
    renderPage(
      makeClient({ createContentVersion }),
      `/marketing-ops/production/items/${itemId}?contentAssetId=${assetId}`
    );

    const dialog = await screen.findByRole('dialog', { name: /detalhes do item/i });
    await within(dialog).findByText(/versão 1.*rascunho/i);
    await user.click(within(dialog).getByRole('button', { name: /criar versão congelada/i }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: /cancelar/i }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(createContentVersion).not.toHaveBeenCalled();
  });

  it('shows a reload affordance on freeze conflict without retrying automatically', async () => {
    const createContentVersion = vi.fn().mockRejectedValue(new MarketingOpsApiError(
      'version_conflict', 409, 'Versão desatualizada', 'corr-freeze-conflict', { currentVersion: 2 }
    ));
    const user = userEvent.setup();
    renderPage(
      makeClient({ createContentVersion }),
      `/marketing-ops/production/items/${itemId}?contentAssetId=${assetId}`
    );

    const dialog = await screen.findByRole('dialog', { name: /detalhes do item/i });
    await within(dialog).findByText(/versão 1.*rascunho/i);
    await user.click(within(dialog).getByRole('button', { name: /criar versão congelada/i }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: /confirmar congelamento/i }));

    expect(await within(dialog).findByText(/atualizada em outra sessão/i)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /recarregar dados/i })).toBeTruthy();
    expect(createContentVersion).toHaveBeenCalledTimes(1);
  });

  it('distinguishes access, missing detail and optimistic conflict failures', async () => {
    const denied = makeClient({
      listProductionSchedule: vi.fn().mockRejectedValue(new MarketingOpsApiError(
        'forbidden', 403, 'Acesso negado', 'corr-denied'
      ))
    });
    const { unmount } = renderPage(denied);
    expect((await screen.findByRole('alert')).textContent).toContain('Acesso não autorizado');
    expect(screen.getByRole('alert').textContent).toContain('corr-denied');
    unmount();

    const missing = makeClient({
      getProductionItem: vi.fn().mockRejectedValue(new MarketingOpsApiError(
        'not_found', 404, 'Item ausente', 'corr-missing'
      ))
    });
    const missingRender = renderPage(missing, `/marketing-ops/production/items/${itemId}`);
    expect((await screen.findByRole('dialog')).textContent).toContain('Item não encontrado');
    missingRender.unmount();

    const conflict = makeClient({
      updateProductionItem: vi.fn().mockRejectedValue(new MarketingOpsApiError(
        'version_conflict', 409, 'Versão desatualizada', 'corr-conflict', { currentVersion: 7 }
      ))
    });
    renderPage(conflict, `/marketing-ops/production/items/${itemId}`);
    const dialog = await screen.findByRole('dialog');
    await userEvent.setup().click(await within(dialog).findByRole('button', { name: /salvar alterações/i }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('versão 7');
    expect(within(dialog).getByRole('button', { name: /recarregar dados/i })).toBeTruthy();
  });
});
