import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createApp } from './http/createApp.js';
import { createApiRouter } from './http/routes/index.js';
import { verifyBffAssertion } from './auth/bffAssertion.js';
import { createLogger } from './observability/logger.js';
import { createMetrics } from './observability/metrics.js';
import { createReadinessProbe } from './observability/readiness.js';
import { collectWorkspaceMetrics } from './observability/workspaceMetrics.js';
import { createDelegationRefresher } from './delegation/refresher.js';
import { createDelegationResolver } from './delegation/resolver.js';
import { ArtifactClient } from './integrations/artifactClient.js';
import { RagCourseClient } from './integrations/ragCourseClient.js';
import { startApprovalExpiryWorker } from './domain/approvalExpiryWorker.js';
import { AdsIntegrationService } from './domain/ads.js';
import { loadAdsConfig } from './integrations/ads/config.js';
import { createAdsProviderClient } from './integrations/ads/providers.js';
import { adsProviders, type AdsProvider, type AdsProviderClient } from './integrations/ads/types.js';
import { openAdsSetupStore } from './integrations/ads/setupStore.js';
import { resolve } from 'node:path';
import { WebAnalyticsService } from './domain/webAnalytics.js';
import { WorkspaceIntegrationService } from './domain/workspace.js';

const config = loadConfig(process.env);
const logger = createLogger();
const metrics = createMetrics();
const pool = createPool(config.databaseUrl);
const operationalAdsConfig = loadAdsConfig(process.env);
const adsStore = await openAdsSetupStore(pool, process.env.ADS_SETUP_DIRECTORY || resolve('data/ads'), operationalAdsConfig.encryptionKey);
const adsConfig = loadAdsConfig(process.env, adsStore.key);
const adsClients: Partial<Record<AdsProvider, AdsProviderClient>> = {};
for (const provider of adsProviders) {
  const settings = adsConfig.providers[provider];
  if (settings) adsClients[provider] = createAdsProviderClient(provider, settings);
}
const adsService = new AdsIntegrationService(pool, adsConfig, adsClients, { store: adsStore });
const webAnalyticsService=new WebAnalyticsService(pool,adsService);
const workspaceService = new WorkspaceIntegrationService(pool, {
  key: adsStore.key,
  publicOrigin: adsConfig.publicOrigin ?? '',
  setupDirectory: resolve(process.env.ADS_SETUP_DIRECTORY || 'data/ads', 'workspace'),
  googleFallback: async context => {
    const runtime = await adsService.analyticsRuntime(context);
    if (!runtime.google) return null;
    return {
      clientId: runtime.google.clientId,
      clientSecret: runtime.google.clientSecret,
      redirectUri: runtime.google.redirectUri
    };
  }
});
const router = createApiRouter({
  pool,
  adsService,
  webAnalyticsService,
  workspaceService,
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
  captureKeyring: config.bffAssertion,
  resolveDelegation: createDelegationResolver(config.delegationResolve),
  refreshDelegation: createDelegationRefresher(config.delegationRefresh),
  verifyAssertion: (token, method, path) => verifyBffAssertion(
    token, method, path, config.bffAssertion
  )
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
server.listen(config.port, '0.0.0.0', () => logger.info('marketing-ops started', {
  port: config.port,
  features: config.features
}));
const stopApprovalExpiryWorker = config.features.write && config.features.approvals
  ? startApprovalExpiryWorker(pool, {
    ...config.approvalExpiry,
    onError: (error) => logger.error('approval expiry worker failed', { cause: error })
  })
  : () => undefined;

// Durable work/generation checks live in AdsIntegrationService. This process
// trigger only avoids overlapping ticks and observes the application kill switch.
let adsTickRunning = false;
let analyticsTickRunning=false;
const analyticsTimer=config.features.read&&config.features.write?setInterval(()=>{
  if(analyticsTickRunning||shuttingDown)return;
  analyticsTickRunning=true;
  void webAnalyticsService.syncDue().catch(()=>logger.error('analytics synchronization tick failed',{code:'analytics_sync_tick_failed'})).finally(()=>{analyticsTickRunning=false;});
},60_000):undefined;
analyticsTimer?.unref();
const adsTimer = config.features.read && config.features.write
  ? setInterval(() => {
    if (adsTickRunning || shuttingDown) return;
    adsTickRunning = true;
    void adsService.syncDue().catch(() => {
      // Provider bodies and credential-bearing errors never enter logs.
      logger.error('ads synchronization tick failed', { code: 'ads_sync_tick_failed' });
    }).finally(() => { adsTickRunning = false; });
  }, adsConfig.syncIntervalMs)
  : undefined;
adsTimer?.unref();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (adsTimer) clearInterval(adsTimer);
  if(analyticsTimer)clearInterval(analyticsTimer);
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
