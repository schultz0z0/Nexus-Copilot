import { randomUUID } from 'node:crypto';
import pg, { type Pool, type PoolClient } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../auth/actor.js';
import type { ArtifactClient, ArtifactMetadata } from '../integrations/artifactClient.js';
import { createCampaignDraft } from './campaigns.js';
import {
  MAX_CAMPAIGN_MATERIAL_BYTES,
  attachUploadedMaterial,
  createMaterialAccessLink,
  linkExistingMaterial,
  listMaterials,
  unlinkMaterial,
  validateMaterialFile
} from './materials.js';

const pool = new pg.Pool({
  connectionString: process.env.MARKETING_OPS_TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
});
const memberId = '11111111-1111-4111-8111-111111111111';
const managerId = '22222222-2222-4222-8222-222222222222';
const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const actor = (userId: string, role: Actor['role']): Actor => ({
  userId,
  tenantId,
  tenantSlug: 'ens',
  role
});

const artifact = (overrides: Partial<ArtifactMetadata> = {}): ArtifactMetadata => ({
  id: randomUUID(),
  ownerId: memberId,
  filename: 'brief.pdf',
  contentType: 'application/pdf',
  size: 4,
  sha256: 'a'.repeat(64),
  createdAt: '2026-07-14T12:00:00.000Z',
  source: 'marketing_ops',
  ...overrides
});

function fakeArtifacts(overrides: Partial<ArtifactClient> = {}): ArtifactClient {
  return {
    upload: vi.fn(async () => artifact()),
    getMetadata: vi.fn(async () => artifact()),
    createAccessLink: vi.fn(async () => ({
      url: 'https://files.example.test/signed',
      expiresAt: '2026-07-14T12:05:00.000Z'
    })),
    delete: vi.fn(async () => undefined),
    ...overrides
  } as unknown as ArtifactClient;
}

const context = (currentActor: Actor, artifacts: ArtifactClient, database = pool) => ({
  pool: database,
  actor: currentActor,
  artifacts,
  correlationId: randomUUID(),
  origin: 'rest' as const
});

function authorizedFakeDatabase(): { database: Pool; client: PoolClient } {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('participant.member_role::text as participant_role')) {
      return { rowCount: 1, rows: [{ status: 'draft', participant_role: 'owner' }] };
    }
    if (sql.includes('insert into marketing_ops.idempotency_records')) {
      return { rowCount: 1, rows: [{ request_hash: 'reserved' }] };
    }
    return { rowCount: 0, rows: [] };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return {
    client,
    database: { connect: vi.fn(async () => client) } as unknown as Pool
  };
}

afterAll(() => pool.end());

