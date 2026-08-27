import { describe, expect, it } from 'vitest';
import {
  ActionPackageInputSchema,
  canonicalActionPackage,
  hashActionPackage
} from './actionPackages.js';

const input = {
  actionType: 'campaign.channel_dispatch',
  channel: 'email',
  audienceSnapshot: { source: 'test-segment', count: 10 },
  scheduledFor: '2026-08-10T13:00:00.000Z',
  timeZone: 'America/Sao_Paulo',
  configuration: { mode: 'sandbox' },
  successCriteria: 'provider accepted',
  riskSummary: 'homologation only',
  payload: { contentVersion: 2, template: 'test' }
};

describe('immutable operational action package', () => {
  it('produces a stable hash independent of JSON key order', () => {
    const reordered = {
      ...input,
      audienceSnapshot: { count: 10, source: 'test-segment' },
      payload: { template: 'test', contentVersion: 2 }
    };
    expect(hashActionPackage(input)).toBe(hashActionPackage(reordered));
    expect(hashActionPackage(input)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes an explicit immutable snapshot and rejects unknown fields', () => {
    expect(canonicalActionPackage(input)).toEqual(input);
    expect(ActionPackageInputSchema.safeParse({ ...input, providerExecution: true }).success)
      .toBe(false);
  });
});
