import { describe, expect, it, vi } from 'vitest';
import { appError } from '../errors.js';
import type { CommandContext } from '../domain/context.js';
import type { MarketingOpsPlan } from './token.js';
import {
  executeMarketingOpsPlan,
  type PlanExecutorContext,
  type PlanExecutorDependencies
} from './executor.js';

const context: PlanExecutorContext = {
  pool: {} as CommandContext['pool'],
  actor: {
    userId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenantSlug: 'ens',
    role: 'member'
  },
  correlationId: '33333333-3333-4333-8333-333333333333',
  origin: 'mcp',
  artifacts: {} as NonNullable<PlanExecutorContext['artifacts']>
};

const ids = {
  campaign: '55555555-5555-4555-8555-555555555555',
  otherCampaign: '77777777-7777-4777-8777-777777777777',
  item: '66666666-6666-4666-8666-666666666666',
  asset: '88888888-8888-4888-8888-888888888888',
  artifact: '99999999-9999-4999-8999-999999999999'
};

function plan(actions: MarketingOpsPlan['actions']): MarketingOpsPlan {
  return {
    plan_id: '44444444-4444-4444-8444-444444444444',
    plan_hash: 'a'.repeat(64),
    sub: context.actor.userId,
    tenant_id: context.actor.tenantId,
    chat_session_id: '22222222-2222-4222-8222-222222222222',
    prepared_jti: 'preparation-jti',
    actions,
    contract_version: 1,
    iat: 1_700_000_000,
    nbf: 1_699_999_999,
    exp: 1_700_000_900
  };
}

function dependencies(overrides: Partial<PlanExecutorDependencies> = {}): PlanExecutorDependencies {
  return {
    createCampaignDraft: vi.fn().mockResolvedValue({ id: ids.campaign }),
    updateCampaign: vi.fn().mockResolvedValue({ id: ids.otherCampaign, version: 2 }),
    createProductionItem: vi.fn().mockResolvedValue({ id: ids.item, campaignId: ids.campaign }),
    updateProductionItem: vi.fn().mockResolvedValue({ id: ids.item, version: 2 }),
    createContentAsset: vi.fn().mockResolvedValue({ id: ids.asset, itemId: ids.item }),
    createContentVersion: vi.fn().mockResolvedValue({
      assetId: ids.asset, itemId: ids.item, versionNumber: 1
    }),
    linkExistingItemArtifact: vi.fn().mockResolvedValue({ artifact: { id: ids.artifact } }),
    appendCampaignNote: vi.fn().mockResolvedValue({ id: ids.otherCampaign, version: 3 }),
    submitEditorialApproval: vi.fn().mockResolvedValue({
      id: ids.asset, kind: 'editorial', status: 'pending'
    }),
    submitOperationalApproval: vi.fn().mockResolvedValue({
      id: ids.artifact, kind: 'operational', status: 'pending'
    }),
    ...overrides
  };
}

