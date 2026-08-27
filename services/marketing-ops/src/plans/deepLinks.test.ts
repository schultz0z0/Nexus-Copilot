import { describe, expect, it } from 'vitest';
import { contentDeepLink, campaignDeepLink, itemDeepLink } from './deepLinks.js';

const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('Marketing Ops operator deep links', () => {
  it('generates only the three frozen relative route templates', () => {
    expect(campaignDeepLink(campaignId)).toEqual({
      resource_type: 'campaign', resource_id: campaignId, label: 'Abrir campanha',
      href: `/marketing-ops/campaigns/${campaignId}`, open_in: 'campaign_workspace'
    });
    expect(itemDeepLink(itemId)).toEqual({
      resource_type: 'campaign_item', resource_id: itemId, label: 'Abrir item',
      href: `/marketing-ops/production/items/${itemId}`, open_in: 'campaign_item'
    });
    expect(contentDeepLink(itemId, assetId)).toEqual({
      resource_type: 'content_asset', resource_id: assetId, label: 'Abrir conteúdo',
      href: `/marketing-ops/production/items/${itemId}?contentAssetId=${assetId}`,
      open_in: 'content_asset'
    });
    expect(() => itemDeepLink('../admin')).toThrow();
  });
});