describe('campaign material contracts', () => {
  it('normalizes safe filenames and accepts the approved MIME-extension pairs', () => {
    const file = validateMaterialFile({
      filename: '../Planejamento FINAL.PDF',
      contentType: 'APPLICATION/PDF; charset=binary',
      bytes: Buffer.from('test')
    });
    expect(file).toMatchObject({
      filename: 'Planejamento FINAL.PDF',
      contentType: 'application/pdf',
      size: 4,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });

  it('rejects mismatched types, empty files and files above 25 MiB before network I/O', () => {
    expect(() => validateMaterialFile({
      filename: 'payload.exe',
      contentType: 'application/pdf',
      bytes: Buffer.from('test')
    })).toThrowError(expect.objectContaining({ code: 'material_type_not_allowed' }));
    expect(() => validateMaterialFile({
      filename: 'empty.txt',
      contentType: 'text/plain',
      bytes: Buffer.alloc(0)
    })).toThrowError(expect.objectContaining({ code: 'material_empty' }));
    expect(() => validateMaterialFile({
      filename: 'large.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.alloc(MAX_CAMPAIGN_MATERIAL_BYTES + 1)
    })).toThrowError(expect.objectContaining({ code: 'material_too_large' }));
  });

  it('deletes a newly uploaded artifact when the database transaction fails', async () => {
    const uploaded = artifact({
      sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    });
    const upload = vi.fn(async () => uploaded);
    const remove = vi.fn(async () => undefined);
    const artifacts = fakeArtifacts({ upload, delete: remove });
    const { database } = authorizedFakeDatabase();
    const failingContext = {
      ...context(actor(memberId, 'member'), artifacts, database),
      faultInjector: async (point: string) => {
        if (point === 'material.after_upload') throw new Error('injected database failure');
      }
    };

    await expect(attachUploadedMaterial(
      failingContext,
      randomUUID(),
      1,
      { filename: 'brief.pdf', contentType: 'application/pdf', bytes: Buffer.from('test') },
      randomUUID()
    )).rejects.toThrow('injected database failure');
    expect(upload).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(uploaded.id);
  });

  it('cleans a created artifact when its returned metadata is invalid', async () => {
    const uploaded = artifact({ contentType: 'application/octet-stream' });
    const remove = vi.fn(async () => undefined);
    const artifacts = fakeArtifacts({
      upload: vi.fn(async () => uploaded),
      delete: remove
    });
    const { database } = authorizedFakeDatabase();

    await expect(attachUploadedMaterial(
      context(actor(memberId, 'member'), artifacts, database),
      randomUUID(),
      1,
      { filename: 'brief.pdf', contentType: 'application/pdf', bytes: Buffer.from('test') },
      randomUUID()
    )).rejects.toMatchObject({ code: 'dependency_invalid_response' });
    expect(remove).toHaveBeenCalledWith(uploaded.id);
  });
});

describe('campaign materials database integration', () => {
  it('replays an upload without creating another artifact or material', async () => {
    const upload = vi.fn(async () => artifact({
      sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
    }));
    const artifacts = fakeArtifacts({ upload });
    const campaign = await createCampaignDraft(context(actor(memberId, 'member'), artifacts), {
      name: 'Uploaded material campaign',
      idempotencyKey: randomUUID()
    });
    const idempotencyKey = randomUUID();
    const input = { filename: 'brief.pdf', contentType: 'application/pdf', bytes: Buffer.from('test') };
    const linked = await attachUploadedMaterial(
      context(actor(memberId, 'member'), artifacts), campaign.id, 1, input, idempotencyKey
    );
    const replayed = await attachUploadedMaterial(
      context(actor(memberId, 'member'), artifacts), campaign.id, 1, input, idempotencyKey
    );
    expect(replayed).toEqual(linked);
    expect(upload).toHaveBeenCalledOnce();
    expect(linked.campaignVersion).toBe(2);
  });

  it('links only actor-owned artifacts and unlinks without deleting shared bytes', async () => {
    const owned = artifact({ ownerId: managerId, source: 'bridge' });
    const getMetadata = vi.fn(async () => owned);
    const remove = vi.fn(async () => undefined);
    const createAccessLink = vi.fn(async () => ({
      url: 'https://files.example.test/signed',
      expiresAt: '2026-07-14T12:05:00.000Z'
    }));
    const artifacts = fakeArtifacts({ getMetadata, delete: remove, createAccessLink });
    const campaign = await createCampaignDraft(context(actor(managerId, 'manager'), artifacts), {
      name: 'Existing material campaign',
      idempotencyKey: randomUUID()
    });
    const linked = await linkExistingMaterial(
      context(actor(managerId, 'manager'), artifacts), campaign.id, 1, owned.id, randomUUID()
    );
    const listed = await listMaterials(context(actor(managerId, 'manager'), artifacts), campaign.id);
    const access = await createMaterialAccessLink(
      context(actor(managerId, 'manager'), artifacts), campaign.id, linked.material.id
    );
    const unlinked = await unlinkMaterial(
      context(actor(managerId, 'manager'), artifacts), campaign.id, linked.material.id, 2, randomUUID()
    );
    expect(listed).toContainEqual(linked.material);
    expect(access.url).toBe('https://files.example.test/signed');
    expect(createAccessLink).toHaveBeenCalledWith(owned.id, managerId, 300);
    expect(unlinked.campaignVersion).toBe(3);
    expect(remove).not.toHaveBeenCalled();
  });

  it('rejects an existing artifact owned by another user', async () => {
    const artifacts = fakeArtifacts({
      getMetadata: vi.fn(async () => artifact({ ownerId: managerId }))
    });
    const campaign = await createCampaignDraft(context(actor(memberId, 'member'), artifacts), {
      name: 'Artifact ownership campaign',
      idempotencyKey: randomUUID()
    });
    await expect(linkExistingMaterial(
      context(actor(memberId, 'member'), artifacts), campaign.id, 1, randomUUID(), randomUUID()
    )).rejects.toMatchObject({ code: 'artifact_not_owned' });
  });
});
