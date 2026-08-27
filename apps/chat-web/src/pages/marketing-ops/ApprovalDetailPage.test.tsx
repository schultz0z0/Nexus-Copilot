// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MarketingOpsApiError, type MarketingOpsClient } from '@/lib/marketingOps/client';
import ApprovalDetailPage from './ApprovalDetailPage';

afterEach(cleanup);

describe('ApprovalDetailPage', () => {
  it('shows the frozen hash and requires a rejection comment', async () => {
    const approval = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kind: 'editorial', status: 'pending', requestedBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reason: 'Revisão institucional', riskLevel: 'low',
      contentAssetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', contentVersionNumber: 2,
      actionPackageId: null, targetHash: 'a'.repeat(64), supersedesRequestId: null,
      expiresAt: '2026-08-10T13:00:00.000Z', version: 1,
      createdAt: '2026-08-05T13:00:00.000Z', updatedAt: '2026-08-05T13:00:00.000Z',
      decision: null, actionPackage: null,
      editorialTarget: { assetKind: 'email_body', title: 'Chamada institucional', body: 'Conteúdo congelado', metadata: { locale: 'pt-BR' }, frozenAt: '2026-08-05T12:00:00.000Z' },
      capabilities: { decide: true, cancel: false }
    } as const;
    const decideApproval = vi.fn().mockResolvedValue({
      data: { ...approval, status: 'rejected', editorialTarget: null }
    });
    const client = {
      getApprovalRequest: vi.fn().mockResolvedValue({ data: approval, correlationId: 'corr', etag: '"1"' }),
      decideApproval
    } as unknown as MarketingOpsClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/marketing-ops/approvals/${approval.id}`]}>
      <Routes><Route path="/marketing-ops/approvals/:requestId" element={<ApprovalDetailPage client={client} idempotencyKey={() => 'decision-key'} />} /></Routes>
    </MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Versão editorial 2')).toBeTruthy();
    expect(screen.getByText(approval.targetHash)).toBeTruthy();
    expect(screen.getAllByText('Conteúdo congelado')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Rejeitar' }));
    expect((screen.getByRole('button', { name: 'Confirmar decisão' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Comentário'), 'Ajustar a chamada');
    await user.click(screen.getByRole('button', { name: 'Confirmar decisão' }));
    await waitFor(() => expect(decideApproval).toHaveBeenCalledWith(
      approval.id, 1, { decision: 'rejected', comment: 'Ajustar a chamada' }, 'decision-key'
    ));
    expect(screen.getByText('Chamada institucional')).toBeTruthy();
    expect(screen.getByText(approval.targetHash)).toBeTruthy();
  });

  it('requires reinforced confirmation for critical risk and exposes requester cancellation', async () => {
    const approval = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kind: 'editorial', status: 'pending', requestedBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reason: 'Risco crítico', riskLevel: 'critical', contentAssetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      contentVersionNumber: 1, actionPackageId: null, targetHash: 'b'.repeat(64), supersedesRequestId: null,
      expiresAt: '2026-08-10T13:00:00.000Z', version: 1, createdAt: '2026-08-05T13:00:00.000Z',
      updatedAt: '2026-08-05T13:00:00.000Z', decision: null, actionPackage: null,
      editorialTarget: null, capabilities: { decide: true, cancel: true }
    } as const;
    const cancelApproval = vi.fn().mockResolvedValue({ data: { ...approval, status: 'cancelled' } });
    const client = {
      getApprovalRequest: vi.fn().mockResolvedValue({ data: approval, correlationId: 'corr', etag: '"1"' }),
      decideApproval: vi.fn(), cancelApproval
    } as unknown as MarketingOpsClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/marketing-ops/approvals/${approval.id}`]}>
      <Routes><Route path="/marketing-ops/approvals/:requestId" element={<ApprovalDetailPage client={client} idempotencyKey={() => 'critical-key'} />} /></Routes>
    </MemoryRouter></QueryClientProvider>);
    await user.click(await screen.findByRole('button', { name: 'Aprovar' }));
    const confirmDecision = screen.getByRole('button', { name: 'Confirmar decisão' }) as HTMLButtonElement;
    expect(confirmDecision.disabled).toBe(true);
    await user.click(screen.getByLabelText('Confirmar risco crítico'));
    expect(confirmDecision.disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar solicitação' }));
    await waitFor(() => expect(cancelApproval).toHaveBeenCalledWith(approval.id, 1, 'critical-key'));
    confirm.mockRestore();
  });

  it('distinguishes an internal decision failure from a version conflict', async () => {
    const approval = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kind: 'editorial', status: 'pending', requestedBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reason: 'Decisão administrativa', riskLevel: 'low', contentAssetId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      contentVersionNumber: 1, actionPackageId: null, targetHash: 'c'.repeat(64), supersedesRequestId: null,
      expiresAt: '2026-08-10T13:00:00.000Z', version: 1, createdAt: '2026-08-05T13:00:00.000Z',
      updatedAt: '2026-08-05T13:00:00.000Z', decision: null, actionPackage: null,
      editorialTarget: null, capabilities: { decide: true, cancel: false }
    } as const;
    const correlationId = 'e41eba94-e23d-4efe-883a-1e826d8397ca';
    const client = {
      getApprovalRequest: vi.fn().mockResolvedValue({ data: approval, correlationId: 'read-corr', etag: '"1"' }),
      decideApproval: vi.fn().mockRejectedValue(new MarketingOpsApiError(
        'internal_error', 500, 'Internal server error', correlationId
      ))
    } as unknown as MarketingOpsClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[`/marketing-ops/approvals/${approval.id}`]}>
      <Routes><Route path="/marketing-ops/approvals/:requestId" element={<ApprovalDetailPage client={client} idempotencyKey={() => 'failure-key'} />} /></Routes>
    </MemoryRouter></QueryClientProvider>);

    await user.click(await screen.findByRole('button', { name: 'Aprovar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar decisão' }));

    expect(await screen.findByText('Não foi possível concluir a decisão')).toBeTruthy();
    expect(screen.queryByText('Conflito ao atualizar a aprovação')).toBeNull();
    expect(screen.getByText(new RegExp(correlationId))).toBeTruthy();
  });
});
