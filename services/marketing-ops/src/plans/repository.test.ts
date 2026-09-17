import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { Actor } from '../auth/actor.js';
import type { MarketingOpsPlanAction } from './contracts.js';
import { PreparedPlanRepository } from './repository.js';

const actorA: Actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantSlug: 'ens',
  role: 'member'
};

const actorB: Actor = {
  userId: '22222222-2222-4222-8222-222222222222',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenantSlug: 'other',
  role: 'member'
};

const sampleActions: MarketingOpsPlanAction[] = [
  {
    type: 'campaign.create_draft',
    ref: 'launch',
    name: 'New Campaign'
  },
  {
    type: 'campaign_item.create',
    campaign_ref: 'launch',
    kind: 'task',
    title: 'Write copy'
  }
];

const revisedActions: MarketingOpsPlanAction[] = [
  {
    type: 'campaign.create_draft',
    ref: 'launch',
    name: 'Revised Campaign Name'
  }
];

describe('PreparedPlanRepository', () => {
  it('prepares and canonicalizes plan with sorted scopes and sha256 hash', async () => {
    let insertedRow: any = null;
    const fakeClient = {
      release: vi.fn(),
      query: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT') && sql.includes('prepared_agent_plans')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO marketing_ops.prepared_agent_plans')) {
          insertedRow = {
            id: '44444444-4444-4444-8444-444444444444',
            tenant_id: params[0],
            prepared_by: params[1],
            chat_session_id: params[2],
            source_run_id: params[3],
            prepared_delegation_jti: params[4],
            plan_hash: params[5],
            actions: params[6],
            required_scopes: params[7],
            status: 'pending',
            expires_at: new Date(Date.now() + 900_000).toISOString(),
            execution_key: null,
            execution_started_at: null,
            execution_attempts: 0,
            result: null,
            executed_by: null,
            executed_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          return { rows: [insertedRow] };
        }
        return { rows: [] };
      })
    };

    const pool = {
      connect: vi.fn(async () => fakeClient)
    } as unknown as Pool;

    const repository = new PreparedPlanRepository(pool);
    const plan = await repository.prepare({
      actor: actorA,
      chatSessionId: '33333333-3333-4333-8333-333333333333',
      sourceRunId: '55555555-5555-4555-8555-555555555555',
      preparedDelegationJti: 'jti-1'
    }, {
      actions: sampleActions
    });

    expect(plan.id).toBe('44444444-4444-4444-8444-444444444444');
    expect(plan.status).toBe('pending');
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.requiredScopes).toEqual(['campaign:write', 'item:write']);
    const statements = fakeClient.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.findIndex((sql) => sql.includes('pg_advisory_xact_lock'))).toBeGreaterThanOrEqual(0);
    expect(statements.findIndex((sql) => sql.includes('pg_advisory_xact_lock')))
      .toBeLessThan(statements.findIndex((sql) => sql.includes('FROM marketing_ops.prepared_agent_plans')));
    expect(fakeClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      [[actorA.tenantId, actorA.userId, '33333333-3333-4333-8333-333333333333'].join(':')]
    );
  });

  it('returns existing pending plan for same run id and same hash (idempotent prepare)', async () => {
    const existingRow = {
      id: '44444444-4444-4444-8444-444444444444',
      tenant_id: actorA.tenantId,
      prepared_by: actorA.userId,
      chat_session_id: '33333333-3333-4333-8333-333333333333',
      source_run_id: '55555555-5555-4555-8555-555555555555',
      prepared_delegation_jti: 'jti-1',
      plan_hash: 'mockhash',
      actions: sampleActions,
      required_scopes: ['campaign:write', 'item:write'],
      status: 'pending',
      expires_at: new Date(Date.now() + 900_000).toISOString(),
      execution_key: null,
      execution_started_at: null,
      execution_attempts: 0,
      result: null,
      executed_by: null,
      executed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const fakeClient = {
      release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT') && sql.includes('source_run_id = $4') && sql.includes('plan_hash = $5')) {
          return { rows: [existingRow] };
        }
        return { rows: [] };
      })
    };

    const pool = {
      connect: vi.fn(async () => fakeClient)
    } as unknown as Pool;

    const repository = new PreparedPlanRepository(pool);
    const plan = await repository.prepare({
      actor: actorA,
      chatSessionId: '33333333-3333-4333-8333-333333333333',
      sourceRunId: '55555555-5555-4555-8555-555555555555',
      preparedDelegationJti: 'jti-1'
    }, {
      actions: sampleActions
    });

    expect(plan.id).toBe(existingRow.id);
  });

  it('invalidates any prior pending plan in the same chat before inserting a replacement', async () => {
    let invalidated = false;
    const fakeClient = {
      release: vi.fn(),
      query: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT') && sql.includes('source_run_id = $4') && sql.includes('plan_hash = $5')) {
          return { rows: [] };
        }
        if (sql.includes('UPDATE') && sql.includes("status = 'invalidated'")) {
          invalidated = true;
          return { rowCount: 1 };
        }
        if (sql.includes('INSERT INTO marketing_ops.prepared_agent_plans')) {
          return {
            rows: [{
              id: 'new-plan-id',
              tenant_id: params[0],
              prepared_by: params[1],
              chat_session_id: params[2],
              source_run_id: params[3],
              prepared_delegation_jti: params[4],
              plan_hash: params[5],
              actions: params[6],
              required_scopes: params[7],
              status: 'pending',
              expires_at: new Date(Date.now() + 900_000).toISOString(),
              execution_key: null,
              execution_started_at: null,
              execution_attempts: 0,
              result: null,
              executed_by: null,
              executed_at: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }]
          };
        }
        return { rows: [] };
      })
    };

    const pool = {
      connect: vi.fn(async () => fakeClient)
    } as unknown as Pool;

    const repository = new PreparedPlanRepository(pool);
    const plan = await repository.prepare({
      actor: actorA,
      chatSessionId: '33333333-3333-4333-8333-333333333333',
      sourceRunId: '66666666-6666-4666-8666-666666666666'
    }, {
      actions: revisedActions
    });

    expect(invalidated).toBe(true);
    expect(plan.id).toBe('new-plan-id');
    const invalidationCall = fakeClient.query.mock.calls.find(([sql]) =>
      String(sql).includes("status = 'invalidated'")
    );
    expect(invalidationCall).toBeDefined();
    expect(String(invalidationCall?.[0])).not.toContain('source_run_id');
    expect(invalidationCall?.[1]).toEqual([
      actorA.tenantId,
      actorA.userId,
      '33333333-3333-4333-8333-333333333333'
    ]);
  });

  it('opportunistically expires past plans during listPending', async () => {
    let expiryRan = false;
    const fakeClient = {
      release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('UPDATE') && sql.includes("status = 'expired'")) {
          expiryRan = true;
          return { rowCount: 1 };
        }
        if (sql.includes('SELECT') && sql.includes("status = 'pending'")) {
          return { rows: [] };
        }
        return { rows: [] };
      })
    };

    const pool = {
      connect: vi.fn(async () => fakeClient)
    } as unknown as Pool;

    const repository = new PreparedPlanRepository(pool);
    const plans = await repository.listPending(actorA, '33333333-3333-4333-8333-333333333333');
    expect(expiryRan).toBe(true);
    expect(plans).toEqual([]);
  });

  it('lists recent pending and terminal plans with actor scope, ordering and bounded limit', async () => {
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const completedRow = {
      id: '44444444-4444-4444-8444-444444444444',
      tenant_id: actorA.tenantId,
      prepared_by: actorA.userId,
      chat_session_id: sessionId,
      source_run_id: '55555555-5555-4555-8555-555555555555',
      prepared_delegation_jti: 'jti-terminal',
      plan_hash: 'a'.repeat(64),
      actions: sampleActions,
      required_scopes: ['campaign:write'],
      status: 'completed',
      expires_at: new Date(Date.now() + 900_000).toISOString(),
      execution_key: 'secret-execution-key',
      execution_started_at: new Date().toISOString(),
      execution_attempts: 1,
      result: { status: 'completed', plan_id: 'plan-1', completed: [], failed: [], pending: [], deep_links: [] },
      executed_by: actorA.userId,
      executed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const fakeClient = {
      release: vi.fn(),
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT *')) return { rows: [completedRow] };
        return { rows: [], rowCount: 0 };
      })
    };
    const pool = {
      connect: vi.fn(async () => fakeClient)
    } as unknown as Pool;

    const repository = new PreparedPlanRepository(pool);
    const plans = await repository.listRecent(actorA, sessionId, undefined, 500);

    expect(plans).toHaveLength(1);
    const expiry = calls.find(({ sql }) => sql.includes("SET status = 'expired'"));
    const select = calls.find(({ sql }) => sql.includes('SELECT *'));
    expect(expiry?.params).toEqual([actorA.tenantId, actorA.userId, sessionId]);
    expect(select?.sql).toContain('tenant_id = $1');
    expect(select?.sql).toContain('prepared_by = $2');
    expect(select?.sql).toContain('chat_session_id = $3');
    expect(select?.sql).not.toContain('AND status =');
    expect(select?.sql).toContain('ORDER BY created_at DESC');
    expect(select?.params).toEqual([actorA.tenantId, actorA.userId, sessionId, 50]);
  });

  it('filters recent plans by one real status', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const fakeClient = {
      release: vi.fn(),
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 0 };
      })
    };
    const pool = {
      connect: vi.fn(async () => fakeClient)
    } as unknown as Pool;

    const repository = new PreparedPlanRepository(pool);
    await repository.listRecent(actorA, undefined, 'failed', 10);

    const select = calls.find(({ sql }) => sql.includes('SELECT *'));
    expect(select?.sql).toContain('status = $3');
    expect(select?.params).toEqual([actorA.tenantId, actorA.userId, 'failed', 10]);
  });

  it('reserves a plan for execution with lock, execution key, and verifies hash', async () => {
    const validPlan = {
      id: 'plan-to-exec',
      tenant_id: actorA.tenantId,
      prepared_by: actorA.userId,
      chat_session_id: '33333333-3333-4333-8333-333333333333',
      source_run_id: '55555555-5555-4555-8555-555555555555',
      prepared_delegation_jti: 'jti-1',
      plan_hash: 'expected-hash',
      actions: sampleActions,
      required_scopes: ['campaign:write', 'item:write'],
      status: 'pending',
      expires_at: new Date(Date.now() + 900_000).toISOString(),
      execution_key: null,
      execution_started_at: null,
      execution_attempts: 0,
      result: null,
      executed_by: null,
      executed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const fakeClient = {
      release: vi.fn(),
      query: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT') && sql.includes('FOR UPDATE')) {
          return { rows: [validPlan] };
        }
        if (sql.includes('UPDATE') && sql.includes("status = 'executing'")) {
          return {
            rows: [{
              ...validPlan,
              status: 'executing',
              execution_key: params[0],
              execution_started_at: new Date().toISOString(),
              execution_attempts: 1
            }]
          };
        }
        return { rows: [] };
      })
    };

    const pool = {
      connect: vi.fn(async () => fakeClient)
    } as unknown as Pool;

    const repository = new PreparedPlanRepository(pool);

    // Hash mismatch throws 409
    await expect(
      repository.reserveForExecution(
        { actor: actorA, correlationId: 'corr-1' },
        'plan-to-exec',
        'wrong-hash',
        'idemp-key-1'
      )
    ).rejects.toMatchObject({ code: 'plan_hash_mismatch', status: 409 });

    // Matching hash succeeds
    const { plan, isReplay } = await repository.reserveForExecution(
      { actor: actorA, correlationId: 'corr-1' },
      'plan-to-exec',
      'expected-hash',
      'idemp-key-1'
    );

    expect(plan.status).toBe('executing');
    expect(plan.executionKey).toBe('idemp-key-1');
    expect(isReplay).toBe(false);
  });

  it('detects replay when plan is terminal with same execution key', async () => {
    const completedPlan = {
      id: 'plan-to-exec',
      tenant_id: actorA.tenantId,
      prepared_by: actorA.userId,
      chat_session_id: '33333333-3333-4333-8333-333333333333',
      source_run_id: '55555555-5555-4555-8555-555555555555',
      prepared_delegation_jti: 'jti-1',
      plan_hash: 'expected-hash',
      actions: sampleActions,
      required_scopes: ['campaign:write', 'item:write'],
      status: 'completed',
      expires_at: new Date(Date.now() + 900_000).toISOString(),
      execution_key: 'idemp-key-1',
      execution_started_at: new Date().toISOString(),
      execution_attempts: 1,
      result: { ok: true },
      executed_by: actorA.userId,
      executed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const fakeClient = {
      release: vi.fn(),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT') && sql.includes('FOR UPDATE')) {
          return { rows: [completedPlan] };
        }
        return { rows: [] };
      })
    };

    const pool = {
      connect: vi.fn(async () => fakeClient)
    } as unknown as Pool;

    const repository = new PreparedPlanRepository(pool);

    const { plan, isReplay } = await repository.reserveForExecution(
      { actor: actorA, correlationId: 'corr-1' },
      'plan-to-exec',
      'expected-hash',
      'idemp-key-1'
    );

    expect(isReplay).toBe(true);
    expect(plan.status).toBe('completed');
  });

  it('finalizes execution to terminal result without mutating immutable fields', async () => {
    const fakeClient = {
      release: vi.fn(),
      query: vi.fn(async (sql: string, params: any[]) => {
        if (sql.includes('UPDATE') && sql.includes('prepared_agent_plans')) {
          return {
            rows: [{
              id: params[4],
              tenant_id: actorA.tenantId,
              prepared_by: actorA.userId,
              chat_session_id: '33333333-3333-4333-8333-333333333333',
              source_run_id: '55555555-5555-4555-8555-555555555555',
              prepared_delegation_jti: 'jti-1',
              plan_hash: 'hash-1',
              actions: sampleActions,
              required_scopes: ['campaign:write', 'item:write'],
              status: params[0],
              expires_at: new Date().toISOString(),
              execution_key: params[3],
              execution_started_at: new Date().toISOString(),
              execution_attempts: 1,
              result: params[1],
              executed_by: params[2],
              executed_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }]
          };
        }
        return { rows: [] };
      })
    };

    const pool = {
      connect: vi.fn(async () => fakeClient)
    } as unknown as Pool;

    const repository = new PreparedPlanRepository(pool);
    const finalized = await repository.finalizeExecution(
      { actor: actorA, correlationId: 'corr-1' },
      'plan-id',
      'idemp-key-1',
      {
        status: 'completed',
        result: { summary: 'Created 1 campaign' },
        executedBy: actorA.userId
      }
    );

    expect(finalized.status).toBe('completed');
    expect(finalized.result).toEqual({ summary: 'Created 1 campaign' });
    expect(finalized.executedBy).toBe(actorA.userId);
    expect(fakeClient.query).toHaveBeenCalledWith(
      expect.stringContaining("AND status = 'executing'"),
      expect.any(Array)
    );
  });

  it('fails closed when a stale worker attempts to finalize a terminal plan', async () => {
    const fakeClient = {
      release: vi.fn(),
      query: vi.fn(async () => ({ rows: [] }))
    };
    const pool = { connect: vi.fn(async () => fakeClient) } as unknown as Pool;
    const repository = new PreparedPlanRepository(pool);

    await expect(repository.finalizeExecution(
      { actor: actorA, correlationId: 'corr-stale' },
      'plan-id',
      'idemp-key-1',
      { status: 'completed', result: { stale: true }, executedBy: actorA.userId }
    )).rejects.toMatchObject({ code: 'plan_finalize_failed', status: 409 });
  });
});
