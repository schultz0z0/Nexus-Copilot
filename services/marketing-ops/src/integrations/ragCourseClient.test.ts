import { describe, expect, it, vi } from 'vitest';
import { RagCourseClient } from './ragCourseClient.js';

const firstDocumentId = '11111111-1111-4111-8111-111111111111';
const secondDocumentId = '22222222-2222-4222-8222-222222222222';

describe('RagCourseClient', () => {
  it('returns selectable courses only and deduplicates chunk offer metadata', async () => {
    const callTool = vi.fn().mockResolvedValue({
      structuredContent: {
        results: [
          {
            documentId: firstDocumentId,
            tenant: 'ens',
            collection: 'courses',
            title: 'Gestao de Seguros',
            metadata: {
              course_id: 'ENS-123',
              course_category: 'Pos-graduacao',
              course_type: 'MBA',
              offer_status: 'available',
              offer_modality: 'Online',
              offer_location: 'Sao Paulo'
            }
          },
          {
            documentId: firstDocumentId,
            tenant: 'ens',
            collection: 'courses',
            title: 'Gestao de Seguros',
            metadata: {
              course_id: 'ENS-123',
              offer_status: 'blocked',
              offer_modality: 'Presencial',
              offer_location: 'Rio de Janeiro'
            }
          },
          {
            documentId: secondDocumentId,
            tenant: 'ens',
            collection: 'courses',
            title: 'Resultado sem chave',
            metadata: { course_type: 'Tecnico' }
          },
          {
            documentId: secondDocumentId,
            tenant: 'other',
            collection: 'courses',
            title: 'Outro tenant',
            metadata: { course_id: 'OTHER-1' }
          }
        ]
      }
    });
    const client = new RagCourseClient({
      endpoint: 'http://rag-mcp:8000/mcp',
      timeoutMs: 2_500,
      now: () => new Date('2026-07-14T12:00:00.000Z'),
      callTool
    });

    await expect(client.searchCourses('gestao', 10)).resolves.toEqual([
      {
        referenceKey: 'ENS-123',
        title: 'Gestao de Seguros',
        documentId: firstDocumentId,
        collection: 'courses',
        category: 'Pos-graduacao',
        courseType: 'MBA',
        offerMetadata: {
          modalities: ['Online', 'Presencial'],
          locations: ['Sao Paulo', 'Rio de Janeiro'],
          statuses: ['available', 'blocked']
        },
        verifiedAt: '2026-07-14T12:00:00.000Z'
      }
    ]);
    expect(callTool).toHaveBeenCalledWith('ens_rag_search', {
      query: 'gestao',
      collections: ['courses'],
      intent: 'course_fact',
      limit: 40,
      actor_profile: 'marketing_ops',
      require_evidence: true,
      search_mode: 'text'
    });
  });

  it('verifies the full document identity and returns its canonical snapshot', async () => {
    const callTool = vi.fn().mockResolvedValue({
      structuredContent: {
        document_id: firstDocumentId,
        found: true,
        document: {
          id: firstDocumentId,
          tenant: 'ens',
          collection: 'courses',
          title: 'Gestao Oficial',
          metadata: {
            course_id: 'ENS-123',
            course_category: 'Pos',
            course_type: 'MBA',
            modalidades: ['Online'],
            localidades: ['Sao Paulo'],
            status_ofertas: ['available']
          }
        }
      }
    });
    const client = new RagCourseClient({
      endpoint: 'http://rag-mcp:8000/mcp',
      timeoutMs: 2_500,
      now: () => new Date('2026-07-14T12:01:00.000Z'),
      callTool
    });

    await expect(client.verifyCourseReference(firstDocumentId, 'ENS-123')).resolves.toMatchObject({
      referenceKey: 'ENS-123',
      documentId: firstDocumentId,
      title: 'Gestao Oficial',
      verifiedAt: '2026-07-14T12:01:00.000Z'
    });
    expect(callTool).toHaveBeenCalledWith('ens_rag_get_document', {
      document_id: firstDocumentId,
      expected_collection: 'courses',
      actor_profile: 'marketing_ops'
    });
  });

  it('fails closed when document identity or course key does not match', async () => {
    const callTool = vi.fn().mockResolvedValue({
      structuredContent: {
        document_id: firstDocumentId,
        found: true,
        document: {
          id: firstDocumentId,
          tenant: 'ens',
          collection: 'courses',
          title: 'Gestao Oficial',
          metadata: { course_id: 'ENS-OTHER' }
        }
      }
    });
    const client = new RagCourseClient({ endpoint: 'http://rag-mcp:8000/mcp', timeoutMs: 2_500, callTool });

    await expect(client.verifyCourseReference(firstDocumentId, 'ENS-123')).rejects.toMatchObject({
      code: 'reference_not_verified',
      status: 422
    });
  });

  it('maps transport and malformed payload failures to stable dependency errors', async () => {
    const unavailable = new RagCourseClient({
      endpoint: 'http://rag-mcp:8000/mcp',
      timeoutMs: 2_500,
      callTool: vi.fn().mockRejectedValue(new Error('connect refused'))
    });
    await expect(unavailable.searchCourses('gestao', 10)).rejects.toMatchObject({
      code: 'dependency_unavailable',
      status: 503
    });

    const malformed = new RagCourseClient({
      endpoint: 'http://rag-mcp:8000/mcp',
      timeoutMs: 2_500,
      callTool: vi.fn().mockResolvedValue({ structuredContent: { results: 'invalid' } })
    });
    await expect(malformed.searchCourses('gestao', 10)).rejects.toMatchObject({
      code: 'dependency_invalid_response',
      status: 502
    });
  });
});
