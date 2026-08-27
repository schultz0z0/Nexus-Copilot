import { z } from 'zod';
import { authorize } from '../auth/permissions.js';
import { withActorTransaction } from '../db/actorTransaction.js';
import { appError } from '../errors.js';
import type { CommandContext } from './context.js';

export const MarketingOpsResourceTypeSchema = z.enum([
  'campaign',
  'campaign_item',
  'content_asset'
]);
export type MarketingOpsResourceType = z.infer<typeof MarketingOpsResourceTypeSchema>;

type ObjectCapabilities =
  | { read: true; update: boolean; note_add: boolean }
  | { read: true; reschedule: boolean; create_content: boolean; link_artifact: boolean }
  | { read: true; create_version: boolean };

export function deriveObjectCapabilities(
  resourceType: MarketingOpsResourceType,
  status: string,
  canEdit: boolean
): ObjectCapabilities {
  if (resourceType === 'campaign') {
    const mutable = canEdit && status !== 'archived';
    return { read: true, update: mutable, note_add: mutable };
  }
  if (resourceType === 'campaign_item') {
    const mutable = canEdit && status !== 'completed' && status !== 'cancelled';
    return {
      read: true,
      reschedule: mutable,
      create_content: mutable,
      link_artifact: mutable
    };
  }
  return {
    read: true,
    create_version: canEdit && status !== 'completed' && status !== 'cancelled'
  };
}

interface CapabilityRow {
  status: string;
  allowed: boolean;
}

export async function getObjectCapabilities(
  context: CommandContext,
  resourceType: MarketingOpsResourceType,
  resourceId: string
) {
  const parsedType = MarketingOpsResourceTypeSchema.parse(resourceType);
  const parsedId = z.string().uuid().parse(resourceId);
  authorize(
    context.actor,
    parsedType === 'campaign'
      ? 'campaign.read'
      : parsedType === 'campaign_item'
        ? 'item.read'
        : 'content.read'
  );

  return withActorTransaction(context.pool, context.actor, context.correlationId, async (client) => {
    const query = parsedType === 'campaign'
      ? `select status::text, marketing_ops_private.can_edit_campaign(id) as allowed
         from marketing_ops.campaigns where id = $1`
      : parsedType === 'campaign_item'
        ? `select item.status::text,
             (campaign.status <> 'archived' and marketing_ops_private.can_edit_campaign_item(item.id)) as allowed
           from marketing_ops.campaign_items as item
           join marketing_ops.campaigns as campaign on campaign.id = item.campaign_id
             and campaign.tenant_id = item.tenant_id
           where item.id = $1`
        : `select item.status::text,
             (campaign.status <> 'archived' and marketing_ops_private.can_edit_content_asset(asset.id)) as allowed
           from marketing_ops.content_assets as asset
           join marketing_ops.campaign_items as item on item.id = asset.item_id
             and item.tenant_id = asset.tenant_id
           join marketing_ops.campaigns as campaign on campaign.id = item.campaign_id
             and campaign.tenant_id = item.tenant_id
           where asset.id = $1`;
    const result = await client.query<CapabilityRow>(query, [parsedId]);
    const row = result.rows[0];
    if (!row) throw appError('not_found', 404, 'Marketing Ops resource not found');
    return {
      resourceType: parsedType,
      resourceId: parsedId,
      status: row.status,
      capabilities: deriveObjectCapabilities(parsedType, row.status, row.allowed)
    };
  });
}
