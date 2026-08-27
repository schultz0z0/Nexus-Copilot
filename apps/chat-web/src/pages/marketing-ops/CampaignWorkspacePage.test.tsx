// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MarketingOpsApiError, type MarketingOpsClient } from '@/lib/marketingOps/client';
import type {
  MarketingOpsCampaign,
  MarketingOpsCourseReference,
  MarketingOpsResult
} from '@/lib/marketingOps/types';
import CampaignWorkspacePage from './CampaignWorkspacePage';

const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => vi.stubGlobal('ResizeObserver', ResizeObserverStub));
afterAll(() => vi.unstubAllGlobals());

const campaign = (overrides: Partial<MarketingOpsCampaign> = {}): MarketingOpsCampaign => ({
  id: campaignId,
  tenantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  name: 'Lançamento Gestão de Riscos',
  courseSlug: null,
  objective: 'Objetivo inicial',
  referenceType: 'initiative',
  referenceKey: 'iniciativa-riscos',
  referenceTitleSnapshot: 'Gestão de Riscos',
  referenceDocumentId: null,
  referenceVerifiedAt: null,
  audience: 'Corretores',
  startsOn: '2026-07-20',
  endsOn: '2026-08-20',
  primaryChannel: 'email',
  secondaryChannels: ['linkedin'],
  briefing: 'Briefing inicial',
  notes: 'Notas iniciais',
  status: 'draft',
  version: 3,
  createdBy: '11111111-1111-4111-8111-111111111111',
  updatedBy: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-07-14T12:00:00.000Z',
  updatedAt: '2026-07-14T13:00:00.000Z',
  archivedAt: null,
  ...overrides
});

const result = <T,>(data: T): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-workspace',
  etag: '"3"'
});

function makeClient(overrides: Partial<MarketingOpsClient> = {}): MarketingOpsClient {
  return {
    getCampaign: vi.fn().mockResolvedValue(result(campaign())),
    updateCampaign: vi.fn().mockImplementation(async (_id, _version, patch) => result(campaign({
      ...patch,
      version: 4
    }))),
    transitionCampaign: vi.fn().mockImplementation(async (_id, _version, to) => result(campaign({
      status: to,
      version: 4
    }))),
    archiveCampaign: vi.fn().mockResolvedValue(result(campaign({
      status: 'archived',
      version: 4,
      archivedAt: '2026-07-14T14:00:00.000Z'
    }))),
    listParticipants: vi.fn().mockResolvedValue(result([])),
    listParticipantCandidates: vi.fn().mockResolvedValue(result([])),
    addParticipant: vi.fn(),
    updateParticipant: vi.fn(),
    removeParticipant: vi.fn(),
    listMaterials: vi.fn().mockResolvedValue(result([])),
    uploadMaterial: vi.fn(),
    linkMaterial: vi.fn(),
    unlinkMaterial: vi.fn(),
    createMaterialAccessLink: vi.fn(),
    listTimeline: vi.fn().mockResolvedValue({
      ...result([]),
      page: { limit: 25, count: 0, nextCursor: null }
    }),
    searchCourseReferences: vi.fn().mockResolvedValue(result([])),
    ...overrides
  } as unknown as MarketingOpsClient;
}