describe('Marketing Ops plan executor', () => {
  it('submits approval requests but exposes no decision dependency', async () => {
    const deps = dependencies();
    const result = await executeMarketingOpsPlan(context, plan([
      {
        type: 'approval.submit_editorial', campaign_id: ids.campaign,
        asset_id: ids.asset, version_number: 2, reason: 'Revisão',
        expires_at: '2026-08-10T13:00:00.000Z'
      },
      {
        type: 'approval.submit_operational', campaign_id: ids.campaign,
        reason: 'Autorizar envio', expires_at: '2026-08-10T13:00:00.000Z',
        action_package: {
          actionType: 'campaign.channel_dispatch', channel: 'email',
          audienceSnapshot: {}, scheduledFor: null, timeZone: 'UTC',
          configuration: {}, successCriteria: null, riskSummary: null, payload: {}
        }
      }
    ]), deps);

    expect(deps.submitEditorialApproval).toHaveBeenCalledWith(
      expect.objectContaining({ planActionIndex: 0 }),
      expect.objectContaining({ assetId: ids.asset, versionNumber: 2 })
    );
    expect(deps.submitOperationalApproval).toHaveBeenCalledWith(
      expect.objectContaining({ planActionIndex: 1 }),
      expect.objectContaining({ campaignId: ids.campaign })
    );
    expect(result.deep_links).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource_type: 'approval_request' })
    ]));
  });

  it('maps every frozen action and resolves earlier campaign/content references', async () => {
    const deps = dependencies();
    const result = await executeMarketingOpsPlan(context, plan([
      { type: 'campaign.create_draft', ref: 'campaign-main', name: 'Volta as aulas' },
      {
        type: 'campaign_item.create', campaign_ref: 'campaign-main', kind: 'email',
        title: 'Boas-vindas', priority: 'high', starts_at: '2026-08-01T12:00:00Z'
      },
      {
        type: 'campaign.update', campaign_id: ids.otherCampaign, expected_version: 1,
        patch: { objective: 'Conversão', secondary_channels: ['instagram'] }
      },
      {
        type: 'campaign_item.reschedule', item_id: ids.item, expected_version: 1,
        due_at: '2026-08-02T12:00:00Z'
      },
      {
        type: 'content.create_draft', ref: 'email-copy', item_id: ids.item,
        expected_item_version: 2, asset_kind: 'copy', title: 'Copy principal'
      },
      {
        type: 'content.version_create', asset_ref: 'email-copy', expected_asset_version: 1,
        body: 'Olá, ENS!', metadata: { source: 'chat' }, freeze: true
      },
      {
        type: 'artifact.link_existing', item_id: ids.item, expected_item_version: 3,
        artifact_id: ids.artifact, asset_id: ids.asset
      },
      {
        type: 'campaign.note_add', campaign_id: ids.otherCampaign, expected_version: 2,
        note: 'Aprovado no chat.'
      }
    ]), deps);

    expect(result).toMatchObject({
      plan_id: '44444444-4444-4444-8444-444444444444',
      status: 'completed',
      failed: [],
      pending: []
    });
    expect(result.completed).toHaveLength(8);
    expect(result.deep_links).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource_type: 'campaign', resource_id: ids.campaign }),
      expect.objectContaining({ resource_type: 'campaign_item', resource_id: ids.item }),
      expect.objectContaining({ resource_type: 'content_asset', resource_id: ids.asset })
    ]));
    expect(deps.createProductionItem).toHaveBeenCalledWith(
      expect.objectContaining({ planId: result.plan_id, planActionIndex: 1 }),
      ids.campaign,
      expect.objectContaining({
        kind: 'email', title: 'Boas-vindas', priority: 'high',
        startsAt: '2026-08-01T12:00:00Z',
        idempotencyKey: `plan:${result.plan_id}:1`
      })
    );
    expect(deps.updateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ planActionIndex: 2 }),
      ids.otherCampaign,
      1,
      {
        objective: 'Conversão', secondaryChannels: ['instagram'],
        idempotencyKey: `plan:${result.plan_id}:2`
      }
    );
    expect(deps.createContentVersion).toHaveBeenCalledWith(
      expect.objectContaining({ planActionIndex: 5 }),
      ids.asset,
      1,
      {
        body: 'Olá, ENS!', metadata: { source: 'chat' }, freeze: true,
        idempotencyKey: `plan:${result.plan_id}:5`
      }
    );
  });

  it('continues independent actions and leaves only failed dependencies pending', async () => {
    const deps = dependencies({
      createCampaignDraft: vi.fn().mockRejectedValue(
        appError('dependency_unavailable', 503, 'Database unavailable')
      )
    });
    const result = await executeMarketingOpsPlan(context, plan([
      { type: 'campaign.create_draft', ref: 'campaign-main', name: 'Campanha parcial' },
      {
        type: 'campaign_item.create', campaign_ref: 'campaign-main', kind: 'email',
        title: 'Depende da campanha'
      },
      {
        type: 'campaign.update', campaign_id: ids.otherCampaign,
        expected_version: 1, patch: { name: 'Ação independente' }
      }
    ]), deps);

    expect(result.status).toBe('partial');
    expect(result.completed.map((entry) => entry.action_index)).toEqual([2]);
    expect(result.failed).toEqual([
      expect.objectContaining({
        action_index: 0,
        error: { code: 'dependency_unavailable', message: 'Database unavailable', status: 503 }
      })
    ]);
    expect(result.pending).toEqual([
      { action_index: 1, action_type: 'campaign_item.create', reason: 'dependency_failed' }
    ]);
    expect(deps.createProductionItem).not.toHaveBeenCalled();
    expect(deps.updateCampaign).toHaveBeenCalledOnce();
  });

  it('reports failed when no action completes and never exposes unknown errors', async () => {
    const result = await executeMarketingOpsPlan(context, plan([
      {
        type: 'campaign.update', campaign_id: ids.otherCampaign,
        expected_version: 1, patch: { name: 'Falha' }
      }
    ]), dependencies({ updateCampaign: vi.fn().mockRejectedValue(new Error('secret')) }));

    expect(result).toMatchObject({ status: 'failed', completed: [], pending: [] });
    expect(result.failed[0]?.error).toEqual({
      code: 'internal_error', message: 'Internal server error', status: 500
    });
  });
});
