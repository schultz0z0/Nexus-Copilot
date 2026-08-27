// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type { MarketingOpsResult, MarketingOpsTimelineEvent } from '@/lib/marketingOps/types';
import { TimelinePanel } from './TimelinePanel';

const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const result = <T,>(
  data: T,
  nextCursor: string | null = null
): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-timeline',
  etag: null,
  page: { limit: 2, count: Array.isArray(data) ? data.length : 1, nextCursor }
});

const event = (
  id: string,
  action: string,
  overrides: Partial<MarketingOpsTimelineEvent> = {}
): MarketingOpsTimelineEvent => ({
  id,
  action,
  occurredAt: '2026-07-14T12:00:00.000Z',
  actor: { displayName: 'Marina Souza' },
  origin: 'rest',
  changes: [{ field: 'status', kind: 'changed' }],
  correlationId: '55555555-5555-4555-8555-555555555555',
  ...overrides
});

function renderPanel(client: MarketingOpsClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TimelinePanel campaignId={campaignId} client={client} pageSize={2} />
    </QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe('TimelinePanel', () => {
  it('localizes allowlisted activity and never renders raw actions or payload-like text', async () => {
    const client = {
      listTimeline: vi.fn().mockResolvedValue(result([
        event('66666666-6666-4666-8666-666666666666', 'campaign.status_changed'),
        event('77777777-7777-4777-8777-777777777777', 'secret-action:token=forbidden', {
          changes: [{ field: 'unknown:token=forbidden', kind: 'changed' }]
        })
      ]))
    } as unknown as MarketingOpsClient;
    renderPanel(client);

    expect(await screen.findByText('Status da campanha alterado')).toBeTruthy();
    expect(screen.getByText('Campanha atualizada')).toBeTruthy();
    expect(screen.getByText(/status alterado/i)).toBeTruthy();
    expect(screen.queryByText(/token=/i)).toBeNull();
  });

  it('appends the next cursor page and exposes loading, empty and retry states', async () => {
    const user = userEvent.setup();
    const listTimeline = vi.fn()
      .mockResolvedValueOnce(result([
        event('66666666-6666-4666-8666-666666666666', 'campaign.created')
      ], 'cursor-next'))
      .mockResolvedValueOnce(result([
        event('77777777-7777-4777-8777-777777777777', 'material.linked')
      ]));
    renderPanel({ listTimeline } as unknown as MarketingOpsClient);

    expect(await screen.findByText('Campanha criada')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /carregar mais atividades/i }));
    expect(await screen.findByText('Material vinculado')).toBeTruthy();
    expect(listTimeline).toHaveBeenLastCalledWith(campaignId, { limit: 2, cursor: 'cursor-next' });

    cleanup();
    renderPanel({ listTimeline: vi.fn().mockResolvedValue(result([])) } as unknown as MarketingOpsClient);
    expect(await screen.findByText(/nenhuma atividade registrada/i)).toBeTruthy();

    cleanup();
    const retry = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(result([]));
    renderPanel({ listTimeline: retry } as unknown as MarketingOpsClient);
    await user.click(await screen.findByRole('button', { name: /tentar novamente/i }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(2));
  });
});