function renderWorkspace(
  client: MarketingOpsClient,
  options: {
    entry?: string;
    canWrite?: boolean;
    canArchive?: boolean;
    referenceDebounceMs?: number;
    tenantRole?: 'member' | 'manager' | 'admin';
    currentUserId?: string | null;
  } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[options.entry ?? `/marketing-ops/campaigns/${campaignId}`]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route
            path="/marketing-ops/campaigns/:campaignId"
            element={(
              <CampaignWorkspacePage
                client={client}
                canWrite={options.canWrite ?? true}
                canArchive={options.canArchive ?? true}
                tenantRole={options.tenantRole ?? 'manager'}
                currentUserId={options.currentUserId}
                referenceDebounceMs={options.referenceDebounceMs ?? 0}
                idempotencyKey={() => 'idem-workspace'}
              />
            )}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe('CampaignWorkspacePage', () => {
  it('preserves local values on 409 and reapplies only the local patch over the fresh version', async () => {
    const current = campaign({ objective: 'Objetivo do servidor', version: 4 });
    const updated = campaign({ objective: 'Objetivo local', version: 5 });
    const getCampaign = vi.fn()
      .mockResolvedValueOnce(result(campaign()))
      .mockResolvedValueOnce(result(current));
    const updateCampaign = vi.fn()
      .mockRejectedValueOnce(new MarketingOpsApiError(
        'version_conflict',
        409,
        'A campanha mudou',
        'corr-conflict',
        { currentVersion: 4 }
      ))
      .mockResolvedValueOnce(result(updated));
    const client = makeClient({ getCampaign, updateCampaign });
    const user = userEvent.setup();
    renderWorkspace(client);

    const objective = await screen.findByLabelText(/^objetivo$/i) as HTMLTextAreaElement;
    await user.clear(objective);
    await user.type(objective, 'Objetivo local');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));

    expect(await screen.findByRole('dialog', { name: /conflito de versão/i })).toBeTruthy();
    expect(objective.value).toBe('Objetivo local');
    expect(screen.getByText('Objetivo do servidor')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /reaplicar minhas alterações/i }));

    await waitFor(() => expect(updateCampaign).toHaveBeenLastCalledWith(
      campaignId,
      4,
      { objective: 'Objetivo local' },
      'idem-workspace'
    ));
    expect(await screen.findByText(/versão 5/i)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /conflito de versão/i })).toBeNull();
  });

  it('validates dates and never saves before the explicit command', async () => {
    const updateCampaign = vi.fn().mockResolvedValue(result(campaign({
      objective: 'Objetivo editado',
      endsOn: '2026-08-25',
      version: 4
    })));
    const client = makeClient({ updateCampaign });
    const user = userEvent.setup();
    renderWorkspace(client);

    const objective = await screen.findByLabelText(/^objetivo$/i);
    await user.clear(objective);
    await user.type(objective, 'Objetivo editado');
    expect(updateCampaign).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/^término$/i));
    await user.type(screen.getByLabelText(/^término$/i), '2026-07-10');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));
    expect(await screen.findByText(/término não pode ser anterior/i)).toBeTruthy();
    expect(updateCampaign).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/^término$/i));
    await user.type(screen.getByLabelText(/^término$/i), '2026-08-25');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));
    await waitFor(() => expect(updateCampaign).toHaveBeenCalledWith(
      campaignId,
      3,
      { objective: 'Objetivo editado', endsOn: '2026-08-25' },
      'idem-workspace'
    ));
  });

  it('selects an official course and saves its canonical snapshot', async () => {
    const course: MarketingOpsCourseReference = {
      referenceKey: 'ENS-123',
      title: 'Gestão de Riscos e Seguros',
      documentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      collection: 'courses',
      category: 'Seguros',
      courseType: 'Formação',
      offerMetadata: { modalities: ['online'], locations: [], statuses: ['active'] },
      verifiedAt: '2026-07-14T14:00:00.000Z'
    };
    const searchCourseReferences = vi.fn().mockResolvedValue(result([course]));
    const updateCampaign = vi.fn().mockResolvedValue(result(campaign({
      referenceType: 'course',
      referenceKey: course.referenceKey,
      referenceTitleSnapshot: course.title,
      referenceDocumentId: course.documentId,
      referenceVerifiedAt: course.verifiedAt,
      version: 4
    })));
    const client = makeClient({ searchCourseReferences, updateCampaign });
    const user = userEvent.setup();
    renderWorkspace(client);

    await screen.findByLabelText(/tipo de referência/i);
    await user.selectOptions(screen.getByLabelText(/tipo de referência/i), 'course');
    await user.type(screen.getByRole('searchbox', { name: /buscar curso oficial/i }), 'riscos');
    await user.click(await screen.findByRole('button', { name: /gestão de riscos e seguros/i }));
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => expect(searchCourseReferences).toHaveBeenCalledWith('riscos', 10));
    expect(updateCampaign).toHaveBeenCalledWith(campaignId, 3, expect.objectContaining({
      referenceType: 'course',
      referenceKey: 'ENS-123',
      referenceTitleSnapshot: 'Gestão de Riscos e Seguros',
      referenceDocumentId: course.documentId
    }), 'idem-workspace');
  });

  it('keeps unrelated draft fields editable when the course catalog is unavailable', async () => {
    const searchCourseReferences = vi.fn().mockRejectedValue(new MarketingOpsApiError(
      'reference_service_unavailable',
      503,
      'Catálogo indisponível',
      'corr-rag'
    ));
    const base = campaign({
      referenceType: 'course',
      referenceKey: 'ENS-123',
      referenceTitleSnapshot: 'Gestão de Riscos',
      referenceDocumentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      referenceVerifiedAt: '2026-07-10T10:00:00.000Z'
    });
    const updateCampaign = vi.fn().mockResolvedValue(result(campaign({ ...base, audience: 'Nova audiência', version: 4 })));
    const client = makeClient({
      getCampaign: vi.fn().mockResolvedValue(result(base)),
      searchCourseReferences,
      updateCampaign
    });
    const user = userEvent.setup();
    renderWorkspace(client);

    await user.type(await screen.findByRole('searchbox', { name: /buscar curso oficial/i }), 'novo');
    expect((await screen.findByRole('alert')).textContent).toContain('corr-rag');
    const audience = screen.getByLabelText(/^público$/i);
    await user.clear(audience);
    await user.type(audience, 'Nova audiência');
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }));

    await waitFor(() => expect(updateCampaign).toHaveBeenCalledWith(
      campaignId,
      3,
      { audience: 'Nova audiência' },
      'idem-workspace'
    ));
  });

  it('transitions status and requires explicit confirmation before archiving', async () => {
    const transitionCampaign = vi.fn().mockResolvedValue(result(campaign({ status: 'active', version: 4 })));
    const archiveCampaign = vi.fn().mockResolvedValue(result(campaign({
      status: 'archived',
      version: 5,
      archivedAt: '2026-07-14T15:00:00.000Z'
    })));
    const base = campaign({ status: 'planned' });
    const client = makeClient({
      getCampaign: vi.fn().mockResolvedValue(result(base)),
      transitionCampaign,
      archiveCampaign
    });
    const user = userEvent.setup();
    renderWorkspace(client, { canArchive: true });

    await user.click(await screen.findByRole('button', { name: /^ativar$/i }));
    await waitFor(() => expect(transitionCampaign).toHaveBeenCalledWith(
      campaignId,
      3,
      'active',
      'idem-workspace'
    ));
    await user.click(screen.getByRole('button', { name: /arquivar campanha/i }));
    expect(screen.getByRole('alertdialog', { name: /arquivar campanha/i })).toBeTruthy();
    expect(archiveCampaign).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /confirmar arquivamento/i }));
    await waitFor(() => expect(archiveCampaign).toHaveBeenCalledWith(
      campaignId,
      4,
      'idem-workspace'
    ));
    expect(await screen.findByText(/somente leitura/i)).toBeTruthy();
  });

  it('composes collaboration panels and carries their aggregate version into the next transition', async () => {
    const user = userEvent.setup();
    const owner = {
      userId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Marina Souza',
      avatarUrl: null,
      memberRole: 'owner' as const,
      isPrimary: true
    };
    const viewer = {
      userId: '22222222-2222-4222-8222-222222222222',
      displayName: 'Beatriz Lima',
      avatarUrl: null,
      memberRole: 'viewer' as const,
      isPrimary: false
    };
    const updateParticipant = vi.fn().mockResolvedValue(result({
      participant: { ...viewer, memberRole: 'editor' as const },
      campaignVersion: 4
    }));
    const transitionCampaign = vi.fn().mockResolvedValue(result(campaign({ status: 'planned', version: 5 })));
    const client = makeClient({
      listParticipants: vi.fn().mockResolvedValue(result([owner, viewer])),
      updateParticipant,
      transitionCampaign
    });
    renderWorkspace(client, {
      tenantRole: 'manager',
      currentUserId: owner.userId
    });

    expect(await screen.findByRole('heading', { name: 'Pessoas' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Materiais' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Atividade' })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText(/papel de beatriz lima/i), 'editor');
    expect(await screen.findByText('Versão 4')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^planejar$/i }));
    await waitFor(() => expect(transitionCampaign).toHaveBeenCalledWith(
      campaignId,
      4,
      'planned',
      'idem-workspace'
    ));
  });

  it('fails closed for a member viewer even when the global write flag is enabled', async () => {
    const viewerId = '22222222-2222-4222-8222-222222222222';
    const client = makeClient({
      listParticipants: vi.fn().mockResolvedValue(result([{
        userId: viewerId,
        displayName: 'Beatriz Lima',
        avatarUrl: null,
        memberRole: 'viewer',
        isPrimary: false
      }]))
    });
    renderWorkspace(client, {
      canWrite: true,
      tenantRole: 'member',
      currentUserId: viewerId
    });

    const name = await screen.findByLabelText(/^nome$/i) as HTMLInputElement;
    await waitFor(() => expect(name.matches(':disabled')).toBe(true));
    expect(screen.queryByRole('button', { name: /salvar alterações/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^planejar$/i })).toBeNull();
  });

  it('renders safe states for invalid ids, not found and read-only access', async () => {
    const invalidClient = makeClient();
    const { unmount } = renderWorkspace(invalidClient, {
      entry: '/marketing-ops/campaigns/not-a-uuid'
    });
    expect(await screen.findByText(/link de campanha inválido/i)).toBeTruthy();
    expect(invalidClient.getCampaign).not.toHaveBeenCalled();
    unmount();

    const notFound = new MarketingOpsApiError('not_found', 404, 'Campaign not found', 'corr-404');
    const notFoundClient = makeClient({ getCampaign: vi.fn().mockRejectedValue(notFound) });
    const second = renderWorkspace(notFoundClient);
    expect(await screen.findByText(/campanha não encontrada/i)).toBeTruthy();
    second.unmount();

    const readOnlyClient = makeClient();
    renderWorkspace(readOnlyClient, { canWrite: false, canArchive: false });
    const name = await screen.findByLabelText(/^nome$/i) as HTMLInputElement;
    expect(name.matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: /salvar alterações/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /arquivar campanha/i })).toBeNull();
  });
});
