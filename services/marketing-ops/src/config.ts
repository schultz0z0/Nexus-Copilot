import { z } from 'zod';
import { assertIanaTimeZone, DEFAULT_TENANT_TIME_ZONE } from './domain/scheduling.js';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  corsOrigins: string[];
  internalKey: string;
  tenantTimeZone: string;
  delegation: {
    activeKid: string;
    activeKey: string;
    previousKid?: string;
    previousKey?: string;
    issuer: string;
    audience: string;
    maxTtlSeconds: number;
  };
  delegationRefresh: {
    url: string;
    internalKey: string;
    timeoutMs: number;
  };
  artifact: {
    url: string;
    internalKey: string;
    timeoutMs: number;
  };
  rag: {
    url: string;
    timeoutMs: number;
  };
  features: { read: boolean; write: boolean; approvals: boolean };
  approvalExpiry: { intervalMs: number; batchSize: number };
}

const placeholderPattern = /^(?:(?:change|replace)[-_]?me|example|placeholder|secret|postgres)(?:[-_].*)?$/i;

function requiredProductionValue(env: NodeJS.ProcessEnv, name: string, fallback: string, production: boolean): string {
  const value = env[name]?.trim();
  if (!value) {
    if (production) throw new Error(`${name} is required in production`);
    return fallback;
  }
  if (production && (placeholderPattern.test(value) || value.includes('change-me'))) {
    throw new Error(`${name} contains a placeholder`);
  }
  return value;
}

function booleanValue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const nodeEnv = z.enum(['development', 'test', 'production']).parse(env.NODE_ENV ?? 'development');
  const production = nodeEnv === 'production';
  const databaseUrl = requiredProductionValue(env, 'DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:55322/postgres', production);
  const supabaseUrl = requiredProductionValue(env, 'NEXUS_APP_SUPABASE_URL', 'http://127.0.0.1:55321', production);
  const internalKey = requiredProductionValue(env, 'MARKETING_OPS_INTERNAL_KEY', 'local-test-internal-key-at-least-32-bytes', production);
  const delegationRefreshUrl = requiredProductionValue(
    env,
    'MARKETING_OPS_DELEGATION_REFRESH_URL',
    'http://127.0.0.1:8081/internal/marketing-ops/delegations/refresh',
    production
  );
  const artifactUrl = requiredProductionValue(
    env,
    'MARKETING_OPS_ARTIFACT_URL',
    'http://127.0.0.1:8095',
    production
  );
  const artifactInternalKey = requiredProductionValue(
    env,
    'MARKETING_OPS_ARTIFACT_INTERNAL_KEY',
    'local-test-artifact-key',
    production
  );
  const ragUrl = requiredProductionValue(
    env,
    'MARKETING_OPS_RAG_URL',
    'http://127.0.0.1:8000/mcp',
    production
  );
  const supabaseAnonKey = requiredProductionValue(env, 'NEXUS_APP_SUPABASE_ANON_KEY', 'local-test-anon-key', production);
  const previousKid = env.MARKETING_OPS_DELEGATION_PREVIOUS_KID?.trim();
  const previousKey = env.MARKETING_OPS_DELEGATION_PREVIOUS_KEY?.trim();
  if (Boolean(previousKid) !== Boolean(previousKey)) {
    throw new Error('previous delegation kid and key must be configured together');
  }

  const delegation: AppConfig['delegation'] = {
    activeKid: requiredProductionValue(env, 'MARKETING_OPS_DELEGATION_ACTIVE_KID', 'local-v1', production),
    activeKey: requiredProductionValue(env, 'MARKETING_OPS_DELEGATION_ACTIVE_KEY', 'local-test-delegation-key-at-least-32-bytes', production),
    issuer: env.MARKETING_OPS_DELEGATION_ISSUER?.trim() || 'nexus-chat-bridge',
    audience: env.MARKETING_OPS_DELEGATION_AUDIENCE?.trim() || 'nexus-marketing-ops',
    maxTtlSeconds: z.coerce.number().int().min(15).max(120).parse(env.MARKETING_OPS_DELEGATION_MAX_TTL_SECONDS ?? 120)
  };
  if (previousKid && previousKey) {
    delegation.previousKid = previousKid;
    delegation.previousKey = previousKey;
  }

  return {
    nodeEnv,
    port: z.coerce.number().int().min(1).max(65535).parse(env.MARKETING_OPS_PORT ?? 8091),
    databaseUrl,
    supabaseUrl,
    supabaseAnonKey,
    corsOrigins: (env.MARKETING_OPS_CORS_ORIGINS ?? 'http://127.0.0.1:8088,http://localhost:5173')
      .split(',').map((value) => value.trim()).filter(Boolean),
    internalKey,
    tenantTimeZone: assertIanaTimeZone(
      env.MARKETING_OPS_TENANT_TIME_ZONE?.trim() || DEFAULT_TENANT_TIME_ZONE
    ),
    delegation,
    delegationRefresh: {
      url: z.string().url().parse(delegationRefreshUrl),
      internalKey,
      timeoutMs: z.coerce.number().int().min(100).max(10_000).parse(env.MARKETING_OPS_DELEGATION_REFRESH_TIMEOUT_MS ?? 2_000)
    },
    artifact: {
      url: z.string().url().parse(artifactUrl),
      internalKey: artifactInternalKey,
      timeoutMs: z.coerce.number().int().min(100).max(30_000).parse(env.MARKETING_OPS_ARTIFACT_TIMEOUT_MS ?? 5_000)
    },
    rag: {
      url: z.string().url().parse(ragUrl),
      timeoutMs: z.coerce.number().int().min(100).max(30_000).parse(env.MARKETING_OPS_RAG_TIMEOUT_MS ?? 5_000)
    },
    features: {
      read: booleanValue(env.MARKETING_OPS_FEATURE_READ),
      write: booleanValue(env.MARKETING_OPS_FEATURE_WRITE),
      approvals: booleanValue(env.MARKETING_OPS_FEATURE_APPROVALS)
    },
    approvalExpiry: {
      intervalMs: z.coerce.number().int().min(5_000).max(3_600_000)
        .parse(env.MARKETING_OPS_APPROVAL_EXPIRY_INTERVAL_MS ?? 30_000),
      batchSize: z.coerce.number().int().min(1).max(100)
        .parse(env.MARKETING_OPS_APPROVAL_EXPIRY_BATCH_SIZE ?? 100)
    }
  };
}
