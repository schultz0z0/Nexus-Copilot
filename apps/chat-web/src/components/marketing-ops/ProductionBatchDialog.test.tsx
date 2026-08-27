// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type {
  MarketingOpsProductionScheduleItem,
  MarketingOpsResult
} from '@/lib/marketingOps/types';
import { ProductionBatchDialog } from './ProductionBatchDialog';

const actorId = '11111111-1111-4111-8111-111111111111';
const item = (
  id: string,
  title: string,
  version: number
): MarketingOpsProductionScheduleItem => ({
  id,
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  campaignName: 'Campanha',
  kind: 'task',
  title,
  content: null,
  status: 'ready',
  assigneeUserId: actorId,
  priority: 'normal',
  channel: null,
  description: null,
  startsAt: '2026-08-01T12:00:00.000Z',
  dueAt: '2026-08-02T12:00:00.000Z',
  metadata: {},
  version,
  createdBy: actorId,
  updatedBy: actorId,
  createdAt: '2026-07-19T12:00:00.000Z',
  updatedAt: '2026-07-19T12:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
  effectiveAt: '2026-08-01T12:00:00.000Z',
  isOverdue: false,
  isBlocked: false
});

const first = item('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Primeiro item', 2);
const second = item('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Segundo item', 4);
const result = <T,>(data: T): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-batch',
  etag: null
});

function renderDialog(client: MarketingOpsClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductionBatchDialog
        open
        selectedItems={[first, second]}
        timeZone="America/Sao_Paulo"
        client={client}
        createIdempotencyKey={() => 'idem-batch-ui'}
        onOpenChange={vi.fn()}
        onComplete={vi.fn()}
      />
    </QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe('ProductionBatchDialog', () => {
  it('submits observed versions and keeps partial failures explicit', async () => {
    const executeProductionBatch = vi.fn().mockResolvedValue(result({
      results: [
        { itemId: first.id, ok: true, item: { ...first, priority: 'urgent', version: 3 } },
        {
          itemId: second.id,
          ok: false,
          error: {
            code: 'version_conflict',
            status: 409,
            message: 'Production item version is stale',
            currentVersion: 5
          }
        }
      ],
      succeeded: 1,
      failed: 1
    }));
    const client = { executeProductionBatch } as unknown as MarketingOpsClient;
    const user = userEvent.setup();
    renderDialog(client);

    expect(screen.getByText(/2 itens selecionados/)).toBeTruthy();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Ação em lote' }),
      'priority'
    );
    await user.selectOptions(screen.getByLabelText('Nova prioridade'), 'urgent');
    await user.click(screen.getByRole('button', { name: /aplicar em 2 itens/i }));

    await waitFor(() => expect(executeProductionBatch).toHaveBeenCalledWith({
      items: [
        { itemId: first.id, version: 2 },
        { itemId: second.id, version: 4 }
      ],
      action: { type: 'priority', priority: 'urgent' }
    }, 'idem-batch-ui'));
    expect(await screen.findByText('1 atualizado')).toBeTruthy();
    expect(screen.getByText('1 falhou')).toBeTruthy();
    expect(screen.getByText(/versão atual 5/i)).toBeTruthy();
  });

  it('converts rescheduling from the tenant timezone and exposes reassignment', async () => {
    const executeProductionBatch = vi.fn().mockResolvedValue(result({
      results: [],
      succeeded: 2,
      failed: 0
    }));
    const client = { executeProductionBatch } as unknown as MarketingOpsClient;
    const user = userEvent.setup();
    renderDialog(client);

    const action = screen.getByRole('combobox', { name: 'Ação em lote' });
    await user.selectOptions(action, 'reassign');
    expect(screen.getByLabelText('Novo responsável')).toBeTruthy();
    await user.selectOptions(action, 'reschedule');
    fireEvent.change(screen.getByLabelText('Novo início'), {
      target: { value: '2026-08-10T09:00' }
    });
    fireEvent.change(screen.getByLabelText('Novo prazo'), {
      target: { value: '2026-08-10T10:00' }
    });
    await user.click(screen.getByRole('button', { name: /aplicar em 2 itens/i }));

    await waitFor(() => expect(executeProductionBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        action: {
          type: 'reschedule',
          startsAt: '2026-08-10T12:00:00.000Z',
          dueAt: '2026-08-10T13:00:00.000Z'
        }
      }),
      'idem-batch-ui'
    ));
  });
});
