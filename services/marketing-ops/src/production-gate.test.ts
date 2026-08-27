import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMarketingOpsMcpServer } from './mcp/createServer.js';

const pool = new pg.Pool({
  connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL
    ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
});
const activeKey = 'active-local-delegation-key-at-least-32-bytes';
const keyring = {
  activeKid: 'v2', activeKey,
  issuer: 'nexus-chat-bridge', audience: 'nexus-marketing-ops', maxTtlSeconds: 120
};
const tenantEns = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantOther = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const users = {
  member: '11111111-1111-4111-8111-111111111111',
  manager: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333'
} as const;

type Role = keyof typeof users;
type Action = Record<string, unknown> & { type: string };

const server = createMarketingOpsMcpServer({
  pool, features: { read: true, write: true }, keyring
});
const client = new Client({ name: 'phase-4-production-gate', version: '1.0.0' });

beforeAll(async () => {
  await pool.query('select 1');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
  await server.close();
  await pool.end();
});

async function delegation(
  role: Role,
  scopes: string[],
  tenantId = tenantEns,
  options: { chatSessionId?: string; jti?: string; confirmationIntent?: boolean } = {}
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenant_id: tenantId,
    actor_role: role,
    scopes,
    chat_session_id: options.chatSessionId ?? randomUUID(),
    run_id: randomUUID(),
    correlation_id: randomUUID(),
    confirmation_intent: options.confirmationIntent === true,
    contract_version: 1
  })
    .setProtectedHeader({ alg: 'HS256', kid: 'v2' })
    .setIssuer('nexus-chat-bridge')
    .setAudience('nexus-marketing-ops')
    .setSubject(users[role])
    .setJti(options.jti ?? randomUUID())
    .setIssuedAt(now)
    .setNotBefore(now - 1)
    .setExpirationTime(now + 60)
    .sign(new TextEncoder().encode(activeKey));
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  if (content[0]?.type !== 'text' || typeof content[0].text !== 'string') {
    throw new Error(`Tool ${name} did not return text content`);
  }
  return { result, payload: JSON.parse(content[0].text) };
}

async function preparePlan(role: Role, scopes: string[], actions: Action[], chatSessionId = randomUUID()) {
  const prepared = await call('marketing_ops_prepare_plan_v1', {
    delegation_token: await delegation(role, scopes, tenantEns, { chatSessionId }),
    actions
  });
  expect(prepared.result.isError).not.toBe(true);
  expect(prepared.payload).toMatchObject({ persisted: false, confirmation_required: true });
  return { prepared, chatSessionId, role, scopes };
}

async function executePrepared(preparation: Awaited<ReturnType<typeof preparePlan>>) {
  return call('marketing_ops_execute_plan_v1', {
    delegation_token: await delegation(preparation.role, preparation.scopes, tenantEns, {
      chatSessionId: preparation.chatSessionId,
      confirmationIntent: true
    }),
    plan_token: preparation.prepared.payload.plan_token
  });
}

async function executePlan(role: Role, scopes: string[], actions: Action[]) {
  const preparation = await preparePlan(role, scopes, actions);
  return { preparation, executed: await executePrepared(preparation) };
}

