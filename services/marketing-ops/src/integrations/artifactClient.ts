import { z } from 'zod';
import { appError } from '../errors.js';

export interface ArtifactMetadata {
  id: string;
  ownerId: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
  source: string;
}

export interface ArtifactAccessLink {
  url: string;
  expiresAt: string;
}

export interface ArtifactUpload {
  ownerId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface ArtifactClientOptions {
  baseUrl: string;
  internalKey: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

const ArtifactResponseSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().trim().min(1).max(200),
  filename: z.string().trim().min(1).max(180),
  content_type: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.string().datetime(),
  source: z.string().trim().min(1).max(100)
}).passthrough();

const AccessLinkResponseSchema = z.object({
  url: z.string().url(),
  expires_at: z.string().datetime()
}).strict();

function invalidDependencyResponse(): never {
  throw appError('dependency_invalid_response', 502, 'Artifact Server returned an invalid response');
}

export class ArtifactClient {
  private readonly baseUrl: string;
  private readonly internalKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: ArtifactClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.internalKey = options.internalKey;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(path: string, init: RequestInit): Promise<{ response: Response; payload: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.internalKey}`,
          ...init.headers
        },
        signal: controller.signal
      });
    } catch {
      throw appError('dependency_unavailable', 503, 'Artifact Server is unavailable');
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) {
      if (response.status === 404 || payload?.error === 'artifact_not_found') {
        throw appError('artifact_not_found', 404, 'Artifact not found');
      }
      if (response.status === 413) {
        throw appError('material_too_large', 413, 'Material exceeds the allowed size');
      }
      if (response.status === 403) {
        throw appError('artifact_not_owned', 403, 'Artifact owner does not match');
      }
      throw appError('dependency_unavailable', 503, 'Artifact Server rejected the request');
    }
    return { response, payload };
  }

  private mapMetadata(payload: unknown): ArtifactMetadata {
    const parsed = ArtifactResponseSchema.safeParse(payload);
    if (!parsed.success) invalidDependencyResponse();
    return {
      id: parsed.data.id,
      ownerId: parsed.data.owner_id,
      filename: parsed.data.filename,
      contentType: parsed.data.content_type,
      size: parsed.data.size,
      sha256: parsed.data.sha256,
      createdAt: parsed.data.created_at,
      source: parsed.data.source
    };
  }

  async upload(input: ArtifactUpload): Promise<ArtifactMetadata> {
    const { payload } = await this.request('/v1/artifacts', {
      method: 'POST',
      headers: {
        'Content-Type': input.contentType,
        'X-Nexus-Content-Type': input.contentType,
        'X-Nexus-Filename': input.filename,
        'X-Nexus-Owner-Id': input.ownerId,
        'X-Nexus-Source': 'marketing_ops'
      },
      body: input.bytes as BodyInit
    });
    return this.mapMetadata(payload);
  }

  async getMetadata(artifactId: string): Promise<ArtifactMetadata> {
    const { payload } = await this.request(`/v1/artifacts/${encodeURIComponent(artifactId)}`, {
      method: 'GET'
    });
    return this.mapMetadata(payload);
  }

  async getOwnedMetadata(
    artifactId: string,
    ownerId: string
  ): Promise<ArtifactMetadata> {
    const metadata = await this.getMetadata(artifactId);
    if (metadata.ownerId !== ownerId) {
      throw appError('artifact_not_owned', 403, 'Artifact belongs to another user');
    }
    return metadata;
  }

  async createAccessLink(
    artifactId: string,
    ownerId: string,
    expiresInSeconds = 300
  ): Promise<ArtifactAccessLink> {
    const { payload } = await this.request(
      `/v1/artifacts/${encodeURIComponent(artifactId)}/access-link`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: ownerId, expires_in_seconds: expiresInSeconds })
      }
    );
    const parsed = AccessLinkResponseSchema.safeParse(payload);
    if (!parsed.success) invalidDependencyResponse();
    return { url: parsed.data.url, expiresAt: parsed.data.expires_at };
  }

  async delete(artifactId: string): Promise<void> {
    try {
      await this.request(`/v1/artifacts/${encodeURIComponent(artifactId)}`, { method: 'DELETE' });
    } catch (error) {
      if ((error as { code?: string }).code === 'artifact_not_found') return;
      throw error;
    }
  }
}
