import { describe, expect, it } from 'vitest';
import {
  marketingOpsPlanActionsSchema,
  requiredScopesForPlan
} from './contracts.js';

const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const artifactId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('phase 4 plan contracts', () => {
  it('accepts submission-only approval actions and rejects every decision action', () => {
    const actions = marketingOpsPlanActionsSchema.parse([
      {
        type: 'approval.submit_editorial', campaign_id: campaignId,
        asset_id: assetId, version_number: 2, reason: 'Revisão',
        expires_at: '2026-08-10T13:00:00.000Z'
      },
      {
        type: 'approval.submit_operational', campaign_id: campaignId,
        reason: 'Autorizar envio', expires_at: '2026-08-10T13:00:00.000Z',
        action_package: {
          actionType: 'campaign.channel_dispatch', channel: 'email',
          audienceSnapshot: {}, scheduledFor: null, timeZone: 'UTC',
          configuration: {}, payload: {}
        }
      }
    ]);
    expect(actions.map((action) => action.type)).toEqual([
      'approval.submit_editorial', 'approval.submit_operational'
    ]);
    expect(requiredScopesForPlan(actions)).toEqual(['approval:submit']);
    for (const type of ['approval.approve', 'approval.reject', 'approval.decide']) {
      expect(marketingOpsPlanActionsSchema.safeParse([{ type, request_id: campaignId }]).success)
        .toBe(false);
    }
  });

  it('accepts an explicitly frozen content version and rejects extra aliases', () => {
    expect(marketingOpsPlanActionsSchema.parse([{
      type: 'content.version_create', asset_id: assetId,
      expected_asset_version: 2, body: 'Versão final', metadata: {}, freeze: true
    }])[0]).toMatchObject({ freeze: true });

    expect(marketingOpsPlanActionsSchema.safeParse([{
      type: 'content.version_create', asset_id: assetId,
      expected_asset_version: 2, body: 'Versão final', metadata: {}, freeze: true,
      version: 3
    }]).success).toBe(false);
  });

  it('accepts the frozen action catalog with strict normalized fields', () => {
    const actions = marketingOpsPlanActionsSchema.parse([
      { type: 'campaign.create_draft', ref: 'new-campaign', name: 'Campanha ENS' },
      { type: 'campaign.update', campaign_id: campaignId, expected_version: '2', patch: { objective: 'Captação' } },
      {
        type: 'campaign_item.create', campaign_ref: 'new-campaign', kind: 'post',
        title: 'Post de lançamento', priority: 'high', channel: 'instagram',
        starts_at: '2026-08-01T12:00:00.000Z', due_at: '2026-08-02T12:00:00.000Z'
      },
      {
        type: 'campaign_item.reschedule', item_id: itemId, expected_version: 3,
        starts_at: '2026-08-03T12:00:00.000Z', due_at: '2026-08-04T12:00:00.000Z'
      },
      {
        type: 'content.create_draft', ref: 'copy', item_id: itemId,
        expected_item_version: 4, asset_kind: 'copy', title: 'Copy principal'
      },
      {
        type: 'content.version_create', asset_ref: 'copy', expected_asset_version: 1,
        body: 'Texto revisado', metadata: { source: 'chat' }, freeze: false
      },
      {
        type: 'artifact.link_existing', item_id: itemId, expected_item_version: 5,
        artifact_id: artifactId, asset_id: assetId
      },
      {
        type: 'campaign.note_add', campaign_id: campaignId, expected_version: 6,
        note: 'Próximo passo validado.'
      }
    ]);

    expect(actions.map((action) => action.type)).toEqual([
      'campaign.create_draft',
      'campaign.update',
      'campaign_item.create',
      'campaign_item.reschedule',
      'content.create_draft',
      'content.version_create',
      'artifact.link_existing',
      'campaign.note_add'
    ]);
    expect(actions[1]).toMatchObject({ expected_version: 2 });
  });

  it('derives the minimum scopes and validates references in order', () => {
    const actions = marketingOpsPlanActionsSchema.parse([
      { type: 'content.create_draft', ref: 'copy', item_id: itemId, expected_item_version: 1, asset_kind: 'copy', title: 'Copy' },
      { type: 'content.version_create', asset_ref: 'copy', expected_asset_version: 1, body: 'Oi', metadata: {}, freeze: false },
      { type: 'artifact.link_existing', item_id: itemId, expected_item_version: 2, artifact_id: artifactId }
    ]);

    expect(requiredScopesForPlan(actions)).toEqual(['artifact:write', 'content:write']);
    expect(() => marketingOpsPlanActionsSchema.parse([
      { type: 'content.version_create', asset_ref: 'missing', expected_asset_version: 1, body: 'Oi', metadata: {}, freeze: false }
    ])).toThrow(/Unknown earlier content asset ref/);
  });

  it('rejects empty patches, oversized notes and inconsistent schedule dates', () => {
    expect(() => marketingOpsPlanActionsSchema.parse([
      { type: 'campaign.update', campaign_id: campaignId, expected_version: 1, patch: {} }
    ])).toThrow(/at least one/);
    expect(() => marketingOpsPlanActionsSchema.parse([
      { type: 'campaign.note_add', campaign_id: campaignId, expected_version: 1, note: 'x'.repeat(2_001) }
    ])).toThrow();
    expect(() => marketingOpsPlanActionsSchema.parse([
      {
        type: 'campaign_item.reschedule', item_id: itemId, expected_version: 1,
        starts_at: '2026-08-05T12:00:00.000Z', due_at: '2026-08-04T12:00:00.000Z'
      }
    ])).toThrow(/due_at/);
  });

  it('validates content.create_draft with email_html asset_kind and string/number version when wrapped in z.object schema', () => {
    import('zod/v4').then(({ z }) => {
      const inputSchema = z.object({
        delegation_token: z.string(),
        actions: marketingOpsPlanActionsSchema
      });

      const parsed = inputSchema.parse({
        delegation_token: 'valid-test-token-at-least-20-chars',
        actions: [
          {
            type: 'content.create_draft',
            ref: 'hml-fase-4-email-inicial',
            item_id: itemId,
            expected_item_version: '1',
            asset_kind: 'email_html',
            title: 'Email inicial - versão 1'
          }
        ]
      });

      expect(parsed.actions[0]).toMatchObject({
        type: 'content.create_draft',
        ref: 'hml-fase-4-email-inicial',
        expected_item_version: 1,
        asset_kind: 'email_html',
        title: 'Email inicial - versão 1'
      });
    });
  });
});
