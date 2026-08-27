import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { verifyDelegation } from './delegation/verifier.js';
import { createMarketingOpsMcpServer } from './mcp/createServer.js';
import { marketingOpsPlanActionsSchema } from './plans/contracts.js';

const pool = new pg.Pool({ connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres' });
const activeKey = 'active-local-delegation-key-at-least-32-bytes';
const keyring = { activeKid: 'v2', activeKey, previousKid: 'v1', previousKey: 'previous-local-delegation-key-32-bytes', issuer: 'nexus-chat-bridge', audience: 'nexus-marketing-ops', maxTtlSeconds: 120 };
afterAll(() => pool.end());

async function token(
  overrides: Record<string, unknown> = {},
  key = activeKey,
  kid = 'v2',
  ttlSeconds = 60,
  issuedAt = Math.floor(Date.now() / 1000),
  jti = randomUUID()
) {
  return new SignJWT({
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor_role: 'member',
    scopes: ['campaign:read', 'campaign:write'], chat_session_id: randomUUID(), run_id: randomUUID(),
    correlation_id: randomUUID(), contract_version: 1, ...overrides
  }).setProtectedHeader({ alg: 'HS256', kid }).setIssuer('nexus-chat-bridge').setAudience('nexus-marketing-ops')
    .setSubject('11111111-1111-4111-8111-111111111111').setJti(jti).setIssuedAt(issuedAt).setNotBefore(issuedAt - 1).setExpirationTime(issuedAt + ttlSeconds)
    .sign(new TextEncoder().encode(key));
}

function toolPayload(result: unknown): Record<string, any> {
  const content = (result as { content?: unknown } | null)?.content;
  const first = (content as Array<{ text?: unknown }> | undefined)?.[0];
  if (!first || typeof first.text !== 'string') throw new Error('tool_text_result_missing');
  return JSON.parse(first.text);
}

describe('delegation and MCP', () => {
  it('verifies a short delegation against the current membership', async () => {
    const delegated = await verifyDelegation(await token(), ['campaign:read'], { pool, keyring });
    expect(delegated).toMatchObject({ userId: '11111111-1111-4111-8111-111111111111', role: 'member', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  });

  it('rejects missing scopes, unknown kid and excessive TTL', async () => {
    await expect(verifyDelegation(await token({ scopes: ['campaign:read'] }), ['campaign:write'], { pool, keyring })).rejects.toMatchObject({ code: 'delegation_scope_denied' });
    await expect(verifyDelegation(await token({}, activeKey, 'unknown'), ['campaign:read'], { pool, keyring })).rejects.toMatchObject({ code: 'delegation_invalid' });
    await expect(verifyDelegation(await token({}, activeKey, 'v2', 300), ['campaign:read'], { pool, keyring })).rejects.toMatchObject({ code: 'delegation_invalid' });
  });

  it('consumes mutation jti once', async () => {
    const signed = await token();
    const operation = { name: 'campaign.create', idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64) };
    await verifyDelegation(signed, ['campaign:write'], { pool, keyring, operation });
    await expect(verifyDelegation(signed, ['campaign:write'], { pool, keyring, operation })).rejects.toMatchObject({ code: 'delegation_replay' });
  });

  it('renews once when a valid delegation expires during the Hermes run', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await token({}, activeKey, 'v2', 60, now - 120);
    const fresh = await token();
    const refreshDelegation = vi.fn().mockResolvedValue(fresh);

    const delegated = await verifyDelegation(expired, ['campaign:read'], {
      pool,
      keyring,
      refreshDelegation
    });

    expect(refreshDelegation).toHaveBeenCalledOnce();
    expect(refreshDelegation).toHaveBeenCalledWith(expired);
    expect(delegated).toMatchObject({
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'member',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    });
  });

  it('canonicalizes a tenant slug before consuming a mutation delegation', async () => {
    const signed = await token({ tenant_id: 'ens' });
    const operation = { name: 'campaign.create', idempotencyKey: randomUUID(), requestHash: 'b'.repeat(64) };
    const actor = await verifyDelegation(signed, ['campaign:write'], { pool, keyring, operation });
    expect(actor.tenantId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('registers versioned tools and serves public capabilities', async () => {
    const metrics = { increment: vi.fn() };
    const server = createMarketingOpsMcpServer({
      pool, features: { read: true, write: true }, keyring, metrics
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'marketing_ops_capabilities_v1',
      'marketing_ops_list_campaigns_v1',
      'marketing_ops_get_campaign_v1',
      'marketing_ops_list_campaign_items_v1',
      'marketing_ops_get_campaign_timeline_v1',
      'marketing_ops_get_content_v1',
      'marketing_ops_get_object_capabilities_v1',
      'marketing_ops_prepare_plan_v1',
      'marketing_ops_execute_plan_v1'
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      'marketing_ops_create_campaign_draft_v1',
      'marketing_ops_update_campaign_draft_v1',
      'marketing_ops_create_campaign_item_draft_v1'
    ]));
    const result = await client.callTool({ name: 'marketing_ops_capabilities_v1', arguments: {} });
    expect(result.isError).not.toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    expect(JSON.parse(text).trace).toMatchObject({
      tool_name: 'marketing_ops_capabilities_v1',
      tool_call_id: expect.stringMatching(/^[0-9a-f-]{36}$/i)
    });
    expect(metrics.increment).toHaveBeenCalledWith('marketing_ops_mcp_calls_total', {
      tool: 'marketing_ops_capabilities_v1', result: 'success'
    });
    await client.close();
    await server.close();
  });

  it('normalizes a numeric string version before signing an update plan', async () => {
    const server = createMarketingOpsMcpServer({ pool, features: { read: true, write: true }, keyring });
    const client = new Client({ name: 'plan-version-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const actions = [{
        type: 'campaign.update' as const,
        campaign_id: randomUUID(),
        expected_version: '1',
        patch: { name: 'Campanha revisada' }
      }];
      const [normalizedAction] = marketingOpsPlanActionsSchema.parse(actions);
      if (normalizedAction?.type !== 'campaign.update') throw new Error('normalized_update_action_missing');
      expect(normalizedAction.expected_version).toBe(1);

      const prepared = await client.callTool({
        name: 'marketing_ops_prepare_plan_v1',
        arguments: {
          delegation_token: 'invalid-diagnostic-token',
          actions
        }
      });
      expect(toolPayload(prepared).error.code).toBe('delegation_invalid');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('normalizes the MiniMax item wrapper before validating a plan', async () => {
    const server = createMarketingOpsMcpServer({ pool, features: { read: true, write: true }, keyring });
    const client = new Client({ name: 'plan-array-wrapper-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const prepared = await client.callTool({
        name: 'marketing_ops_prepare_plan_v1',
        arguments: {
          delegation_token: 'invalid-diagnostic-token',
          actions: { item: { type: 'campaign.create_draft', ref: 'campaign-main', name: 'MiniMax wrapper' } }
        }
      });
      expect(toolPayload(prepared).error.code).toBe('delegation_invalid');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('normalizes a direct MiniMax action before validating a plan', async () => {
    const server = createMarketingOpsMcpServer({ pool, features: { read: true, write: true }, keyring });
    const client = new Client({ name: 'plan-direct-action-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const prepared = await client.callTool({
        name: 'marketing_ops_prepare_plan_v1',
        arguments: {
          delegation_token: 'invalid-diagnostic-token',
          actions: { type: 'campaign.create_draft', ref: 'campaign-main', name: 'MiniMax direct action' }
        }
      });
      expect(toolPayload(prepared).error.code).toBe('delegation_invalid');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('normalizes a JSON-encoded MiniMax action before validating a plan', async () => {
    const server = createMarketingOpsMcpServer({ pool, features: { read: true, write: true }, keyring });
    const client = new Client({ name: 'plan-json-action-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const prepared = await client.callTool({
        name: 'marketing_ops_prepare_plan_v1',
        arguments: {
          delegation_token: 'invalid-diagnostic-token',
          actions: JSON.stringify({ type: 'campaign.create_draft', ref: 'campaign-main', name: 'MiniMax JSON action' })
        }
      });
      expect(toolPayload(prepared).error.code).toBe('delegation_invalid');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('prepares without writes and executes one exact multi-action plan after confirmation', async () => {
    const server = createMarketingOpsMcpServer({ pool, features: { read: true, write: true }, keyring });
    const client = new Client({ name: 'plan-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'marketing_ops_prepare_plan_v1',
      'marketing_ops_execute_plan_v1'
    ]));

    const sessionId = randomUUID();
    const preparationJti = randomUUID();
    const campaignName = `Conversational plan ${randomUUID()}`;
    const preparationToken = await token({
      chat_session_id: sessionId,
      scopes: ['campaign:read', 'campaign:write', 'item:write'],
      confirmation_intent: false
    }, activeKey, 'v2', 60, Math.floor(Date.now() / 1000), preparationJti);
    const actions = [
      { type: 'campaign.create_draft', ref: 'campaign-main', name: campaignName },
      {
        type: 'campaign_item.create', campaign_ref: 'campaign-main', kind: 'email',
        title: 'Boas-vindas'
      }
    ];
    const prepared = await client.callTool({
      name: 'marketing_ops_prepare_plan_v1',
      arguments: { delegation_token: preparationToken, actions }
    });
    expect(prepared.isError).not.toBe(true);
    const preparedPayload = toolPayload(prepared);
    const before = await pool.query('select count(*)::int as count from marketing_ops.campaigns where name = $1', [campaignName]);
    expect(before.rows[0].count).toBe(0);

    const sameTurn = await client.callTool({
      name: 'marketing_ops_execute_plan_v1',
      arguments: { delegation_token: preparationToken, plan_token: preparedPayload.plan_token }
    });
    expect(toolPayload(sameTurn).error.code).toBe('confirmation_required');

    const laterUnconfirmedToken = await token({
      chat_session_id: sessionId,
      scopes: ['campaign:read', 'campaign:write', 'item:write'],
      confirmation_intent: false
    }, activeKey, 'v2', 60, Math.floor(Date.now() / 1000), randomUUID());
    const laterUnconfirmed = await client.callTool({
      name: 'marketing_ops_execute_plan_v1',
      arguments: { delegation_token: laterUnconfirmedToken, plan_token: preparedPayload.plan_token }
    });
    expect(toolPayload(laterUnconfirmed).error.code).toBe('confirmation_required');

    const confirmationToken = await token({
      chat_session_id: sessionId,
      scopes: ['campaign:read', 'campaign:write', 'item:write'],
      confirmation_intent: true
    }, activeKey, 'v2', 60, Math.floor(Date.now() / 1000), randomUUID());
    const executed = await client.callTool({
      name: 'marketing_ops_execute_plan_v1',
      arguments: { delegation_token: confirmationToken, plan_token: preparedPayload.plan_token }
    });
    expect(executed.isError).not.toBe(true);
    const executedPayload = toolPayload(executed);
    expect(executedPayload.data).toMatchObject({ status: 'completed' });
    expect(executedPayload.data.completed).toHaveLength(2);

    const persisted = await pool.query(`
      select c.id, count(i.id)::int as items
      from marketing_ops.campaigns c
      left join marketing_ops.campaign_items i on i.campaign_id = c.id
      where c.name = $1
      group by c.id
    `, [campaignName]);
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].items).toBe(1);

    const retryToken = await token({
      chat_session_id: sessionId,
      scopes: ['campaign:read', 'campaign:write', 'item:write'],
      confirmation_intent: true
    }, activeKey, 'v2', 60, Math.floor(Date.now() / 1000), randomUUID());
    const retry = await client.callTool({
      name: 'marketing_ops_execute_plan_v1',
      arguments: { delegation_token: retryToken, plan_token: preparedPayload.plan_token }
    });
    const retryPayload = toolPayload(retry);
    expect(retryPayload.data).toMatchObject({ status: 'completed' });
    expect(retryPayload.data.completed.map((entry: { data: { id: string } }) => entry.data.id))
      .toEqual(executedPayload.data.completed.map((entry: { data: { id: string } }) => entry.data.id));
    const afterRetry = await pool.query(`
      select
        (select count(*)::int from marketing_ops.campaigns where name = $1) as campaigns,
        (select count(*)::int from marketing_ops.campaign_items where campaign_id = $2) as items
    `, [campaignName, persisted.rows[0].id]);
    expect(afterRetry.rows[0]).toEqual({ campaigns: 1, items: 1 });

    await client.close();
    await server.close();
  });
});
