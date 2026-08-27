import { describe, expect, it } from 'vitest';
import {
  parseApprovalDecisionBody,
  parseApprovalFilters,
  parseEditorialApprovalBody,
  parseOperationalApprovalBody
} from './approvals.js';

const base = {
  campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  reason: 'Revisão',
  expiresAt: '2026-08-10T13:00:00.000Z'
};

describe('approval REST wire contracts', () => {
  it('accepts strict editorial and operational bodies', () => {
    expect(parseEditorialApprovalBody({
      ...base,
      assetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      versionNumber: 2
    }).versionNumber).toBe(2);
    expect(parseOperationalApprovalBody({
      ...base,
      actionPackage: {
        actionType: 'campaign.channel_dispatch', channel: 'email',
        audienceSnapshot: {}, scheduledFor: null, timeZone: 'UTC',
        configuration: {}, payload: {}
      }
    }).actionPackage.actionType).toBe('campaign.channel_dispatch');
  });

  it('requires comments and normalizes query numbers', () => {
    expect(() => parseApprovalDecisionBody({ decision: 'rejected' })).toThrow();
    expect(parseApprovalFilters({ status: 'pending', limit: '50' })).toMatchObject({
      status: 'pending', limit: 50
    });
    expect(() => parseApprovalFilters({ unknown: 'value' })).toThrow();
  });
});
