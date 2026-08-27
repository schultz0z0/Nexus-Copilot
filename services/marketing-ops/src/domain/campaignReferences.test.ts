import { describe, expect, it, vi } from 'vitest';
import { resolveCampaignReference } from './campaigns.js';
import type { CampaignInput } from './contracts.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const baseInput: CampaignInput = {
  name: 'Campanha',
  objective: null,
  referenceType: null,
  referenceKey: null,
  referenceTitleSnapshot: null,
  referenceDocumentId: null,
  audience: null,
  startsOn: null,
  endsOn: null,
  primaryChannel: null,
  secondaryChannels: [],
  briefing: null,
  notes: null
};

describe('campaign course reference resolution', () => {
  it('replaces client snapshots with the canonical verified RAG identity', async () => {
    const verifyCourseReference = vi.fn().mockResolvedValue({
      referenceKey: 'ENS-123',
      title: 'Titulo oficial',
      documentId,
      collection: 'courses',
      category: 'Pos',
      courseType: 'MBA',
      offerMetadata: { modalities: [], locations: [], statuses: [] },
      verifiedAt: '2026-07-14T12:30:00.000Z'
    });

    await expect(resolveCampaignReference(
      {
        ...baseInput,
        referenceType: 'course',
        referenceKey: 'ENS-123',
        referenceTitleSnapshot: 'Titulo adulterado',
        referenceDocumentId: documentId
      },
      { referenceTouched: true, previousVerifiedAt: null, verifier: { verifyCourseReference } }
    )).resolves.toEqual({
      input: {
        ...baseInput,
        referenceType: 'course',
        referenceKey: 'ENS-123',
        referenceTitleSnapshot: 'Titulo oficial',
        referenceDocumentId: documentId
      },
      verifiedAt: '2026-07-14T12:30:00.000Z'
    });
    expect(verifyCourseReference).toHaveBeenCalledWith(documentId, 'ENS-123');
  });

  it('preserves verification for unrelated edits and clears it for incomplete course identity', async () => {
    const verifier = { verifyCourseReference: vi.fn() };
    const complete = {
      ...baseInput,
      referenceType: 'course' as const,
      referenceKey: 'ENS-123',
      referenceTitleSnapshot: 'Titulo oficial',
      referenceDocumentId: documentId
    };
    await expect(resolveCampaignReference(complete, {
      referenceTouched: false,
      previousVerifiedAt: '2026-07-14T12:30:00.000Z',
      verifier
    })).resolves.toEqual({ input: complete, verifiedAt: '2026-07-14T12:30:00.000Z' });

    const incomplete = { ...complete, referenceKey: null };
    await expect(resolveCampaignReference(incomplete, {
      referenceTouched: true,
      previousVerifiedAt: '2026-07-14T12:30:00.000Z',
      verifier
    })).resolves.toEqual({ input: incomplete, verifiedAt: null });
    expect(verifier.verifyCourseReference).not.toHaveBeenCalled();
  });

  it('fails closed when a complete course identity cannot reach a verifier', async () => {
    await expect(resolveCampaignReference({
      ...baseInput,
      referenceType: 'course',
      referenceKey: 'ENS-123',
      referenceTitleSnapshot: 'Titulo',
      referenceDocumentId: documentId
    }, {
      referenceTouched: true,
      previousVerifiedAt: null
    })).rejects.toMatchObject({ code: 'dependency_unavailable', status: 503 });
  });

  it('rejects a verifier response that changes the selected document identity', async () => {
    await expect(resolveCampaignReference({
      ...baseInput,
      referenceType: 'course',
      referenceKey: 'ENS-123',
      referenceTitleSnapshot: 'Titulo',
      referenceDocumentId: documentId
    }, {
      referenceTouched: true,
      previousVerifiedAt: null,
      verifier: {
        verifyCourseReference: vi.fn().mockResolvedValue({
          referenceKey: 'ENS-OTHER',
          title: 'Outro curso',
          documentId,
          verifiedAt: '2026-07-14T12:30:00.000Z'
        })
      }
    })).rejects.toMatchObject({ code: 'reference_not_verified', status: 422 });
  });
});
