import type { Pool } from 'pg';
import { z } from 'zod';
import { appError } from '../errors.js';

export type ActorRole = 'member' | 'manager' | 'admin';
export interface Actor { userId: string; tenantId: string; tenantSlug: string; role: ActorRole }

const uuid = z.string().uuid();
const tenantSelector = z.string().min(2).max(64).regex(/^[a-z0-9-]+$/i);

export async function resolveActor(pool: Pool, userId: string, requestedTenantId?: string): Promise<Actor> {
  uuid.parse(userId);
  if (requestedTenantId) tenantSelector.parse(requestedTenantId);
  const result = await pool.query<{
    user_id: string; tenant_id: string; tenant_slug: string; role: ActorRole;
  }>(`
    select membership.user_id, membership.tenant_id, tenant.slug as tenant_slug, membership.role::text as role
    from marketing_ops.memberships as membership
    join marketing_ops.tenants as tenant on tenant.id = membership.tenant_id
    where membership.user_id = $1
      and membership.active
      and tenant.active
      and ($2::text is null or membership.tenant_id::text = $2::text or tenant.slug = lower($2::text))
    order by tenant.slug
    limit 2
  `, [userId, requestedTenantId ?? null]);
  if (result.rows.length === 0) {
    throw appError(requestedTenantId ? 'tenant_forbidden' : 'membership_required', 403, 'No active membership grants access');
  }
  if (!requestedTenantId && result.rows.length > 1) {
    throw appError('tenant_required', 400, 'X-Tenant-Id is required when the user has multiple memberships');
  }
  const row = result.rows[0]!;
  return { userId: row.user_id, tenantId: row.tenant_id, tenantSlug: row.tenant_slug, role: row.role };
}
