import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { DelegatedActor } from '../delegation/verifier.js';
import type { CommandContext } from '../domain/context.js';

export interface McpTrace {
  [key: string]: string;
  correlation_id: string;
  chat_session_id: string;
  run_id: string;
  tool_name: string;
  tool_call_id: string;
}

export function createMcpTrace(
  actor: DelegatedActor,
  toolName: string,
  toolCallId: string = randomUUID()
): McpTrace {
  return {
    correlation_id: actor.correlationId,
    chat_session_id: actor.chatSessionId,
    run_id: actor.runId,
    tool_name: toolName,
    tool_call_id: toolCallId
  };
}

export function createMcpCommandContext(
  pool: Pool,
  actor: DelegatedActor,
  toolName: string,
  toolCallId: string = randomUUID()
): CommandContext {
  return {
    pool,
    actor,
    correlationId: actor.correlationId,
    origin: 'mcp',
    operatorOrigin: 'hermes',
    chatSessionId: actor.chatSessionId,
    runId: actor.runId,
    toolName,
    toolCallId
  };
}
