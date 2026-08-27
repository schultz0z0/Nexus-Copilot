// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type {
  MarketingOpsCampaignSummary,
  MarketingOpsProductionItem,
  MarketingOpsProductionScheduleItem,
  MarketingOpsResult
} from '@/lib/marketingOps/types';
import ProductionWeekPage from './ProductionWeekPage';

const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorId = '11111111-1111-4111-8111-111111111111';

const result = <T,>(data: T): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-calendar',
  etag: null,
  page: { limit: 100, count: Array.isArray(data) ? data.length : 1, nextCursor: null },
  meta: { timeZone: 'America/Sao_Paulo' }
});

const scheduledItem = (): MarketingOpsProductionScheduleItem => ({
  id: itemId,
  tenantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  campaignId,
  campaignName: 'Campanha anual',
  kind: 'email',
  title: 'Disparo da virada',
  content: null,
  status: 'ready',
  assigneeUserId: actorId,
  priority: 'urgent',
  channel: 'email',
  description: null,
  startsAt: '2026-12-31T12:00:00.000Z',
  dueAt: '2026-12-31T15:00:00.000Z',
  metadata: {},
  version: 2,
  createdBy: actorId,
  updatedBy: actorId,
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T13:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
  effectiveAt: '2026-12-31T12:00:00.000Z',
  isOverdue: false,
  isBlocked: false
});

const campaign = (): MarketingOpsCampaignSummary => ({
  id: campaignId,
  tenantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  name: 'Campanha anual',
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

function makeClient() {
  const value = scheduledItem();
  return {
    listProductionSchedule: vi.fn().mockResolvedValue(result([value])),
    listCampaigns: vi.fn().mockResolvedValue(result([campaign()])),
    getProductionItem: vi.fn().mockResolvedValue(result(value as MarketingOpsProductionItem))
  } as unknown as MarketingOpsClient;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage(client: MarketingOpsClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={['/marketing-ops/production/week?date=2026-12-31&status=ready']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route
            path="/marketing-ops/production/week"
            element={<ProductionWeekPage client={client} canWrite={false} />}
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe('ProductionWeekPage', () => {
  it('queries canonical UTC limits, preserves filters and navigates across the year boundary', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    renderPage(client);

    expect(await screen.findAllByText('Disparo da virada')).toHaveLength(2);
    expect(client.listProductionSchedule).toHaveBeenCalledWith(expect.objectContaining({
      from: '2026-12-28T03:00:00.000Z',
      to: '2027-01-04T03:00:00.000Z',
      status: 'ready',
      limit: 100
    }));
    expect(screen.getByRole('region', { name: /lista acessível do período/i })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /próxima semana/i }));
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toContain('date=2027-01-04');
      expect(screen.getByTestId('location').textContent).toContain('status=ready');
    });
  });

  it('opens the shared detail dialog without requiring drag and keeps the calendar URL', async () => {
    const client = makeClient();
    const user = userEvent.setup();
    renderPage(client);

    await screen.findAllByText('Disparo da virada');
    await user.click(screen.getByRole('button', { name: 'Abrir item Disparo da virada' }));
    expect(await screen.findByRole('dialog', { name: /detalhes do item/i })).toBeTruthy();
    expect(screen.getByTestId('location').textContent)
      .toContain('/marketing-ops/production/week?date=2026-12-31');
  });
});
