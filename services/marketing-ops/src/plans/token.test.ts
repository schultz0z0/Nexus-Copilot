import { describe, expect, it } from 'vitest';
import type { DelegatedActor } from '../delegation/verifier.js';
import type { MarketingOpsPlanAction } from './contracts.js';
import { issueMarketingOpsPlan, verifyMarketingOpsPlan } from './token.js';

const activeKey = 'active-local-delegation-key-at-least-32-bytes';
const previousKey = 'previous-local-delegation-key-32-bytes';
const keyring = {
  activeKid: 'v2', activeKey, previousKid: 'v1', previousKey,
  issuer: 'nexus-chat-bridge', audience: 'nexus-marketing-ops', maxTtlSeconds: 120
};
const actions: MarketingOpsPlanAction[] = [{
  type: 'campaign.create_draft', ref: 'campaign-main', name: 'Volta as aulas'
}];

function actor(overrides: Partial<DelegatedActor> = {}): DelegatedActor {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenantSlug: 'ens',
    role: 'member',
    scopes: ['campaign:read', 'campaign:write', 'item:write'],
    jti: 'preparation-jti',
    correlationId: '33333333-3333-4333-8333-333333333333',
    chatSessionId: '22222222-2222-4222-8222-222222222222',
    runId: '33333333-3333-4333-8333-333333333333',
    confirmationIntent: false,
    expiresAt: 1_800_000_000,
    ...overrides
  };
}

describe('signed Marketing Ops plans', () => {
  it('binds an exact plan to a later confirmed turn for the same actor and session', async () => {
    const prepared = await issueMarketingOpsPlan(actor(), actions, keyring, { now: 1_700_000_000 });
    const verified = await verifyMarketingOpsPlan(prepared.token, actor({
      jti: 'confirmation-jti', confirmationIntent: true
    }), keyring, { now: 1_700_000_030 });

    expect(verified).toMatchObject({
      plan_id: prepared.planId,
      sub: actor().userId,
      tenant_id: actor().tenantId,
      chat_session_id: actor().chatSessionId,
      prepared_jti: 'preparation-jti',
      actions
    });
  });

  it('rejects execution in the preparation turn or without explicit confirmation', async () => {
    const prepared = await issueMarketingOpsPlan(actor(), actions, keyring, { now: 1_700_000_000 });
    await expect(verifyMarketingOpsPlan(
      prepared.token,
      actor({ confirmationIntent: true }),
      keyring,
      { now: 1_700_000_010 }
    )).rejects.toMatchObject({ code: 'confirmation_required' });
    await expect(verifyMarketingOpsPlan(
      prepared.token,
      actor({ jti: 'later-unconfirmed-jti' }),
      keyring,
      { now: 1_700_000_010 }
    )).rejects.toMatchObject({ code: 'confirmation_required' });
  });

  it('rejects changed identity, expired plans and tampering', async () => {
    const prepared = await issueMarketingOpsPlan(actor(), actions, keyring, {
      now: 1_700_000_000,
      ttlSeconds: 60
    });
    const confirmed = actor({ jti: 'confirmation-jti', confirmationIntent: true });
    await expect(verifyMarketingOpsPlan(
      prepared.token,
      actor({ ...confirmed, tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      keyring,
      { now: 1_700_000_030 }
    )).rejects.toMatchObject({ code: 'plan_invalid' });
    await expect(verifyMarketingOpsPlan(
      prepared.token,
      confirmed,
      keyring,
      { now: 1_700_000_120 }
    )).rejects.toMatchObject({ code: 'plan_expired' });
    const [header, payload, signature] = prepared.token.split('.') as [string, string, string];
    const tampered = `${header}.${payload}.${signature.startsWith('a') ? 'b' : 'a'}${signature.slice(1)}`;
    await expect(verifyMarketingOpsPlan(
      tampered,
      confirmed,
      keyring,
      { now: 1_700_000_030 }
    )).rejects.toMatchObject({ code: 'plan_invalid' });
  });

  it('accepts a plan signed before key rotation through the previous key', async () => {
    const oldKeyring = { ...keyring, activeKid: 'v1', activeKey: previousKey };
    const prepared = await issueMarketingOpsPlan(actor(), actions, oldKeyring, { now: 1_700_000_000 });
    const verified = await verifyMarketingOpsPlan(
      prepared.token,
      actor({ jti: 'confirmation-jti', confirmationIntent: true }),
      keyring,
      { now: 1_700_000_030 }
    );
    expect(verified.plan_id).toBe(prepared.planId);
  });
});
