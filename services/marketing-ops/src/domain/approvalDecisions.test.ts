import { describe, expect, it } from 'vitest';
import { assertApprovalTargetCurrent } from './approvals.js';

describe('approval target revalidation', () => {
  it('rejects expired, changed or already decided requests', () => {
    expect(() => assertApprovalTargetCurrent({
      status: 'pending', expiresAt: '2026-08-05T11:00:00.000Z',
      expectedHash: 'a'.repeat(64), actualHash: 'a'.repeat(64)
    }, new Date('2026-08-05T12:00:00.000Z'))).toThrowError(expect.objectContaining({ code: 'approval_expired' }));
    expect(() => assertApprovalTargetCurrent({
      status: 'pending', expiresAt: '2026-08-06T11:00:00.000Z',
      expectedHash: 'a'.repeat(64), actualHash: 'b'.repeat(64)
    }, new Date('2026-08-05T12:00:00.000Z'))).toThrowError(expect.objectContaining({ code: 'approval_target_changed' }));
    expect(() => assertApprovalTargetCurrent({
      status: 'approved', expiresAt: '2026-08-06T11:00:00.000Z',
      expectedHash: 'a'.repeat(64), actualHash: 'a'.repeat(64)
    }, new Date('2026-08-05T12:00:00.000Z'))).toThrowError(expect.objectContaining({ code: 'approval_conflict' }));
  });
});
