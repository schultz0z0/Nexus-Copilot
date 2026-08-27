import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '../auth/actor.js';
import { createCampaignDraft } from './campaigns.js';
import {
  createContentAsset,
  createContentVersion,
  listContentAssets,
  listContentVersions
} from './content.js';
import { createProductionItem } from './items.js';

const pool = new pg.Pool({
  connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
});
const member: Actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantSlug: 'ens',
  role: 'member'
};
const otherTenant: Actor = {
  userId: '44444444-4444-4444-8444-444444444444',
  tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  tenantSlug: 'other',
  role: 'member'
};

afterAll(() => pool.end());

const context = (actor: Actor = member) => ({
  pool,
  actor,
  correlationId: randomUUID(),
  origin: 'rest' as const
});

async function item() {
  const campaign = await createCampaignDraft(context(), {
    name: `Content campaign ${randomUUID()}`,
    idempotencyKey: randomUUID()
  });
  return createProductionItem(context(), campaign.id, {
    kind: 'email',
    title: 'Conteúdo versionado',
    idempotencyKey: randomUUID()
  });
}

describe('content assets and immutable versions', () => {
  it('creates an asset, hashes first/next versions, freezes, and lists history', async () => {
    const productionItem = await item();
    const asset = await createContentAsset(context(), productionItem.id, 1, {
      assetKind: 'email_body',
      title: 'Corpo do e-mail',
      idempotencyKey: randomUUID()
    });
    expect(asset).toMatchObject({
      itemId: productionItem.id,
      assetKind: 'email_body',
      title: 'Corpo do e-mail',
      currentVersionNumber: 0,
      version: 1,
      itemVersion: 2
    });

    const firstBody = 'Texto confidencial da primeira versão';
    const first = await createContentVersion(context(), asset.id, 1, {
      body: firstBody,
      metadata: { subject: 'Oferta privada' },
      freeze: false,
      idempotencyKey: randomUUID()
    });
    const secondBody = 'Texto confidencial da versão congelada';
    const second = await createContentVersion(context(), asset.id, 2, {
      body: secondBody,
      metadata: { subject: 'Oferta final' },
      freeze: true,
      idempotencyKey: randomUUID()
    });
    const assets = await listContentAssets(context(), productionItem.id);
    const versions = await listContentVersions(context(), asset.id);

    expect(first).toMatchObject({
      assetId: asset.id,
      versionNumber: 1,
      assetVersion: 2,
      body: firstBody,
      contentHash: createHash('sha256').update(firstBody).digest('hex'),
      frozenAt: null
    });
    expect(second).toMatchObject({
      assetId: asset.id,
      versionNumber: 2,
      assetVersion: 3,
      body: secondBody,
      contentHash: createHash('sha256').update(secondBody).digest('hex'),
      frozenAt: expect.any(String)
    });
    expect(assets[0]).toMatchObject({
      id: asset.id,
      currentVersionNumber: 2,
      version: 3
    });
    expect(versions.map((version) => version.versionNumber)).toEqual([2, 1]);

    const audit = await pool.query<{ serialized: string }>(`
      select coalesce(jsonb_agg(after_state)::text, '[]') as serialized
      from marketing_ops.audit_events
      where entity_id = $1
        and action like 'content_%'
    `, [productionItem.id]);
    expect(audit.rows[0]?.serialized).not.toContain(firstBody);
    expect(audit.rows[0]?.serialized).not.toContain(secondBody);
    expect(audit.rows[0]?.serialized).not.toContain('Oferta privada');
  });

  it('keeps every version append-only even for privileged SQL', async () => {
    const productionItem = await item();
    const asset = await createContentAsset(context(), productionItem.id, 1, {
      assetKind: 'copy',
      title: 'Copy',
      idempotencyKey: randomUUID()
    });
    await createContentVersion(context(), asset.id, 1, {
      body: 'Snapshot imutável',
      metadata: {},
      freeze: true,
      idempotencyKey: randomUUID()
    });

    await expect(pool.query(`
      update marketing_ops.content_versions
      set body = 'mutado'
      where asset_id = $1 and version_number = 1
    `, [asset.id])).rejects.toMatchObject({ code: '55000' });
    await expect(pool.query(`
      delete from marketing_ops.content_versions
      where asset_id = $1 and version_number = 1
    `, [asset.id])).rejects.toMatchObject({ code: '55000' });
    expect((await listContentVersions(context(), asset.id))[0]?.body)
      .toBe('Snapshot imutável');
  });

  it('serializes competing saves and allocates one next version', async () => {
    const productionItem = await item();
    const asset = await createContentAsset(context(), productionItem.id, 1, {
      assetKind: 'message',
      title: 'Mensagem concorrente',
      idempotencyKey: randomUUID()
    });

    const outcomes = await Promise.allSettled([
      createContentVersion(context(), asset.id, 1, {
        body: 'Versão concorrente A',
        metadata: {},
        freeze: false,
        idempotencyKey: randomUUID()
      }),
      createContentVersion(context(), asset.id, 1, {
        body: 'Versão concorrente B',
        metadata: {},
        freeze: false,
        idempotencyKey: randomUUID()
      })
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'version_conflict',
      status: 409,
      details: { currentVersion: 2 }
    });
    expect(await listContentVersions(context(), asset.id)).toHaveLength(1);
  });

  it('hides content identities across tenants', async () => {
    const productionItem = await item();
    const asset = await createContentAsset(context(), productionItem.id, 1, {
      assetKind: 'copy',
      title: 'Privado ENS',
      idempotencyKey: randomUUID()
    });

    await expect(listContentAssets(context(otherTenant), productionItem.id))
      .rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(createContentVersion(context(otherTenant), asset.id, 1, {
      body: 'tentativa externa',
      metadata: {},
      freeze: false,
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});
