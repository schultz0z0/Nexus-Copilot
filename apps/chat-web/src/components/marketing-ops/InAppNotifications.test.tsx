// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type {
  MarketingOpsInAppNotification,
  MarketingOpsResult
} from '@/lib/marketingOps/types';
import { InAppNotifications } from './InAppNotifications';

const notification = (
  overrides: Partial<MarketingOpsInAppNotification> = {}
): MarketingOpsInAppNotification => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  eventKey: 'assignment:item-1',
  notificationType: 'assignment',
  campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  itemId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  approvalRequestId: null,
  label: 'Novo item atribuído',
  payload: {
    campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    itemId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    dueAt: null,
    priority: 'normal'
  },
  occurredAt: '2026-07-19T12:00:00.000Z',
  readAt: null,
  createdAt: '2026-07-19T12:00:00.000Z',
  ...overrides
});

const result = <T,>(data: T): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-notifications',
  etag: null
});

function renderNotifications(client: MarketingOpsClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <InAppNotifications
        client={client}
        canMarkRead
        createIdempotencyKey={() => 'idem-notification-ui'}
      />
    </QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe('InAppNotifications', () => {
  it('opens a safe approval deep link without content or audience data', async () => {
    const approvalRequestId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const approval = notification({
      notificationType: 'approval_review' as never,
      itemId: null as never,
      approvalRequestId,
      label: 'Aprovação aguardando decisão',
      payload: { campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', approvalRequestId } as never
    });
    const onOpenApproval = vi.fn();
    const client = {
      listInAppNotifications: vi.fn().mockResolvedValue(result([approval])),
      markInAppNotificationsRead: vi.fn().mockResolvedValue(result([]))
    } as unknown as MarketingOpsClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={queryClient}>
      <InAppNotifications client={client} onOpenApproval={onOpenApproval} />
    </QueryClientProvider>);
    await user.click(await screen.findByRole('button', { name: /notifica/i }));
    await user.click(await screen.findByText('Aprovação aguardando decisão'));
    expect(onOpenApproval).toHaveBeenCalledWith(approvalRequestId);
    expect(JSON.stringify(approval.payload)).not.toMatch(/audience|content|body/i);
  });

  it('announces unread events and marks only unread notifications with an idempotency key', async () => {
    const unread = notification();
    const read = notification({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      eventKey: 'overdue:item-2',
      itemId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      notificationType: 'overdue',
      label: 'Item em atraso',
      readAt: '2026-07-19T13:00:00.000Z'
    });
    const markInAppNotificationsRead = vi.fn().mockResolvedValue(result([
      { ...unread, readAt: '2026-07-19T14:00:00.000Z' }
    ]));
    const client = {
      listInAppNotifications: vi.fn().mockResolvedValue(result([unread, read])),
      markInAppNotificationsRead
    } as unknown as MarketingOpsClient;
    const user = userEvent.setup();
    renderNotifications(client);

    const trigger = await screen.findByRole('button', { name: /notificações, 1 não lida/i });
    await user.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Notificações' })).toBeTruthy();
    expect(await screen.findByText('Novo item atribuído')).toBeTruthy();
    expect(screen.getByText('Item em atraso')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /marcar todas como lidas/i }));
    await waitFor(() => expect(markInAppNotificationsRead).toHaveBeenCalledWith(
      [unread.id],
      'idem-notification-ui'
    ));
  });

  it('exposes a retry state without leaking the backend error', async () => {
    const client = {
      listInAppNotifications: vi.fn().mockRejectedValue(new Error('secret backend detail'))
    } as unknown as MarketingOpsClient;
    const user = userEvent.setup();
    renderNotifications(client);

    await user.click(await screen.findByRole('button', { name: /notificações/i }));
    expect(await screen.findByText(/não foi possível carregar as notificações/i))
      .toBeTruthy();
    expect(screen.queryByText(/secret backend detail/i)).toBeNull();
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeTruthy();
  });
});
