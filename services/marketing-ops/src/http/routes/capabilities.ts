import type { Router } from 'express';

export function registerCapabilities(
  router: Router,
  features: { read: boolean; write: boolean; approvals?: boolean }
) {
  router.get('/v1/capabilities', (_request, response) => response.json({
    service: 'marketing-ops', contractVersion: 1, features,
    resources: [
      'campaigns', 'campaign_items', 'campaign_participants', 'campaign_materials',
      'campaign_timeline', 'course_references', 'audit_events',
      ...(features.approvals ? ['governanceApprovalsV1'] : [])
    ],
    transports: ['rest', 'mcp']
  }));
}
