import { Router } from 'express';
import type { Pool } from 'pg';
import type { SupabaseUser } from '../../auth/supabaseAuth.js';
import { authMiddleware, corsMiddleware, privateResponseMiddleware } from '../middleware.js';
import { registerAudit } from './audit.js';
import { registerCampaigns } from './campaigns.js';
import { registerCapabilities } from './capabilities.js';
import { registerItems } from './items.js';
import { registerDependencies } from './dependencies.js';
import { registerContent } from './content.js';
import { registerMaterials } from './materials.js';
import { registerParticipants } from './participants.js';
import { registerReferences } from './references.js';
import { registerTimeline } from './timeline.js';
import { registerNotifications } from './notifications.js';
import { registerApprovals } from './approvals.js';
import type { ArtifactClient } from '../../integrations/artifactClient.js';
import type { RagCourseClient } from '../../integrations/ragCourseClient.js';
import type { DelegationKeyring } from '../../delegation/claims.js';
import { createMcpRouter } from '../../mcp/http.js';
import { DEFAULT_TENANT_TIME_ZONE } from '../../domain/scheduling.js';
import type { MetricsRegistry } from '../../observability/metrics.js';

export interface ApiRouterDependencies {
  pool: Pool;
  corsOrigins: string[];
  features: { read: boolean; write: boolean; approvals?: boolean };
  verifyToken: (token: string) => Promise<SupabaseUser>;
  artifactClient: ArtifactClient;
  ragCourseClient: RagCourseClient;
  keyring?: DelegationKeyring;
  refreshDelegation?: (token: string) => Promise<string>;
  tenantTimeZone?: string;
  metrics?: Pick<MetricsRegistry, 'increment'>;
}

export function createApiRouter(deps: ApiRouterDependencies): Router {
  const router = Router();
  router.use(corsMiddleware(deps.corsOrigins));
  registerCapabilities(router, deps.features);
  router.use('/v1', privateResponseMiddleware);
  router.use('/v1', authMiddleware(deps.pool, deps.verifyToken));
  registerCampaigns(router, deps.pool, deps.ragCourseClient, deps.features);
  registerParticipants(router, deps.pool, deps.features);
  registerMaterials(router, deps.pool, deps.artifactClient, deps.features);
  registerReferences(router, deps.ragCourseClient, deps.features);
  registerTimeline(router, deps.pool, deps.features);
  registerItems(
    router,
    deps.pool,
    deps.features,
    deps.tenantTimeZone ?? DEFAULT_TENANT_TIME_ZONE
  );
  registerNotifications(router, deps.pool, deps.features);
  registerDependencies(router, deps.pool, deps.features);
  registerContent(router, deps.pool, deps.artifactClient, deps.features);
  registerApprovals(router, deps.pool, deps.features);
  registerAudit(router, deps.pool, deps.features);
  if (deps.keyring) router.use(createMcpRouter({
    pool: deps.pool,
    features: deps.features,
    keyring: deps.keyring,
    artifactClient: deps.artifactClient,
    ...(deps.metrics ? { metrics: deps.metrics } : {}),
    ...(deps.refreshDelegation ? { refreshDelegation: deps.refreshDelegation } : {})
  }));
  return router;
}
