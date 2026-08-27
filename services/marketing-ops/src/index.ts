import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './http/createApp.js';
import { createApiRouter } from './http/routes/index.js';
import { verifySupabaseBearer } from './auth/supabaseAuth.js';
import { createLogger } from './observability/logger.js';
import { createMetrics } from './observability/metrics.js';
import { createReadinessProbe } from './observability/readiness.js';
import { collectWorkspaceMetrics } from './observability/workspaceMetrics.js';
import { createDelegationRefresher } from './delegation/refresher.js';
import { ArtifactClient } from './integrations/artifactClient.js';
import { RagCourseClient } from './integrations/ragCourseClient.js';
import { startApprovalExpiryWorker } from './domain/approvalExpiryWorker.js';

const config = loadConfig(process.env);
const logger = createLogger();
const metrics = createMetrics();
const pool = createPool(config.databaseUrl);
const router = createApiRouter({
  pool,
  corsOrigins: config.corsOrigins,
  features: config.features,
  artifactClient: new ArtifactClient({
    baseUrl: config.artifact.url,
    internalKey: config.artifact.internalKey,
    timeoutMs: config.artifact.timeoutMs
  }),
  ragCourseClient: new RagCourseClient({
    endpoint: config.rag.url,
    timeoutMs: config.rag.timeoutMs
  }),
  tenantTimeZone: config.tenantTimeZone,
  metrics,
  keyring: config.delegation,
  refreshDelegation: createDelegationRefresher(config.delegationRefresh),
  verifyToken: (token) => verifySupabaseBearer(token, {
    supabaseUrl: config.supabaseUrl,
    anonKey: config.supabaseAnonKey
  })
});
const app = createApp({
  logger,
  metrics,
  internalKey: config.internalKey,
  outboxDepth: async () => {
    const result = await pool.query<{ count: string }>(
      'select count(*) from marketing_ops.domain_events where published_at is null and available_at <= now()'
    );
    return Number(result.rows[0]?.count ?? 0);
  },
  collectWorkspaceMetrics: () => collectWorkspaceMetrics(pool),
  router,
  readiness: createReadinessProbe({
    checkDatabase: () => pool.query('select 1'),
    artifact: { endpoint: config.artifact.url, timeoutMs: config.artifact.timeoutMs },
    rag: { endpoint: config.rag.url, timeoutMs: config.rag.timeoutMs },
    metrics,
    logger
  })
});
const server = createServer(app);
server.listen(config.port, '0.0.0.0', () => logger.info('marketing-ops started', { port: config.port }));
const stopApprovalExpiryWorker = config.features.write && config.features.approvals
  ? startApprovalExpiryWorker(pool, {
    ...config.approvalExpiry,
    onError: (error) => logger.error('approval expiry worker failed', { cause: error })
  })
  : () => undefined;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopApprovalExpiryWorker();
  logger.info('marketing-ops stopping', { signal });
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
