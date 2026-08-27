import { describe, expect, it } from 'vitest';
import { marketingOpsKeys } from './queryKeys';

describe('Marketing Ops query keys', () => {
  it('keeps list and detail resources in separate invalidation scopes', () => {
    const filters = { q: 'gestao', status: 'planned' as const, limit: 25 };

    expect(marketingOpsKeys.all).toEqual(['marketing-ops']);
    expect(marketingOpsKeys.campaigns()).toEqual(['marketing-ops', 'campaigns']);
    expect(marketingOpsKeys.campaigns(filters)).toEqual(['marketing-ops', 'campaigns', filters]);
    expect(marketingOpsKeys.campaign('campaign-1')).toEqual(['marketing-ops', 'campaign', 'campaign-1']);
  });

  it('scopes nested resources by campaign and pagination input', () => {
    expect(marketingOpsKeys.participants('campaign-1')).toEqual([
      'marketing-ops', 'campaign', 'campaign-1', 'participants'
    ]);
    expect(marketingOpsKeys.participantCandidates('campaign-1', { q: 'Ana', limit: 10 })).toEqual([
      'marketing-ops', 'campaign', 'campaign-1', 'participant-candidates', { q: 'Ana', limit: 10 }
    ]);
    expect(marketingOpsKeys.materials('campaign-1')).toEqual([
      'marketing-ops', 'campaign', 'campaign-1', 'materials'
    ]);
    expect(marketingOpsKeys.timeline('campaign-1')).toEqual([
      'marketing-ops', 'campaign', 'campaign-1', 'timeline'
    ]);
    expect(marketingOpsKeys.timeline('campaign-1', { limit: 25, cursor: 'next' })).toEqual([
      'marketing-ops', 'campaign', 'campaign-1', 'timeline', { limit: 25, cursor: 'next' }
    ]);
    expect(marketingOpsKeys.courseReferences('gestao', 10)).toEqual([
      'marketing-ops', 'references', 'courses', 'gestao', 10
    ]);
  });

  it('shares one canonical production schedule scope across every view', () => {
    const filters = {
      campaignId: 'campaign-1',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      status: 'ready' as const
    };
    expect(marketingOpsKeys.productionSchedule(filters)).toEqual([
      'marketing-ops', 'production', 'schedule', filters
    ]);
    expect(marketingOpsKeys.productionItem('item-1')).toEqual([
      'marketing-ops', 'production', 'item', 'item-1'
    ]);
    expect(marketingOpsKeys.productionItemDependencies('item-1')).toEqual([
      'marketing-ops', 'production', 'item', 'item-1', 'dependencies'
    ]);
    expect(marketingOpsKeys.contentAssets('item-1')).toEqual([
      'marketing-ops', 'production', 'item', 'item-1', 'content-assets'
    ]);
    expect(marketingOpsKeys.contentVersions('asset-1')).toEqual([
      'marketing-ops', 'production', 'content-asset', 'asset-1', 'versions'
    ]);
    expect(marketingOpsKeys.productionItemArtifacts('item-1')).toEqual([
      'marketing-ops', 'production', 'item', 'item-1', 'artifacts'
    ]);
    expect(marketingOpsKeys.notifications({ unreadOnly: true, limit: 25 })).toEqual([
      'marketing-ops', 'notifications', { unreadOnly: true, limit: 25 }
    ]);
  });

  it('separates approval queue filters from immutable request detail', () => {
    expect(marketingOpsKeys.approvals({ status: 'pending', kind: 'operational' })).toEqual([
      'marketing-ops', 'approvals', { status: 'pending', kind: 'operational' }
    ]);
    expect(marketingOpsKeys.approval('request-1')).toEqual([
      'marketing-ops', 'approval', 'request-1'
    ]);
  });
});
