// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type { MarketingOpsPlanExecutionResult, MarketingOpsPreparedPlanSummary, MarketingOpsResult } from '@/lib/marketingOps/types';
import { AgentPlanCard } from './AgentPlanCard';

const samplePlan: MarketingOpsPreparedPlanSummary = {
  id: '11111111-2222-3333-4444-555555555555',
  planHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  status: 'pending',
  expiresAt: '2026-12-31T23:59:59.000Z',
  actions: [
    {
      type: 'campaign.create_draft',
      ref: 'camp-1',
      name: 'Campanha Black Friday',
      course_slug: 'curso-marketing'
    },
    {
      type: 'campaign_item.create',
      kind: 'email',
      title: 'Disparo de Aquecimento',
      priority: 'high'
    }
  ],
  requiredScopes: ['campaign:write', 'item:write'],
  createdAt: '2026-09-14T12:00:00.000Z'
};

const resultWrapper = <T,>(data: T): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-test',
  etag: null
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentPlanCard', () => {
  it('renders plan summary, short hash, short ID, expiry, and action list', () => {
    render(
      <AgentPlanCard
        plan={samplePlan}
        canWrite={true}
        canApprove={true}
      />
    );

    expect(screen.getByText('Pendente')).toBeTruthy();
    expect(screen.getByText(/abcdef123456/)).toBeTruthy();
    expect(screen.getByText(/11111111\.\.\.555555555555/)).toBeTruthy();
    expect(screen.getByText('Criar rascunho de campanha')).toBeTruthy();
    expect(screen.getByText(/Campanha Black Friday/)).toBeTruthy();
    expect(screen.getByText('Criar item de campanha (email)')).toBeTruthy();
    expect(screen.getByText(/Disparo de Aquecimento/)).toBeTruthy();

    const button = screen.getByRole('button', { name: /executar plano/i }) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
  });

  it('disables execution when canWrite is false', () => {
    render(
      <AgentPlanCard
        plan={samplePlan}
        canWrite={false}
        canApprove={true}
      />
    );

    const button = screen.getByRole('button', { name: /executar plano/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('disables execution when plan contains approval action and canApprove is false', () => {
    const approvalPlan: MarketingOpsPreparedPlanSummary = {
      ...samplePlan,
      actions: [
        {
          type: 'approval.submit_editorial',
          campaign_id: '11111111-1111-1111-1111-111111111111',
          asset_id: '22222222-2222-2222-2222-222222222222',
          version_number: 1,
          reason: 'Aprovação necessária'
        }
      ]
    };

    render(
      <AgentPlanCard
        plan={approvalPlan}
        canWrite={true}
        canApprove={false}
      />
    );

    const button = screen.getByRole('button', { name: /executar plano/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('disables execution and flags unsupported action when plan contains unknown action type', () => {
    const unsupportedPlan: MarketingOpsPreparedPlanSummary = {
      ...samplePlan,
      actions: [
        { type: 'unsupported.malicious_action' }
      ]
    };

    render(
      <AgentPlanCard
        plan={unsupportedPlan}
        canWrite={true}
        canApprove={true}
      />
    );

    expect(screen.getAllByText('Ação não suportada').length).toBeGreaterThanOrEqual(1);
    const button = screen.getByRole('button', { name: /executar plano/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('disables button when plan status is terminal or expired', () => {
    const completedPlan: MarketingOpsPreparedPlanSummary = { ...samplePlan, status: 'completed' };
    const { rerender } = render(<AgentPlanCard plan={completedPlan} canWrite={true} canApprove={true} />);
    expect(screen.queryByRole('button', { name: /executar plano/i })).toBeNull();

    const expiredPlan: MarketingOpsPreparedPlanSummary = { ...samplePlan, status: 'expired' };
    rerender(<AgentPlanCard plan={expiredPlan} canWrite={true} canApprove={true} />);
    expect(screen.queryByRole('button', { name: /executar plano/i })).toBeNull();
  });

  it('renders a persisted successful receipt after reload without offering execution again', () => {
    const completedPlan: MarketingOpsPreparedPlanSummary = {
      ...samplePlan,
      status: 'completed',
      executedAt: '2026-09-17T12:30:00.000Z',
      updatedAt: '2026-09-17T12:30:00.000Z',
      result: {
        status: 'completed',
        plan_id: samplePlan.id,
        completed: [
          { action_index: 0, action_type: 'campaign.create_draft', idempotency_hit: false, resource: { id: 'camp-1' } }
        ],
        failed: [],
        pending: [],
        deep_links: [
          '/marketing-ops/campaigns/11111111-1111-4111-8111-111111111111',
          'https://attacker.example/marketing-ops/campaigns/11111111-1111-4111-8111-111111111111'
        ]
      }
    };

    render(<AgentPlanCard plan={completedPlan} canWrite={true} canApprove={true} />);

    expect(screen.getAllByText('Plano concluído').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1 ação concluída/i)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /ver recurso criado/i })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /executar plano/i })).toBeNull();
  });

  it('renders a persisted approval receipt as pending, not as an approved action', () => {
    const approvalPlan: MarketingOpsPreparedPlanSummary = {
      ...samplePlan,
      status: 'completed',
      actions: [{
        type: 'approval.submit_editorial',
        campaign_id: '11111111-1111-1111-1111-111111111111',
        asset_id: '22222222-2222-2222-2222-222222222222',
        version_number: 1,
        reason: 'Revisão textual',
        expires_at: '2026-09-18T12:00:00.000Z'
      }],
      result: {
        status: 'completed',
        plan_id: samplePlan.id,
        completed: [{ action_index: 0, action_type: 'approval.submit_editorial', idempotency_hit: false }],
        failed: [],
        pending: [],
        deep_links: ['/marketing-ops/approvals/approval-1']
      }
    };

    render(<AgentPlanCard plan={approvalPlan} canWrite={true} canApprove={true} />);

    expect(screen.getByText(/Solicitação de aprovação criada — pendente/i)).toBeTruthy();
    expect(screen.queryByText(/ação aprovada/i)).toBeNull();
  });

  it('renders persisted failure and replacement receipts with explicit terminal copy', () => {
    const failedPlan: MarketingOpsPreparedPlanSummary = {
      ...samplePlan,
      status: 'failed',
      result: {
        status: 'failed',
        plan_id: samplePlan.id,
        completed: [],
        failed: [{
          action_index: 0,
          action_type: 'campaign.create_draft',
          error: { code: 'conflict', message: 'A campanha mudou antes da execução', status: 409 }
        }],
        pending: [],
        deep_links: []
      }
    };
    const { rerender } = render(<AgentPlanCard plan={failedPlan} canWrite={true} canApprove={true} />);

    expect(screen.getAllByText('Plano não concluído').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/A campanha mudou antes da execução/i)).toBeTruthy();

    rerender(<AgentPlanCard plan={{ ...samplePlan, status: 'invalidated' }} canWrite={true} canApprove={true} />);
    expect(screen.getByText(/plano foi substituído por uma versão mais recente/i)).toBeTruthy();
  });

  it('executes plan with explicit button click, announces aria-live result and calls onExecuted', async () => {
    const user = userEvent.setup();
    const mockExecutionResult: MarketingOpsPlanExecutionResult = {
      status: 'completed',
      plan_id: samplePlan.id,
      completed: [
        { action_index: 0, action_type: 'campaign.create_draft', idempotency_hit: false, resource: { id: 'camp-1' } }
      ],
      failed: [],
      pending: [],
      deep_links: ['/marketing-ops/campaigns/camp-1']
    };

    const mockClient = {
      executeAgentPlan: vi.fn().mockResolvedValue(resultWrapper(mockExecutionResult))
    } as unknown as MarketingOpsClient;

    const onExecuted = vi.fn();

    render(
      <AgentPlanCard
        plan={samplePlan}
        client={mockClient}
        canWrite={true}
        canApprove={true}
        onExecuted={onExecuted}
      />
    );

    const button = screen.getByRole('button', { name: /executar plano/i });
    await user.click(button);

    await waitFor(() => {
      expect(mockClient.executeAgentPlan).toHaveBeenCalledWith(
        samplePlan.id,
        samplePlan.planHash,
        expect.any(String)
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Plano executado com sucesso/i).length).toBeGreaterThanOrEqual(1);
    });

    expect(onExecuted).toHaveBeenCalledWith(mockExecutionResult);
  });

  it('re-uses the same idempotency key on retry after a failure', async () => {
    const user = userEvent.setup();
    const executeSpy = vi.fn()
      .mockRejectedValueOnce(new Error('Falha temporária de rede'))
      .mockResolvedValueOnce(resultWrapper({
        status: 'completed',
        plan_id: samplePlan.id,
        completed: [],
        failed: [],
        pending: [],
        deep_links: []
      }));

    const mockClient = {
      executeAgentPlan: executeSpy
    } as unknown as MarketingOpsClient;

    render(
      <AgentPlanCard
        plan={samplePlan}
        client={mockClient}
        canWrite={true}
        canApprove={true}
      />
    );

    const button = screen.getByRole('button', { name: /executar plano/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getAllByText(/Falha temporária de rede/i).length).toBeGreaterThanOrEqual(1);
    });

    const firstCallKey = executeSpy.mock.calls[0]?.[2];

    // Retry
    await user.click(screen.getByRole('button', { name: /executar plano/i }));

    await waitFor(() => {
      expect(executeSpy.mock.calls.length).toBe(2);
    });

    const secondCallKey = executeSpy.mock.calls[1]?.[2];
    expect(secondCallKey).toBe(firstCallKey);
  });

  it('displays approval pending notice and never claims external execution for approval actions', async () => {
    const user = userEvent.setup();
    const approvalPlan: MarketingOpsPreparedPlanSummary = {
      ...samplePlan,
      actions: [
        {
          type: 'approval.submit_editorial',
          campaign_id: '11111111-1111-1111-1111-111111111111',
          asset_id: '22222222-2222-2222-2222-222222222222',
          version_number: 1,
          reason: 'Revisão textual'
        }
      ]
    };

    const mockExecutionResult: MarketingOpsPlanExecutionResult = {
      status: 'completed',
      plan_id: approvalPlan.id,
      completed: [
        { action_index: 0, action_type: 'approval.submit_editorial', idempotency_hit: false }
      ],
      failed: [],
      pending: [],
      deep_links: []
    };

    const mockClient = {
      executeAgentPlan: vi.fn().mockResolvedValue(resultWrapper(mockExecutionResult))
    } as unknown as MarketingOpsClient;

    render(
      <AgentPlanCard
        plan={approvalPlan}
        client={mockClient}
        canWrite={true}
        canApprove={true}
      />
    );

    await user.click(screen.getByRole('button', { name: /executar plano/i }));

    await waitFor(() => {
      expect(screen.getByText(/Solicitação de aprovação criada — pendente/i)).toBeTruthy();
    });

    expect(screen.queryByText(/ação aprovada/i)).toBeNull();
    expect(screen.queryByText(/ação executada externamente/i)).toBeNull();
  });

  it('prompts for explicit confirmation when plan has critical risk', async () => {
    const user = userEvent.setup();
    const criticalPlan: MarketingOpsPreparedPlanSummary = {
      ...samplePlan,
      actions: [
        {
          type: 'approval.submit_operational',
          campaign_id: '11111111-1111-1111-1111-111111111111',
          action_package: { actionType: 'delete_segment' },
          reason: 'Critical segment purge',
          risk_level: 'critical'
        } as unknown as MarketingOpsPlanAction
      ]
    };

    const mockClient = {
      executeAgentPlan: vi.fn().mockResolvedValue(resultWrapper({
        status: 'completed',
        plan_id: criticalPlan.id,
        completed: [],
        failed: [],
        pending: [],
        deep_links: []
      }))
    } as unknown as MarketingOpsClient;

    render(
      <AgentPlanCard
        plan={criticalPlan}
        client={mockClient}
        canWrite={true}
        canApprove={true}
      />
    );

    // First click shows confirmation modal/prompt
    await user.click(screen.getByRole('button', { name: /executar plano/i }));

    expect(screen.getByText('Risco Crítico Detectado')).toBeTruthy();
    expect(mockClient.executeAgentPlan).not.toHaveBeenCalled();

    // Cancel confirmation
    await user.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(mockClient.executeAgentPlan).not.toHaveBeenCalled();

    // Click again and confirm
    await user.click(screen.getByRole('button', { name: /executar plano/i }));
    await user.click(screen.getByRole('button', { name: /confirmar execução/i }));

    await waitFor(() => {
      expect(mockClient.executeAgentPlan).toHaveBeenCalled();
    });
  });
});
