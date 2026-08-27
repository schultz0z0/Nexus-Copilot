import type { Pool } from 'pg';
import type { Actor } from '../auth/actor.js';

export interface CommandContext {
  pool: Pool;
  actor: Actor;
  correlationId: string;
  origin: 'rest' | 'mcp' | 'internal';
  operatorOrigin?: 'hermes';
  chatSessionId?: string;
  runId?: string;
  toolName?: string;
  toolCallId?: string;
  planId?: string;
  planActionIndex?: number;
  idempotencyTracker?: (hit: boolean) => void;
  faultInjector?: (point: string) => Promise<void>;
}
