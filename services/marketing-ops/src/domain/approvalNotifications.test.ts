import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NotificationTypeSchema } from './notifications.js';

describe('approval notification contracts', () => {
  it('allows only the two minimized approval projections', () => {
    expect(NotificationTypeSchema.parse('approval_review')).toBe('approval_review');
    expect(NotificationTypeSchema.parse('approval_status')).toBe('approval_status');
    expect(NotificationTypeSchema.safeParse('approval_payload').success).toBe(false);
  });

  it('casts approval request parameters to uuid in notification inserts', () => {
    const source = readFileSync(new URL('./approvals.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/'approval_review', \$3, null, \$2::uuid,/);
    expect(source).toMatch(/'approval_status', \$5, null, \$3::uuid,/);
  });

  it('does not use ON CONFLICT while writing notifications for another user under RLS', () => {
    const source = readFileSync(new URL('./approvals.ts', import.meta.url), 'utf8');
    const approvalNotifications = source.slice(
      source.indexOf('async function notifyReviewers'),
      source.indexOf('async function insertRequest')
    );

    expect(approvalNotifications).not.toMatch(/on conflict/i);
  });
});
