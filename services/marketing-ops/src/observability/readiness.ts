import type { ReadinessReport } from '../http/createApp.js';
import type { Logger } from './logger.js';
import type { MetricsRegistry } from './metrics.js';

type DependencyName = 'database' | 'artifact' | 'rag';
type ProbeStatus = 'ok' | 'error' | 'timeout';

interface HttpDependency {
  endpoint: string;
  timeoutMs: number;
}

interface ReadinessProbeOptions {
  checkDatabase: () => Promise<unknown>;
  artifact: HttpDependency;
  rag: HttpDependency;
  metrics: MetricsRegistry;
  logger: Logger;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

function healthEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = '/health';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function failureStatus(error: unknown): ProbeStatus {
  const name = error instanceof Error ? error.name : '';
  return name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'error';
}

export function createReadinessProbe(options: ReadinessProbeOptions): () => Promise<ReadinessReport> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const probe = async (dependency: DependencyName, action: () => Promise<unknown>): Promise<boolean> => {
    try {
      await action();
      options.metrics.increment('marketing_ops_dependency_requests_total', { dependency, status: 'ok' });
      return true;
    } catch (error) {
      const status = failureStatus(error);
      options.metrics.increment('marketing_ops_dependency_requests_total', { dependency, status });
      options.logger.warn('readiness dependency unavailable', { dependency, status });
      return false;
    }
  };

  const probeHttp = (dependency: 'artifact' | 'rag', config: HttpDependency) => probe(dependency, async () => {
    const response = await fetchImpl(healthEndpoint(config.endpoint), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.timeoutMs)
    });
    if (!response.ok) throw new Error('dependency healthcheck failed');
  });

  return async () => {
    const startedAt = process.hrtime.bigint();
    const [database, artifact, rag] = await Promise.all([
      probe('database', options.checkDatabase),
      probeHttp('artifact', options.artifact),
      probeHttp('rag', options.rag)
    ]);
    const ready = database && artifact && rag;
    const result = ready ? 'ready' : 'not_ready';
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    options.metrics.increment('marketing_ops_readiness_total', { result });
    options.metrics.increment('marketing_ops_readiness_duration_seconds_count', { result });
    options.metrics.increment('marketing_ops_readiness_duration_seconds_sum', { result }, durationSeconds);
    return {
      ready,
      checks: { database, artifact, rag }
    };
  };
}