describe('Phase 4 production gate', () => {
  it('requires a later explicit confirmation for the exact multi-action plan', async () => {
    const campaignName = `Plano conversacional ${randomUUID()}`;
    const preparation = await preparePlan(
      'member',
      ['campaign:write', 'item:write'],
      [
        { type: 'campaign.create_draft', ref: 'campaign-main', name: campaignName },
        {
          type: 'campaign_item.create', campaign_ref: 'campaign-main', kind: 'email',
          title: 'Email conversacional'
        }
      ]
    );
    const before = await pool.query(
      'select count(*)::int as count from marketing_ops.campaigns where name = $1',
      [campaignName]
    );
    expect(before.rows[0].count).toBe(0);

    const withoutConfirmation = await call('marketing_ops_execute_plan_v1', {
      delegation_token: await delegation('member', preparation.scopes, tenantEns, {
        chatSessionId: preparation.chatSessionId
      }),
      plan_token: preparation.prepared.payload.plan_token
    });
    expect(withoutConfirmation.payload.error).toMatchObject({ code: 'confirmation_required' });

    const executed = await executePrepared(preparation);
    expect(executed.payload.data).toMatchObject({ status: 'completed', failed: [], pending: [] });
    expect(executed.payload.data.completed).toHaveLength(2);
  });

  it('creates briefing checklist items and exposes correlated audit records to admin', async () => {
    const campaignName = `Briefing Fase 4 ${randomUUID()}`;
    const { executed } = await executePlan(
      'member',
      ['campaign:write', 'item:write'],
      [
        { type: 'campaign.create_draft', ref: 'briefing', name: campaignName },
        {
          type: 'campaign_item.create', campaign_ref: 'briefing', kind: 'task',
          title: 'Validar briefing', due_at: '2026-08-03T15:00:00Z'
        },
        {
          type: 'campaign_item.create', campaign_ref: 'briefing', kind: 'milestone',
          title: 'Aprovar calendário', starts_at: '2026-08-04T12:00:00Z'
        }
      ]
    );
    expect(executed.payload.data).toMatchObject({ status: 'completed' });
    expect(executed.payload.data.completed).toHaveLength(3);
    const campaignId = executed.payload.data.completed[0].resource.id as string;
    const itemIds = executed.payload.data.completed
      .slice(1)
      .map((entry: { resource: { id: string } }) => entry.resource.id);
    expect(executed.payload.data.deep_links).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource_type: 'campaign', resource_id: campaignId }),
      ...itemIds.map((id: string) => expect.objectContaining({
        resource_type: 'campaign_item', resource_id: id
      }))
    ]));

    const audit = await call('marketing_ops_list_audit_events_v1', {
      delegation_token: await delegation('admin', ['audit:read']),
      limit: 100
    });
    expect(audit.payload.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: campaignId, action: 'campaign.created', origin: 'mcp' }),
      ...itemIds.map((id: string) => expect.objectContaining({
        entityId: id, action: 'campaign_item.created', origin: 'mcp'
      }))
    ]));
  });

  it('creates a chat-authored content version and reads the exact persisted body', async () => {
    const base = await executePlan('member', ['campaign:write', 'item:write'], [
      { type: 'campaign.create_draft', ref: 'campaign', name: `Conteudo ${randomUUID()}` },
      {
        type: 'campaign_item.create', campaign_ref: 'campaign', kind: 'email',
        title: 'Email de boas-vindas'
      }
    ]);
    const itemId = base.executed.payload.data.completed[1].resource.id as string;
    const body = `Versao aprovada no chat ${randomUUID()}`;
    const content = await executePlan('member', ['content:write'], [
      {
        type: 'content.create_draft', ref: 'email-copy', item_id: itemId,
        expected_item_version: 1, asset_kind: 'copy', title: 'Copy principal'
      },
      {
        type: 'content.version_create', asset_ref: 'email-copy', expected_asset_version: 1,
        body, metadata: { source: 'chat' }, freeze: false
      }
    ]);
    expect(content.executed.payload.data).toMatchObject({ status: 'completed' });
    const assetId = content.executed.payload.data.completed[0].resource.id as string;
    expect(content.executed.payload.data.deep_links).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource_type: 'content_asset', resource_id: assetId })
    ]));

    const read = await call('marketing_ops_get_content_v1', {
      delegation_token: await delegation('member', ['content:read']),
      asset_id: assetId,
      include_versions: true,
      version_limit: 5
    });
    expect(read.payload.data.versions[assetId]).toEqual(expect.arrayContaining([
      expect.objectContaining({ body })
    ]));
  });

  it('rejects a stale campaign version and preserves the latest committed state', async () => {
    const created = await executePlan('admin', ['campaign:write'], [
      { type: 'campaign.create_draft', ref: 'campaign', name: 'Local gate version 1' }
    ]);
    const campaignId = created.executed.payload.data.completed[0].resource.id as string;
    const updated = await executePlan('admin', ['campaign:write'], [{
      type: 'campaign.update', campaign_id: campaignId, expected_version: 1,
      patch: { name: 'Local gate version 2' }
    }]);
    expect(updated.executed.payload.data.completed[0].resource.version).toBe(2);

    const stale = await executePlan('admin', ['campaign:write'], [{
      type: 'campaign.update', campaign_id: campaignId, expected_version: 1,
      patch: { name: 'NAO DEVE SER APLICADO' }
    }]);
    expect(stale.executed.payload.data).toMatchObject({ status: 'failed', completed: [] });
    expect(stale.executed.payload.data.failed[0].error).toMatchObject({
      code: 'version_conflict', status: 409
    });

    const current = await call('marketing_ops_get_campaign_v1', {
      delegation_token: await delegation('admin', ['campaign:read']),
      campaign_id: campaignId
    });
    expect(current.payload.data).toMatchObject({ name: 'Local gate version 2', version: 2 });
  });

  it('replays the same plan without duplicating the campaign or its item', async () => {
    const campaignName = `Idempotencia Fase 4 ${randomUUID()}`;
    const preparation = await preparePlan('admin', ['campaign:write', 'item:write'], [
      { type: 'campaign.create_draft', ref: 'campaign', name: campaignName },
      {
        type: 'campaign_item.create', campaign_ref: 'campaign', kind: 'email',
        title: 'Item idempotente'
      }
    ]);
    const first = await executePrepared(preparation);
    const replay = await executePrepared(preparation);
    expect(replay.payload.data.completed.map((entry: { resource: { id: string } }) => entry.resource.id))
      .toEqual(first.payload.data.completed.map((entry: { resource: { id: string } }) => entry.resource.id));
    expect(replay.payload.data.completed.every((entry: { idempotency_hit: boolean }) => entry.idempotency_hit))
      .toBe(true);

    const count = await pool.query(`
      select
        (select count(*)::int from marketing_ops.campaigns where name = $1) as campaigns,
        (select count(*)::int from marketing_ops.campaign_items where campaign_id = $2) as items
    `, [campaignName, first.payload.data.completed[0].resource.id]);
    expect(count.rows[0]).toEqual({ campaigns: 1, items: 1 });
  });

  it('enforces audit roles and rejects a forged tenant', async () => {
    for (const role of ['admin', 'manager'] as const) {
      const allowed = await call('marketing_ops_list_audit_events_v1', {
        delegation_token: await delegation(role, ['audit:read']),
        limit: 5
      });
      expect(allowed.result.isError).not.toBe(true);
    }

    const denied = await call('marketing_ops_list_audit_events_v1', {
      delegation_token: await delegation('member', ['audit:read']),
      limit: 5
    });
    expect(denied.payload.error).toMatchObject({ code: 'forbidden', status: 403 });

    const forgedTenant = await call('marketing_ops_list_campaigns_v1', {
      delegation_token: await delegation('member', ['campaign:read'], tenantOther),
      status: 'draft',
      limit: 25
    });
    expect(forgedTenant.payload.error).toMatchObject({ code: 'tenant_forbidden', status: 403 });
  });
});
