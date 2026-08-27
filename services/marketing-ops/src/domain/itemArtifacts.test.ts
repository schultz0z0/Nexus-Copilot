import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../auth/actor.js';
import type { ArtifactClient, ArtifactMetadata } from '../integrations/artifactClient.js';
import { createCampaignDraft } from './campaigns.js';
import { createContentAsset } from './content.js';
import {
  attachUploadedItemArtifact,
  createItemArtifactAccessLink,
  linkExistingItemArtifact,
  listItemArtifacts,
  unlinkItemArtifact
} from './itemArtifacts.js';
import { createProductionItem, updateProductionItem } from './items.js';

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

const metadata = (overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata => ({
  id: randomUUID(),
  ownerId: member.userId,
  filename: 'peca.png',
  contentType: 'image/png',
  size: 4,
  sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  createdAt: '2026-07-18T12:00:00.000Z',
  source: 'marketing_ops',
  ...overrides
});

function artifacts(current = metadata(), overrides: Partial<ArtifactClient> = {}): ArtifactClient {
  return {
    upload: vi.fn(async () => current),
    getMetadata: vi.fn(async () => current),
    getOwnedMetadata: vi.fn(async (_id: string, ownerId: string) => {
      if (current.ownerId !== ownerId) {
        throw Object.assign(new Error('Artifact owner does not match'), {
          code: 'artifact_not_owned',
          status: 403
        });
      }
      return current;
    }),
    createAccessLink: vi.fn(async () => ({
      url: 'https://files.example.test/signed',
      expiresAt: '2026-07-18T12:05:00.000Z'
    })),
    delete: vi.fn(async () => undefined),
    ...overrides
  } as unknown as ArtifactClient;
}

afterAll(() => pool.end());

const context = (
  artifactClient: ArtifactClient,
  actor: Actor = member
) => ({
  pool,
  actor,
  artifacts: artifactClient,
  correlationId: randomUUID(),
  origin: 'rest' as const
});

async function item(artifactClient: ArtifactClient) {
  const campaign = await createCampaignDraft(context(artifactClient), {
    name: `Item artifact campaign ${randomUUID()}`,
    idempotencyKey: randomUUID()
  });
  return createProductionItem(context(artifactClient), campaign.id, {
    kind: 'creative',
    title: 'Peça visual',
    idempotencyKey: randomUUID()
  });
}

describe('item artifact links', () => {
  it('uploads, replays, lists, signs, and unlinks without deleting shared bytes', async () => {
    const artifactMetadata = metadata();
    const artifactClient = artifacts(artifactMetadata);
    const productionItem = await item(artifactClient);
    const asset = await createContentAsset(context(artifactClient), productionItem.id, 1, {
      assetKind: 'creative',
      title: 'Criativo',
      idempotencyKey: randomUUID()
    });
    const key = randomUUID();
    const input = {
      filename: 'peca.png',
      contentType: 'image/png',
      bytes: Buffer.from('test'),
      assetId: asset.id
    };

    const linked = await attachUploadedItemArtifact(
      context(artifactClient), productionItem.id, 2, input, key
    );
    const replay = await attachUploadedItemArtifact(
      context(artifactClient), productionItem.id, 2, input, key
    );
    const listed = await listItemArtifacts(context(artifactClient), productionItem.id);
    const access = await createItemArtifactAccessLink(
      context(artifactClient), productionItem.id, linked.artifact.id
    );
    const removed = await unlinkItemArtifact(
      context(artifactClient), productionItem.id, linked.artifact.id, 3, randomUUID()
    );

    expect(replay).toEqual(linked);
    expect(linked).toMatchObject({
      itemVersion: 3,
      artifact: {
        itemId: productionItem.id,
        assetId: asset.id,
        artifactId: artifactMetadata.id,
        artifactOwnerId: member.userId,
        sha256: artifactMetadata.sha256
      }
    });
    expect(listed).toEqual([linked.artifact]);
    expect(access.url).toBe('https://files.example.test/signed');
    expect(artifactClient.createAccessLink).toHaveBeenCalledWith(
      artifactMetadata.id,
      member.userId,
      300
    );
    expect(removed).toMatchObject({
      artifactLinkId: linked.artifact.id,
      itemVersion: 4
    });
    expect(await listItemArtifacts(context(artifactClient), productionItem.id))
      .toEqual([]);
    expect(artifactClient.upload).toHaveBeenCalledOnce();
    expect(artifactClient.delete).not.toHaveBeenCalled();
  });

  it('compensates a new upload when optimistic persistence fails', async () => {
    const artifactMetadata = metadata();
    const remove = vi.fn(async () => undefined);
    const artifactClient = artifacts(artifactMetadata, { delete: remove });
    const productionItem = await item(artifactClient);
    await updateProductionItem(context(artifactClient), productionItem.id, 1, {
      title: 'Versão concorrente do item',
      idempotencyKey: randomUUID()
    });

    await expect(attachUploadedItemArtifact(
      context(artifactClient),
      productionItem.id,
      1,
      {
        filename: 'peca.png',
        contentType: 'image/png',
        bytes: Buffer.from('test')
      },
      randomUUID()
    )).rejects.toMatchObject({
      code: 'version_conflict',
      details: { currentVersion: 2 }
    });
    expect(remove).toHaveBeenCalledWith(artifactMetadata.id);
    expect(await listItemArtifacts(context(artifactClient), productionItem.id))
      .toEqual([]);
  });

  it('rejects wrong ownership and an asset from another item', async () => {
    const foreignMetadata = metadata({ ownerId: '22222222-2222-4222-8222-222222222222' });
    const foreignClient = artifacts(foreignMetadata);
    const productionItem = await item(foreignClient);
    await expect(linkExistingItemArtifact(
      context(foreignClient),
      productionItem.id,
      1,
      { artifactId: foreignMetadata.id },
      randomUUID()
    )).rejects.toMatchObject({ code: 'artifact_not_owned', status: 403 });

    const ownedMetadata = metadata();
    const ownedClient = artifacts(ownedMetadata);
    const firstItem = await item(ownedClient);
    const secondItem = await item(ownedClient);
    const foreignAsset = await createContentAsset(context(ownedClient), firstItem.id, 1, {
      assetKind: 'creative',
      title: 'Asset de outro item',
      idempotencyKey: randomUUID()
    });
    await expect(linkExistingItemArtifact(
      context(ownedClient),
      secondItem.id,
      1,
      { artifactId: ownedMetadata.id, assetId: foreignAsset.id },
      randomUUID()
    )).rejects.toMatchObject({ code: 'artifact_asset_mismatch', status: 422 });
  });

  it('hides item artifact identities across tenants', async () => {
    const artifactClient = artifacts();
    const productionItem = await item(artifactClient);
    await expect(listItemArtifacts(
      context(artifactClient, otherTenant),
      productionItem.id
    )).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});
