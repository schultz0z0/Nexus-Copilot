const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuidOnly = new RegExp(`^${uuid}$`, 'i');
const campaignPath = new RegExp(`^/marketing-ops/campaigns/(${uuid})/?$`, 'i');
const itemPath = new RegExp(`^/marketing-ops/production/items/(${uuid})/?$`, 'i');

function validId(id: string, resource: string): string {
  if (!uuidOnly.test(id)) throw new Error(`invalid ${resource} id`);
  return id.toLowerCase();
}

export function campaignDeepLink(id: string): string {
  return `/marketing-ops/campaigns/${validId(id, 'campaign')}`;
}

export function itemDeepLink(id: string): string {
  return `/marketing-ops/production/items/${validId(id, 'item')}`;
}

export function contentAssetDeepLink(itemId: string, assetId: string): string {
  return `${itemDeepLink(itemId)}?contentAssetId=${validId(assetId, 'content asset')}`;
}

export type ParsedMarketingOpsDeepLink =
  | { resource: 'campaign'; id: string }
  | { resource: 'campaign_item'; id: string }
  | { resource: 'content_asset'; id: string; itemId: string };

export function parseMarketingOpsDeepLink(url: string): ParsedMarketingOpsDeepLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://nexus.local');
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://nexus.local') return null;
  const campaign = parsed.pathname.match(campaignPath);
  if (campaign?.[1]) return { resource: 'campaign', id: campaign[1].toLowerCase() };
  const item = parsed.pathname.match(itemPath);
  if (!item?.[1]) return null;
  const itemId = item[1].toLowerCase();
  const assetId = parsed.searchParams.get('contentAssetId');
  if (parsed.searchParams.has('contentAssetId') && (!assetId || !uuidOnly.test(assetId))) {
    return null;
  }
  return assetId && uuidOnly.test(assetId)
    ? { resource: 'content_asset', id: assetId.toLowerCase(), itemId }
    : { resource: 'campaign_item', id: itemId };
}
