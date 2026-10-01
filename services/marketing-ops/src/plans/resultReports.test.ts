import { describe, expect, it } from 'vitest';
import { marketingOpsPlanActionsSchema, requiredScopesForPlan } from './contracts.js';

const action = {
  type: 'campaign.results_record',
  campaign_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  report: {
    sourceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', periodFrom: '2026-09-21', periodTo: '2026-09-27',
    timeZone: 'America/Sao_Paulo', metrics: { sent: 100, delivered: 90, clicked: 12, sales: 0 }, notes: 'Relatório semanal'
  }
};
describe('human reviewed result report plan', () => {
  it('validates real report values and requires campaign write authority', () => {
    const parsed = marketingOpsPlanActionsSchema.parse([action]);
    expect(requiredScopesForPlan(parsed)).toEqual(['campaign:write']);
    expect(parsed[0]).toMatchObject({ report: { metrics: { sales: 0 } } });
  });
  it('rejects invented fields, inconsistent measurements, and ambiguous revisions', () => {
    for (const invalid of [
      { ...action, tenant_id: 'injected' },
      { ...action, report: { ...action.report, metrics: { sent: 10, delivered: 15 } } },
      { ...action, report_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      { ...action, expected_version: 1 },
      { ...action, report: { ...action.report, metrics: {} } }
    ]) expect(marketingOpsPlanActionsSchema.safeParse([invalid]).success).toBe(false);
  });
});
