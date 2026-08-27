// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type { MarketingOpsProductionScheduleItem, MarketingOpsResult } from '@/lib/marketingOps/types';
import ProductionMonthPage from './ProductionMonthPage';

const result = <T,>(data: T): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-month',
  etag: null,
  page: { limit: 100, count: Array.isArray(data) ? data.length : 1, nextCursor: null },
  meta: { timeZone: 'America/Sao_Paulo' }
});

const monthItem: MarketingOpsProductionScheduleItem = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  campaignName: 'Campanha anual',
  kind: 'milestone',
  title: 'Marco de dezembro',
  content: null,
  status: 'draft',
  assigneeUserId: null,
  priority: 'normal',
  channel: null,
  description: null,
  startsAt: '2026-12-31T12:00:00.000Z',
  dueAt: null,
  metadata: {},
  version: 1,
  createdBy: '11111111-1111-4111-8111-111111111111',
  updatedBy: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T12:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
  effectiveAt: '2026-12-31T12:00:00.000Z',
  isOverdue: false,
  isBlocked: false
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

afterEach(() => cleanup());

describe('ProductionMonthPage', () => {
  it('queries one calendar month, renders overflow-safe cells and advances into January', async () => {
    const listProductionSchedule = vi.fn().mockResolvedValue(result([monthItem]));
    const client = {
      listProductionSchedule,
      listCampaigns: vi.fn().mockResolvedValue(result([]))
    } as unknown as MarketingOpsClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={['/marketing-ops/production/month?date=2026-12-15&priority=normal']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <Routes>
            <Route
              path="/marketing-ops/production/month"
              element={<ProductionMonthPage client={client} canWrite={false} />}
            />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findAllByText('Marco de dezembro')).toHaveLength(2);
    expect(listProductionSchedule).toHaveBeenCalledWith(expect.objectContaining({
      from: '2026-12-01T03:00:00.000Z',
      to: '2027-01-01T03:00:00.000Z',
      priority: 'normal',
      limit: 100
    }));
    expect(screen.getByRole('grid', { name: /calendário mensal/i })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /próximo mês/i }));
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toContain('date=2027-01-01');
      expect(screen.getByTestId('location').textContent).toContain('priority=normal');
    });
  });
});
