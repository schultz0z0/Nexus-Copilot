import { describe, expect, it } from 'vitest';
import { assertMarketingOpsMcpContract, MARKETING_OPS_MCP_TOOLS } from './smoke.js';

describe('Marketing Ops MCP smoke contract', () => {
  it('accepts the complete public contract', () => {
    expect(() => assertMarketingOpsMcpContract(
      MARKETING_OPS_MCP_TOOLS.map((name) => ({ name })),
      {
        contractVersion: 1,
        features: { read: true, write: true },
        delegationRequiredForDomain: true,
        conversationalConfirmationRequiredForWrites: true
      }
    )).not.toThrow();
  });

  it('rejects missing tools and weakened write confirmation', () => {
    expect(() => assertMarketingOpsMcpContract([], {
      contractVersion: 1,
      features: { read: true, write: true },
      delegationRequiredForDomain: true,
      conversationalConfirmationRequiredForWrites: false
    })).toThrow(/missing MCP tools/);
  });
});
