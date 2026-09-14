import { describe, expect, it } from 'vitest';
import { assertMarketingOpsMcpContract, MARKETING_OPS_MCP_TOOLS } from './smoke.js';

describe('Marketing Ops MCP smoke contract', () => {
  it('accepts the complete public contract', () => {
    expect(() => assertMarketingOpsMcpContract(
      MARKETING_OPS_MCP_TOOLS.map((name) => ({ name })),
      {
        contractVersion: 1,
        features: { read: true, write: true, structuredPlanExecution: true },
        delegationRequiredForDomain: true,
        conversationalConfirmationRequiredForWrites: true,
        browserWriteExecution: 'product_ui_only'
      }
    )).not.toThrow();
  });

  it('rejects a browser contract that permits conversational execution', () => {
    expect(() => assertMarketingOpsMcpContract(
      MARKETING_OPS_MCP_TOOLS.map((name) => ({ name })),
      {
      contractVersion: 1,
      features: { read: true, write: true, structuredPlanExecution: true },
      delegationRequiredForDomain: true,
      conversationalConfirmationRequiredForWrites: true,
      browserWriteExecution: 'conversation_allowed'
    })).toThrow(/product UI/);
  });
});
