import { describe, expect, it } from 'vitest';
import type { DelegatedActor } from '../delegation/verifier.js';
import { createMcpCommandContext, createMcpTrace } from './context.js';

const actor: DelegatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantSlug: 'ens',
  role: 'member',
  scopes: ['campaign:read'],
  jti: 'delegation-jti',
  correlationId: '22222222-2222-4222-8222-222222222222',
  chatSessionId: '33333333-3333-4333-8333-333333333333',
  runId: '44444444-4444-4444-8444-444444444444',
  confirmationIntent: false,
  expiresAt: 1_800_000_000
};

describe('MCP Hermes trace context', () => {
  it('uses the same identifiers in safe results and domain audit context', () => {
    const toolCallId = '55555555-5555-4555-8555-555555555555';
    const toolName = 'marketing_ops_execute_plan_v1';
    expect(createMcpTrace(actor, toolName, toolCallId)).toEqual({
      correlation_id: actor.correlationId,
      chat_session_id: actor.chatSessionId,
      run_id: actor.runId,
      tool_name: toolName,
      tool_call_id: toolCallId
    });
    expect(createMcpCommandContext({} as never, actor, toolName, toolCallId))
      .toMatchObject({
        actor,
        origin: 'mcp',
        operatorOrigin: 'hermes',
        correlationId: actor.correlationId,
        chatSessionId: actor.chatSessionId,
        runId: actor.runId,
        toolName,
        toolCallId
      });
  });
});
