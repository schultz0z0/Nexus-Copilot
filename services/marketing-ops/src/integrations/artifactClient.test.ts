import { describe, expect, it, vi } from 'vitest';
import { ArtifactClient } from './artifactClient.js';

const metadataPayload = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner_id: '11111111-1111-4111-8111-111111111111',
  session_id: null,
  filename: 'brief.pdf',
  content_type: 'application/pdf',
  size: 4,
  sha256: 'a'.repeat(64),
  created_at: '2026-07-14T12:00:00.000Z',
  source: 'marketing_ops',
  content_url: 'https://artifacts.example.test/content'
};

describe('ArtifactClient', () => {
  it('uploads bytes with the internal contract and maps safe metadata', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify(metadataPayload), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new ArtifactClient({
      baseUrl: 'http://artifact-server:8095',
      internalKey: 'internal-test-key',
      timeoutMs: 1_000,
      fetchImpl
    });

    const artifact = await client.upload({
      ownerId: metadataPayload.owner_id,
      filename: 'brief.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('test')
    });

    expect(artifact).toEqual({
      id: metadataPayload.id,
      ownerId: metadataPayload.owner_id,
      filename: 'brief.pdf',
      contentType: 'application/pdf',
      size: 4,
      sha256: 'a'.repeat(64),
      createdAt: '2026-07-14T12:00:00.000Z',
      source: 'marketing_ops'
    });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(url).toBe('http://artifact-server:8095/v1/artifacts');
    expect(init?.method).toBe('POST');
    expect(headers.get('authorization')).toBe('Bearer internal-test-key');
    expect(headers.get('x-nexus-owner-id')).toBe(metadataPayload.owner_id);
    expect(headers.get('x-nexus-filename')).toBe('brief.pdf');
    expect(headers.get('x-nexus-content-type')).toBe('application/pdf');
    expect(headers.get('x-nexus-source')).toBe('marketing_ops');
    expect(Buffer.from(init?.body as Uint8Array).toString()).toBe('test');
  });

  it('creates short owner-bound access links', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify({
      url: 'https://files.example.test/signed',
      expires_at: '2026-07-14T12:05:00.000Z'
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new ArtifactClient({
      baseUrl: 'http://artifact-server:8095/',
      internalKey: 'internal-test-key',
      timeoutMs: 1_000,
      fetchImpl
    });

    await expect(client.createAccessLink(metadataPayload.id, metadataPayload.owner_id, 300)).resolves.toEqual({
      url: 'https://files.example.test/signed',
      expiresAt: '2026-07-14T12:05:00.000Z'
    });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      owner_id: metadataPayload.owner_id,
      expires_in_seconds: 300
    });
  });

  it('maps a missing artifact to a stable application error', async () => {
    const client = new ArtifactClient({
      baseUrl: 'http://artifact-server:8095',
      internalKey: 'internal-test-key',
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: 'artifact_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      }))
    });

    await expect(client.getMetadata(metadataPayload.id)).rejects.toMatchObject({
      code: 'artifact_not_found',
      status: 404
    });
  });

  it('validates artifact ownership before a domain link is persisted', async () => {
    const client = new ArtifactClient({
      baseUrl: 'http://artifact-server:8095',
      internalKey: 'internal-test-key',
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify(metadataPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))
    });

    await expect(client.getOwnedMetadata(
      metadataPayload.id,
      '22222222-2222-4222-8222-222222222222'
    )).rejects.toMatchObject({
      code: 'artifact_not_owned',
      status: 403
    });
  });

  it('treats delete as idempotent when the artifact is already absent', async () => {
    const client = new ArtifactClient({
      baseUrl: 'http://artifact-server:8095',
      internalKey: 'internal-test-key',
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: 'artifact_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      }))
    });

    await expect(client.delete(metadataPayload.id)).resolves.toBeUndefined();
  });
});
