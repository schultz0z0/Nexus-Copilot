import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { AppError, appError, errorEnvelope } from '../errors.js';
import type { Logger } from '../observability/logger.js';
import type { MetricsRegistry } from '../observability/metrics.js';

export interface AppDependencies {
  readiness: () => Promise<boolean | ReadinessReport>;
  logger: Logger;
  metrics: MetricsRegistry;
  internalKey?: string;
  outboxDepth?: () => Promise<number>;
  collectWorkspaceMetrics?: () => Promise<WorkspaceMetricsSnapshot>;
  rateLimit?: { max: number; windowMs: number };
  router?: Router;
}

type CampaignMetricStatus = 'draft' | 'planned' | 'active' | 'completed' | 'archived';

export interface WorkspaceMetricsSnapshot {
  campaignsCreated: number;
  campaignsWithoutOwner: number;
  activeUsers24h: number;
  briefingCompletionRatio: number;
  timeToPlannedSeconds: { count: number; sum: number };
  statusTransitions: Array<{ from: CampaignMetricStatus; to: CampaignMetricStatus; count: number }>;
  productionItems: Array<{
    status: 'draft' | 'ready' | 'in_review' | 'completed' | 'cancelled';
    kind: 'task' | 'email' | 'whatsapp' | 'post' | 'creative' | 'review' | 'milestone';
    count: number;
  }>;
}

export interface ReadinessReport {
  ready: boolean;
  checks: {
    database: boolean;
    artifact: boolean;
    rag: boolean;
  };
}

type MutationOperation =
  | 'create'
  | 'update'
  | 'transition'
  | 'archive'
  | 'participant_add'
  | 'participant_update'
  | 'participant_remove'
  | 'material_upload'
  | 'material_link'
  | 'material_unlink';

const mutationOperations = new Map<string, MutationOperation>([
  ['POST /v1/campaigns', 'create'],
  ['PATCH /v1/campaigns/:id', 'update'],
  ['POST /v1/campaigns/:id/transitions', 'transition'],
  ['POST /v1/campaigns/:id/archive', 'archive'],
  ['POST /v1/campaigns/:campaignId/participants', 'participant_add'],
  ['PATCH /v1/campaigns/:campaignId/participants/:userId', 'participant_update'],
  ['DELETE /v1/campaigns/:campaignId/participants/:userId', 'participant_remove'],
  ['POST /v1/campaigns/:campaignId/materials/upload', 'material_upload'],
  ['POST /v1/campaigns/:campaignId/materials/link', 'material_link'],
  ['DELETE /v1/campaigns/:campaignId/materials/:materialId', 'material_unlink']
]);

function routePattern(request: Request): string {
  return typeof request.route?.path === 'string' ? request.route.path : 'unmatched';
}

function operationStatus(status: number): 'success' | 'conflict' | 'forbidden' | 'validation_error' | 'not_found' | 'error' {
  if (status >= 200 && status < 400) return 'success';
  if (status === 409) return 'conflict';
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 413 || status === 422) return 'validation_error';
  return 'error';
}

function logOperation(method: string, route: string, mutation?: MutationOperation): string {
  if (mutation) return mutation;
  if (route === '/health') return 'health';
  if (route === '/ready') return 'readiness';
  if (route === '/metrics') return 'metrics';
  if (route.endsWith('/access-link')) return 'material_access';
  if (route === '/v1/references/courses') return 'reference_lookup';
  if (route.endsWith('/timeline')) return 'timeline_list';
  return method === 'GET' ? 'read' : 'unmatched';
}

function materialResult(status: number): 'success' | 'invalid' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable' | 'error' {
  const result = operationStatus(status);
  if (result === 'validation_error') return 'invalid';
  if (status === 503) return 'unavailable';
  return result;
}

function referenceResult(status: number): 'success' | 'unavailable' | 'forbidden' | 'error' {
  if (status >= 200 && status < 400) return 'success';
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 503) return 'unavailable';
  return 'error';
}

type OperationResult = ReturnType<typeof operationStatus>;
type ProductionScheduleView = 'list' | 'week' | 'month';
type ProductionBatchAction = 'reassign' | 'priority' | 'reschedule';
type ItemConflictOperation = 'update' | 'transition' | 'dependency' | 'content' | 'artifact' | 'batch';

interface ProductionLocals {
  productionScheduleView?: ProductionScheduleView;
  productionBatch?: { action: ProductionBatchAction; results: OperationResult[] };
  contentVersionCreated?: boolean;
  notificationsProduced?: number;
}

interface ApprovalLocals {
  approvalTransition?: {
    kind: 'editorial' | 'operational';
    status: 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'cancelled' | 'expired';
    risk: 'low' | 'medium' | 'high' | 'critical';
  };
}

