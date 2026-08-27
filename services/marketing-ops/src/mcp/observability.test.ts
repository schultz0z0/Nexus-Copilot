import { describe, expect, it } from 'vitest';
import { createMetrics } from '../observability/metrics.js';

describe('MCP observability metrics', () => {
  it('records bounded tool/result labels without identifiers', () => {
    const metrics = createMetrics();
    metrics.increment('marketing_ops_mcp_calls_total', {
      tool: 'marketing_ops_execute_plan_v1',
      result: 'partial'
    });
    metrics.increment('marketing_ops_mcp_errors_total', {
      tool: 'marketing_ops_execute_plan_v1', code: 'version_conflict'
    });
    metrics.increment('marketing_ops_mcp_idempotency_total', { result: 'hit' });
    metrics.increment('marketing_ops_mcp_objects_mutated_total', { resource: 'content_asset' });
    metrics.increment('marketing_ops_mcp_plan_latency_seconds_count');
    metrics.increment('marketing_ops_mcp_plan_latency_seconds_sum', {}, 12);
    expect(metrics.render()).toContain(
      'marketing_ops_mcp_calls_total{result="partial",tool="marketing_ops_execute_plan_v1"} 1'
    );
    expect(metrics.render()).toContain(
      'marketing_ops_mcp_errors_total{code="version_conflict",tool="marketing_ops_execute_plan_v1"} 1'
    );
    expect(metrics.render()).not.toContain('11111111-1111-4111-8111-111111111111');
  });
});
