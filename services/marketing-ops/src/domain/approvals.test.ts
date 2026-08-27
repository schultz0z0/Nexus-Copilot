import { describe, expect, it } from 'vitest';
import {
  ApprovalDecisionCommandSchema,
  ApprovalDecisionInputSchema,
  ApprovalListFiltersSchema,
  EditorialApprovalCommandSchema,
  EditorialApprovalInputSchema,
  OperationalApprovalCommandSchema,
  assertApprovalDecisionEligible,
  assertValidApprovalSupersession,
  decodeApprovalCursor,
  encodeApprovalCursor
} from './approvals.js';

describe('approval contracts', () => {
  it('accepts the server-owned idempotency envelope without weakening strict payloads', () => {
    expect(EditorialApprovalCommandSchema.parse({
      campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      versionNumber: 1,
      reason: 'Review',
      expiresAt: '2026-08-10T12:00:00.000Z',
      idempotencyKey: 'editorial-1'
    }).idempotencyKey).toBe('editorial-1');
    expect(OperationalApprovalCommandSchema.safeParse({
      campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reason: 'Authorize',
      expiresAt: '2026-08-10T12:00:00.000Z',
      actionPackage: {
        actionType: 'publish_campaign',
        channel: 'email',
        audienceSnapshot: { segment: 'customers' },
        timeZone: 'America/Sao_Paulo',
        configuration: { mode: 'safe' },
        payload: { campaign: 'launch' }
      },
      idempotencyKey: 'operational-1',
      forgedRole: 'admin'
    }).success).toBe(false);
    expect(ApprovalDecisionCommandSchema.parse({
      decision: 'approved', idempotencyKey: 'decision-1'
    }).idempotencyKey).toBe('decision-1');
  });
  it('requires the exact editorial version and strict request body', () => {
    expect(EditorialApprovalInputSchema.parse({
      campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      versionNumber: 2,
      reason: 'Revisão institucional',
      expiresAt: '2026-08-10T13:00:00.000Z'
    }).versionNumber).toBe(2);
    expect(EditorialApprovalInputSchema.safeParse({
      campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      versionNumber: 2,
      reason: 'Revisão institucional',
      expiresAt: '2026-08-10T13:00:00.000Z',
      body: 'must never be copied'
    }).success).toBe(false);
  });

  it('enforces comments, role separation and operational four-eyes', () => {
    expect(ApprovalDecisionInputSchema.safeParse({ decision: 'rejected' }).success).toBe(false);
    expect(() => assertApprovalDecisionEligible({
      actorRole: 'member', actorUserId: 'a', requestedBy: 'b', kind: 'editorial', status: 'pending'
    })).toThrowError(expect.objectContaining({ code: 'forbidden' }));
    expect(() => assertApprovalDecisionEligible({
      actorRole: 'manager', actorUserId: 'a', requestedBy: 'a', kind: 'operational', status: 'pending'
    })).toThrowError(expect.objectContaining({ code: 'self_approval_forbidden' }));
    expect(() => assertApprovalDecisionEligible({
      actorRole: 'admin', actorUserId: 'b', requestedBy: 'a', kind: 'operational', status: 'pending'
    })).not.toThrow();
  });

  it('round-trips the stable queue cursor and validates filters', () => {
    const cursor = { createdAt: '2026-08-05T12:00:00.000Z', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    expect(decodeApprovalCursor(encodeApprovalCursor(cursor))).toEqual(cursor);
    expect(ApprovalListFiltersSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(() => decodeApprovalCursor('invalid')).toThrowError(expect.objectContaining({
      code: 'validation_error'
    }));
  });

  it('allows only changed targets from the same changes-requested cycle', () => {
    const predecessor = {
      campaign_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'editorial' as const,
      requested_by: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'changes_requested' as const,
      target_hash: 'a'.repeat(64)
    };
    expect(() => assertValidApprovalSupersession({
      predecessor,
      campaignId: predecessor.campaign_id,
      kind: predecessor.kind,
      requestedBy: predecessor.requested_by,
      targetHash: 'b'.repeat(64)
    })).not.toThrow();
    expect(() => assertValidApprovalSupersession({
      predecessor,
      campaignId: predecessor.campaign_id,
      kind: predecessor.kind,
      requestedBy: predecessor.requested_by,
      targetHash: predecessor.target_hash
    })).toThrowError(expect.objectContaining({ code: 'invalid_supersession' }));
  });
});
