import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { appError } from '../errors.js';

export interface CourseOfferMetadata {
  modalities: string[];
  locations: string[];
  statuses: string[];
}

export interface VerifiedCourseReference {
  referenceKey: string;
  title: string;
  documentId: string;
  collection: 'courses';
  category: string | null;
  courseType: string | null;
  offerMetadata: CourseOfferMetadata;
  verifiedAt: string;
}

type RagToolCaller = (name: string, args: Record<string, unknown>) => Promise<unknown>;

interface RagCourseClientOptions {
  endpoint: string;
  timeoutMs: number;
  actorProfile?: string;
  now?: () => Date;
  callTool?: RagToolCaller;
}

const SearchPayloadSchema = z.object({ results: z.array(z.unknown()) }).passthrough();
const SearchResultSchema = z.object({
  documentId: z.string().uuid(),
  tenant: z.string(),
  collection: z.string(),
  title: z.string().trim().min(1).max(300),
  metadata: z.record(z.unknown())
}).passthrough();
const DocumentPayloadSchema = z.object({
  document_id: z.string().uuid(),
  found: z.boolean(),
  document: z.unknown().optional()
}).passthrough();
const DocumentSchema = z.object({
  id: z.string().uuid(),
  tenant: z.string(),
  collection: z.string(),
  title: z.string().trim().min(1).max(300),
  metadata: z.record(z.unknown())
}).passthrough();
const ToolEnvelopeSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.unknown().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional()
}).passthrough();

function invalidResponse(): never {
  throw appError('dependency_invalid_response', 502, 'RAG returned an invalid response');
}

function referenceNotVerified(): never {
  throw appError('reference_not_verified', 422, 'Course reference could not be verified');
}

function cleanString(value: unknown, maximum = 300): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= maximum ? result : null;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item)).filter((item): item is string => item !== null))]
    .slice(0, 25);
}

function addUnique(target: string[], value: unknown): void {
  const candidate = cleanString(value);
  if (candidate && !target.includes(candidate)) target.push(candidate);
}

function payloadFromToolResult(result: unknown): unknown {
  const envelope = ToolEnvelopeSchema.safeParse(result);
  if (!envelope.success) invalidResponse();
  if (envelope.data.isError) {
    throw appError('dependency_unavailable', 503, 'RAG rejected the request');
  }
  if (envelope.data.structuredContent !== undefined) return envelope.data.structuredContent;
  const text = envelope.data.content?.find((item) => item.type === 'text' && item.text)?.text;
  if (!text) invalidResponse();
  try {
    return JSON.parse(text);
  } catch {
    invalidResponse();
  }
}

async function callMcpTool(
  endpoint: string,
  timeoutMs: number,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const client = new Client({ name: 'nexus-marketing-ops-rag-client', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  try {
    // SDK 1.29 has an exact-optional mismatch between its transport and client declarations.
    await client.connect(transport as unknown as Parameters<Client['connect']>[0], { timeout: timeoutMs });
    return await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
  } finally {
    await client.close().catch(() => undefined);
  }
}

export class RagCourseClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly actorProfile: string;
  private readonly now: () => Date;
  private readonly callToolImpl: RagToolCaller;

  constructor(options: RagCourseClientOptions) {
    this.endpoint = z.string().url().parse(options.endpoint);
    this.timeoutMs = z.number().int().min(100).max(30_000).parse(options.timeoutMs);
    this.actorProfile = z.string().trim().min(1).max(100).parse(options.actorProfile ?? 'marketing_ops');
    this.now = options.now ?? (() => new Date());
    this.callToolImpl = options.callTool ?? ((name, args) =>
      callMcpTool(this.endpoint, this.timeoutMs, name, args));
  }

  private async invoke(name: string, args: Record<string, unknown>): Promise<unknown> {
    let result: unknown;
    try {
      result = await this.callToolImpl(name, args);
    } catch (error) {
      throw appError('dependency_unavailable', 503, 'RAG is unavailable', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
    return payloadFromToolResult(result);
  }

  async searchCourses(query: string, limit: number): Promise<VerifiedCourseReference[]> {
    const normalizedQuery = z.string().trim().min(2).max(200).parse(query);
    const normalizedLimit = z.number().int().min(1).max(25).parse(limit);
    const payload = SearchPayloadSchema.safeParse(await this.invoke('ens_rag_search', {
      query: normalizedQuery,
      collections: ['courses'],
      intent: 'course_fact',
      limit: Math.min(normalizedLimit * 4, 50),
      actor_profile: this.actorProfile,
      require_evidence: true,
      search_mode: 'text'
    }));
    if (!payload.success) invalidResponse();

    const verifiedAt = this.now().toISOString();
    const courses = new Map<string, VerifiedCourseReference>();
    for (const candidate of payload.data.results) {
      const parsed = SearchResultSchema.safeParse(candidate);
      if (!parsed.success || parsed.data.tenant !== 'ens' || parsed.data.collection !== 'courses') continue;
      const referenceKey = cleanString(parsed.data.metadata.course_id, 200);
      if (!referenceKey) continue;
      const existing = courses.get(parsed.data.documentId);
      if (existing && existing.referenceKey !== referenceKey) continue;
      const course = existing ?? {
        referenceKey,
        title: parsed.data.title,
        documentId: parsed.data.documentId,
        collection: 'courses' as const,
        category: cleanString(parsed.data.metadata.course_category),
        courseType: cleanString(parsed.data.metadata.course_type),
        offerMetadata: { modalities: [], locations: [], statuses: [] },
        verifiedAt
      };
      course.category ??= cleanString(parsed.data.metadata.course_category);
      course.courseType ??= cleanString(parsed.data.metadata.course_type);
      addUnique(course.offerMetadata.modalities, parsed.data.metadata.offer_modality);
      addUnique(course.offerMetadata.locations, parsed.data.metadata.offer_location);
      addUnique(course.offerMetadata.statuses, parsed.data.metadata.offer_status);
      courses.set(parsed.data.documentId, course);
      if (courses.size >= normalizedLimit) break;
    }
    return [...courses.values()].slice(0, normalizedLimit);
  }

  async verifyCourseReference(documentId: string, referenceKey: string): Promise<VerifiedCourseReference> {
    const parsedDocumentId = z.string().uuid().parse(documentId);
    const parsedReferenceKey = z.string().trim().min(1).max(200).parse(referenceKey);
    const payload = DocumentPayloadSchema.safeParse(await this.invoke('ens_rag_get_document', {
      document_id: parsedDocumentId,
      expected_collection: 'courses',
      actor_profile: this.actorProfile
    }));
    if (!payload.success) invalidResponse();
    if (!payload.data.found || payload.data.document_id !== parsedDocumentId) referenceNotVerified();
    const document = DocumentSchema.safeParse(payload.data.document);
    if (!document.success) invalidResponse();
    const courseId = cleanString(document.data.metadata.course_id, 200);
    if (
      document.data.id !== parsedDocumentId ||
      document.data.tenant !== 'ens' ||
      document.data.collection !== 'courses' ||
      courseId !== parsedReferenceKey
    ) {
      referenceNotVerified();
    }
    return {
      referenceKey: courseId,
      title: document.data.title,
      documentId: document.data.id,
      collection: 'courses',
      category: cleanString(document.data.metadata.course_category),
      courseType: cleanString(document.data.metadata.course_type),
      offerMetadata: {
        modalities: cleanStringArray(document.data.metadata.modalidades),
        locations: cleanStringArray(document.data.metadata.localidades),
        statuses: cleanStringArray(document.data.metadata.status_ofertas)
      },
      verifiedAt: this.now().toISOString()
    };
  }
}