function itemConflictOperation(route: string): ItemConflictOperation | null {
  if (route === '/v1/campaign-items/batch') return 'batch';
  if (route.endsWith('/transition')) return 'transition';
  if (route.includes('/dependencies')) return 'dependency';
  if (route.includes('/content-assets') || route.startsWith('/v1/content-assets/')) return 'content';
  if (route.includes('/artifacts')) return 'artifact';
  if (route.startsWith('/v1/campaign-items/')) return 'update';
  return null;
}

declare global {
  namespace Express {
    interface Request { correlationId: string }
  }
}

export function createApp(deps: AppDependencies) {
  const app = express();
  const clients = new Map<string, { count: number; resetAt: number }>();
  const rateLimit = deps.rateLimit ?? { max: 120, windowMs: 60_000 };
  app.disable('x-powered-by');
  // Production traffic arrives through one trusted Traefik hop.
  app.set('trust proxy', 1);
  // Content versions allow a 1 MiB body plus bounded JSON metadata/envelope.
  app.use(express.json({ limit: '1100kb' }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    const supplied = request.header('x-correlation-id')?.trim();
    request.correlationId = supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied)
      ? supplied
      : randomUUID();
    response.setHeader('X-Correlation-Id', request.correlationId);
    response.on('finish', () => {
      const route = routePattern(request);
      const status = response.statusCode;
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      const labels = { route, status: String(status) };
      deps.metrics.increment('marketing_ops_requests_total', labels);
      deps.metrics.increment('marketing_ops_request_duration_seconds_count', labels);
      deps.metrics.increment(
        'marketing_ops_request_duration_seconds_sum',
        labels,
        durationSeconds
      );
      const mutation = mutationOperations.get(`${request.method} ${route}`);
      if (mutation) {
        deps.metrics.increment('marketing_ops_campaign_mutations_total', {
          operation: mutation,
          status: operationStatus(status)
        });
      }
      if (status === 409) {
        deps.metrics.increment('marketing_ops_campaign_conflicts_total');
      }
      const materialOperation = mutation === 'material_upload'
        ? 'upload'
        : mutation === 'material_link'
          ? 'link'
          : mutation === 'material_unlink'
            ? 'unlink'
            : route.endsWith('/access-link')
              ? 'access'
              : null;
      if (materialOperation) {
        deps.metrics.increment('marketing_ops_material_operations_total', {
          operation: materialOperation,
          result: materialResult(status)
        });
      }
      if (mutation === 'material_upload' && status >= 200 && status < 300) {
        const bytes = Number(request.header('content-length') ?? 0);
        if (Number.isFinite(bytes) && bytes > 0) deps.metrics.increment('marketing_ops_artifact_bytes_total', {}, bytes);
      }
      if (route === '/v1/references/courses') {
        deps.metrics.increment('marketing_ops_reference_lookup_total', { result: referenceResult(status) });
      }
      const productionLocals = response.locals as ProductionLocals & ApprovalLocals;
      if (route === '/v1/campaign-items' && request.method === 'GET') {
        const view = productionLocals.productionScheduleView ?? 'list';
        const result = operationStatus(status);
        deps.metrics.increment('marketing_ops_schedule_queries_total', { view, result });
        deps.metrics.increment('marketing_ops_schedule_query_duration_seconds_count', { view, result });
        deps.metrics.increment(
          'marketing_ops_schedule_query_duration_seconds_sum',
          { view, result },
          durationSeconds
        );
      }
      if (productionLocals.productionBatch) {
        for (const result of productionLocals.productionBatch.results) {
          deps.metrics.increment('marketing_ops_batch_items_total', {
            action: productionLocals.productionBatch.action,
            result
          });
        }
      }
      if (productionLocals.contentVersionCreated && status >= 200 && status < 300) {
        deps.metrics.increment('marketing_ops_content_versions_created_total');
      }
      if (
        typeof productionLocals.notificationsProduced === 'number'
        && productionLocals.notificationsProduced > 0
      ) {
        deps.metrics.increment(
          'marketing_ops_notifications_produced_total',
          {},
          productionLocals.notificationsProduced
        );
      }
      if (productionLocals.approvalTransition) {
        deps.metrics.increment('marketing_ops_approval_transitions_total', {
          ...productionLocals.approvalTransition,
          result: operationStatus(status)
        });
      }
      if (status === 409) {
        const itemOperation = itemConflictOperation(route);
        if (itemOperation) {
          deps.metrics.increment('marketing_ops_item_conflicts_total', { operation: itemOperation });
        }
      }
      deps.logger.info('request completed', {
        correlationId: request.correlationId,
        route,
        operation: logOperation(request.method, route, mutation),
        status,
        durationMs: Number((durationSeconds * 1000).toFixed(3))
      });
    });
    next();
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    if (clients.size > 10_000) {
      for (const [client, entry] of clients) if (entry.resetAt <= now) clients.delete(client);
    }
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    const previous = clients.get(key);
    const entry = !previous || previous.resetAt <= now
      ? { count: 1, resetAt: now + rateLimit.windowMs }
      : { count: previous.count + 1, resetAt: previous.resetAt };
    clients.set(key, entry);
    response.setHeader('RateLimit-Limit', String(rateLimit.max));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, rateLimit.max - entry.count)));
    if (entry.count > rateLimit.max) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return next(appError('rate_limited', 429, 'Too many requests'));
    }
    next();
  });
  app.get('/health', (_request, response) => response.json({ status: 'ok', service: 'marketing-ops' }));
  app.get('/ready', async (_request, response, next) => {
    try {
      const result = await deps.readiness();
      const ready = typeof result === 'boolean' ? result : result.ready;
      response.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not_ready',
        ...(typeof result === 'boolean' ? {} : {
          checks: Object.fromEntries(Object.entries(result.checks).map(([dependency, available]) => [
            dependency,
            available ? 'ok' : 'unavailable'
          ]))
        })
      });
    } catch (error) {
      next(appError('dependency_unavailable', 503, 'A required dependency is unavailable'));
    }
  });
  if (deps.internalKey) {
    app.get('/metrics', async (request, response, next) => {
      if (request.header('x-internal-key') !== deps.internalKey) {
        return next(appError('unauthorized', 401, 'A valid internal key is required'));
      }
      try {
        if (deps.outboxDepth) deps.metrics.set('marketing_ops_outbox_unpublished', await deps.outboxDepth());
        if (deps.collectWorkspaceMetrics) {
          const snapshot = await deps.collectWorkspaceMetrics();
          deps.metrics.set('marketing_ops_campaigns_created_total', snapshot.campaignsCreated);
          deps.metrics.set('marketing_ops_campaigns_without_owner', snapshot.campaignsWithoutOwner);
          deps.metrics.set('marketing_ops_workspace_active_users_24h', snapshot.activeUsers24h);
          deps.metrics.set('marketing_ops_briefing_completion_ratio', snapshot.briefingCompletionRatio);
          deps.metrics.set('marketing_ops_time_to_planned_seconds_count', snapshot.timeToPlannedSeconds.count);
          deps.metrics.set('marketing_ops_time_to_planned_seconds_sum', snapshot.timeToPlannedSeconds.sum);
          for (const transition of snapshot.statusTransitions) {
            deps.metrics.set('marketing_ops_campaign_status_transitions_total', transition.count, {
              from: transition.from,
              to: transition.to
            });
          }
          for (const item of snapshot.productionItems) {
            deps.metrics.set('marketing_ops_production_items', item.count, {
              status: item.status,
              kind: item.kind
            });
          }
        }
        response.type('text/plain; version=0.0.4').send(deps.metrics.render());
      } catch {
        next(appError('dependency_unavailable', 503, 'Metrics dependency is unavailable'));
      }
    });
  }
  if (deps.router) app.use(deps.router);
  app.use((_request, _response, next) => next(appError('not_found', 404, 'Route not found')));
  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    let normalized: AppError;
    if (error instanceof AppError) {
      normalized = error;
    } else if (
      error instanceof Error &&
      (error as Error & { type?: string }).type === 'entity.too.large'
    ) {
      normalized = appError('payload_too_large', 413, 'JSON payload exceeds the allowed size');
    } else if (error instanceof Error && error.name === 'ZodError') {
      const issues = (error as any).issues;
      normalized = appError('validation_error', 400, 'Request validation failed', { issues });
      deps.logger.warn('Zod validation failed', { correlationId: request.correlationId, issues });
    } else {
      normalized = appError('internal_error', 500, 'Internal server error');
    }
    deps.metrics.increment('marketing_ops_errors_total', { code: normalized.code, status: String(normalized.status) });
    if (normalized.code === 'dependency_cycle') {
      deps.metrics.increment('marketing_ops_dependency_cycles_rejected_total');
    }
    if (normalized.code === 'version_conflict') {
      deps.metrics.increment('marketing_ops_campaign_version_conflicts_total');
    }
    if (normalized.status >= 500) {
      deps.logger.error(normalized.message, { correlationId: request.correlationId, cause: error });
    }
    response.status(normalized.status).json(errorEnvelope(normalized, request.correlationId));
  });
  return app;
}
