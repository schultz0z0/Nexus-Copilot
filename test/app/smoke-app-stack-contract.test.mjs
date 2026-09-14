import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIdempotentStructuredExecution,
  assertInertStructuredPlan,
  structuredSmokeConfiguration,
} from '../../scripts/smoke-app-stack.mjs';

const safePlan = {
  id: '11111111-1111-4111-8111-111111111111',
  planHash: 'a'.repeat(64),
  status: 'pending',
  actions: [{
    type: 'approval.submit_operational',
    action_package: { configuration: { mode: 'sandbox' } },
  }],
};

test('structured smoke is explicit and requires an exact plan identity', () => {
  assert.deepEqual(structuredSmokeConfiguration({}), { enabled: false });
  assert.throws(() => structuredSmokeConfiguration({
    SMOKE_STRUCTURED_PLAN_EXECUTION: 'true',
  }), /SMOKE_STRUCTURED_PLAN_SESSION_ID/);

  assert.deepEqual(structuredSmokeConfiguration({
    SMOKE_STRUCTURED_PLAN_EXECUTION: 'true',
    SMOKE_STRUCTURED_PLAN_SESSION_ID: '22222222-2222-4222-8222-222222222222',
    SMOKE_STRUCTURED_PLAN_ID: safePlan.id,
    SMOKE_STRUCTURED_PLAN_HASH: safePlan.planHash,
  }), {
    enabled: true,
    sessionId: '22222222-2222-4222-8222-222222222222',
    planId: safePlan.id,
    planHash: safePlan.planHash,
  });
});

test('structured smoke accepts only pending sandbox operational approvals', () => {
  assert.doesNotThrow(() => assertInertStructuredPlan(safePlan));
  assert.throws(() => assertInertStructuredPlan({
    ...safePlan,
    actions: [{ type: 'campaign.create_draft', name: 'unsafe' }],
  }), /inert operational approval/);
  assert.throws(() => assertInertStructuredPlan({
    ...safePlan,
    actions: [{
      type: 'approval.submit_operational',
      action_package: { configuration: { mode: 'live' } },
    }],
  }), /sandbox/);
});

test('idempotency proof requires the same plan and approval with no decision', () => {
  const execution = {
    status: 'completed',
    plan_id: safePlan.id,
    completed: [{ action_type: 'approval.submit_operational', resource: { id: 'approval-1' } }],
    failed: [],
    pending: [],
  };
  const approval = { id: 'approval-1', status: 'pending', decision: null };

  assert.doesNotThrow(() => assertIdempotentStructuredExecution(execution, execution, approval));
  assert.throws(() => assertIdempotentStructuredExecution(
    execution,
    { ...execution, plan_id: 'different' },
    approval,
  ), /same plan/);
  assert.throws(() => assertIdempotentStructuredExecution(
    execution,
    execution,
    { ...approval, decision: { decision: 'approved' } },
  ), /without a decision/);
});
