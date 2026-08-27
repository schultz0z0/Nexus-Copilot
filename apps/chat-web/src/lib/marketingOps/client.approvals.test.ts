import { describe, expect, it, vi } from 'vitest';
import { createMarketingOpsClient } from './client';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const campaignId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('Marketing Ops approval client', () => {
  it('uses the six approval routes and concurrency headers', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [], page: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    const client = createMarketingOpsClient({
      baseUrl: 'https://ops.local',
      getAccessToken: async () => 'token',
      fetch: fetch as typeof globalThis.fetch
    });
    await client.listApprovalRequests({ status: 'pending', limit: 25 });
    await client.getApprovalRequest(requestId);
    await client.submitEditorialApproval({
      campaignId, assetId, versionNumber: 2, reason: 'Revisão',
      expiresAt: '2026-08-10T13:00:00.000Z'
    }, 'editorial-key');
    await client.submitOperationalApproval({
      campaignId, reason: 'Envio', expiresAt: '2026-08-10T13:00:00.000Z',
      actionPackage: {
        actionType: 'campaign.channel_dispatch', channel: 'email',
        audienceSnapshot: {}, scheduledFor: null, timeZone: 'UTC',
        configuration: {}, payload: {}
      }
    }, 'operational-key');
    await client.decideApproval(requestId, 1, { decision: 'approved' }, 'decision-key');
    await client.cancelApproval(requestId, 2, 'cancel-key');

    expect(fetch.mock.calls.map(([url, init]) => [url, (init as RequestInit).method])).toEqual([
      ['https://ops.local/v1/approval-requests?status=pending&limit=25', undefined],
      [`https://ops.local/v1/approval-requests/${requestId}`, undefined],
      ['https://ops.local/v1/approval-requests/editorial', 'POST'],
      ['https://ops.local/v1/approval-requests/operational', 'POST'],
      [`https://ops.local/v1/approval-requests/${requestId}/decisions`, 'POST'],
      [`https://ops.local/v1/approval-requests/${requestId}/cancel`, 'POST']
    ]);
    expect((fetch.mock.calls[4]?.[1]?.headers as Headers).get('If-Match')).toBe('"1"');
    expect((fetch.mock.calls[5]?.[1]?.headers as Headers).get('If-Match')).toBe('"2"');
  });
});
