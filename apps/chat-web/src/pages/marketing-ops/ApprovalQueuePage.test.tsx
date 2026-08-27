// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import ApprovalQueuePage from './ApprovalQueuePage';

const request = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'operational', status: 'pending', requestedBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reason: 'Autorizar envio', riskLevel: 'high', contentAssetId: null,
  contentVersionNumber: null, actionPackageId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  targetHash: 'a'.repeat(64), supersedesRequestId: null,
  expiresAt: '2026-08-10T13:00:00.000Z', version: 1,
  createdAt: '2026-08-05T13:00:00.000Z', updatedAt: '2026-08-05T13:00:00.000Z',
  decision: null, actionPackage: null, capabilities: { decide: true, cancel: false }
} as const;

function Probe() { const location = useLocation(); return <output data-testid="location">{location.search}</output>; }

afterEach(cleanup);

describe('ApprovalQueuePage', () => {
  it('renders risk/status text and persists filters in the URL', async () => {
    const client = { listApprovalRequests: vi.fn().mockResolvedValue({
      data: [request], correlationId: 'corr', etag: null,
      page: { limit: 25, count: 1, nextCursor: null }
    }) } as unknown as MarketingOpsClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/marketing-ops/approvals']}>
      <ApprovalQueuePage client={client} /><Probe />
    </MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Autorizar envio')).toBeTruthy();
    expect(screen.getAllByText('Pendente').length).toBeGreaterThan(0);
    expect(screen.getByText('Risco alto')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Tipo'), 'editorial');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('kind=editorial'));
    await user.type(screen.getByLabelText('Campanha'), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    await user.type(screen.getByLabelText('Solicitante'), 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    await user.type(screen.getByLabelText('Expira até'), '2026-08-31');
    await waitFor(() => {
      const location = screen.getByTestId('location').textContent ?? '';
      expect(location).toContain('campaignId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      expect(location).toContain('requestedBy=cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      expect(location).toContain('expiresBefore=2026-08-31T23%3A59%3A59.999Z');
    });
  });
});
