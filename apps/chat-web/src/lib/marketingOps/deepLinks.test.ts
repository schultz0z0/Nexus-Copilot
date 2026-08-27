import { describe, expect, it } from 'vitest';
import {
  campaignDeepLink,
  contentAssetDeepLink,
  itemDeepLink,
  parseMarketingOpsDeepLink
} from './deepLinks';

const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('Marketing Ops frontend deep links', () => {
  it('round-trips campaign, item and content routes and rejects foreign templates', () => {
    expect(parseMarketingOpsDeepLink(campaignDeepLink(campaignId)))
      .toEqual({ resource: 'campaign', id: campaignId });
    expect(parseMarketingOpsDeepLink(itemDeepLink(itemId)))
      .toEqual({ resource: 'campaign_item', id: itemId });
    expect(parseMarketingOpsDeepLink(contentAssetDeepLink(itemId, assetId))).toEqual({
      resource: 'content_asset', id: assetId, itemId
    });
    expect(parseMarketingOpsDeepLink(`/admin?contentAssetId=${assetId}`)).toBeNull();
    expect(parseMarketingOpsDeepLink(`/marketing-ops/production/items/${itemId}?contentAssetId=bad`))
      .toBeNull();
    expect(parseMarketingOpsDeepLink(`https://attacker.example/marketing-ops/campaigns/${campaignId}`))
      .toBeNull();
  });
});
