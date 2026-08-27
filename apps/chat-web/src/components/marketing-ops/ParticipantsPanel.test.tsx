// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type { MarketingOpsParticipant, MarketingOpsResult } from '@/lib/marketingOps/types';
import { ParticipantsPanel } from './ParticipantsPanel';

const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerId = '11111111-1111-4111-8111-111111111111';
const candidateId = '22222222-2222-4222-8222-222222222222';

const owner: MarketingOpsParticipant = {
  userId: ownerId,
  displayName: 'Marina Souza',
  avatarUrl: null,
  memberRole: 'owner',
  isPrimary: true
};

const result = <T,>(data: T): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-participants',
  etag: null
});

function makeClient(overrides: Partial<MarketingOpsClient> = {}): MarketingOpsClient {
  return {
    listParticipants: vi.fn().mockResolvedValue(result([owner])),
    listParticipantCandidates: vi.fn().mockResolvedValue(result([{
      userId: candidateId,
      displayName: 'Beatriz Lima',
      avatarUrl: null,
      tenantRole: 'member'
    }])),
    addParticipant: vi.fn().mockResolvedValue(result({
      participant: {
        userId: candidateId,
        displayName: 'Beatriz Lima',
        avatarUrl: null,
        memberRole: 'editor',
        isPrimary: false
      },
      campaignVersion: 4
    })),
    updateParticipant: vi.fn(),
    removeParticipant: vi.fn(),
    ...overrides
  } as unknown as MarketingOpsClient;
}

function renderPanel(
  client: MarketingOpsClient,
  options: {
    tenantRole?: 'member' | 'manager' | 'admin';
    currentUserId?: string | null;
    readOnly?: boolean;
    onCampaignVersionChange?: (version: number) => void;
  } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ParticipantsPanel
        campaignId={campaignId}
        campaignVersion={3}
        client={client}
        tenantRole={options.tenantRole ?? 'manager'}
        currentUserId={options.currentUserId ?? ownerId}
        readOnly={options.readOnly ?? false}
        candidateDebounceMs={0}
        idempotencyKey={() => 'idem-participant'}
        onCampaignVersionChange={options.onCampaignVersionChange ?? vi.fn()}
      />
    </QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe('ParticipantsPanel', () => {
  it('lists roles and lets a manager add a candidate while advancing the aggregate version', async () => {
    const user = userEvent.setup();
    const onVersion = vi.fn();
    const client = makeClient();
    renderPanel(client, { onCampaignVersionChange: onVersion });

    expect(await screen.findByText('Marina Souza')).toBeTruthy();
    expect(screen.getByText('Responsável principal')).toBeTruthy();
    expect(screen.getByLabelText(/papel de marina souza/i).matches(':disabled')).toBe(true);

    await user.click(screen.getByRole('button', { name: /adicionar participante/i }));
    await user.type(screen.getByLabelText(/buscar pessoa/i), 'Bea');
    await user.click(await screen.findByRole('button', { name: /selecionar beatriz lima/i }));
    await user.selectOptions(screen.getByLabelText(/papel do novo participante/i), 'editor');
    await user.click(screen.getByRole('button', { name: /confirmar participante/i }));

    await waitFor(() => expect(client.addParticipant).toHaveBeenCalledWith(
      campaignId,
      3,
      { userId: candidateId, memberRole: 'editor' },
      'idem-participant'
    ));
    expect(onVersion).toHaveBeenCalledWith(4);
    expect(await screen.findByText('Beatriz Lima')).toBeTruthy();
  });

  it('allows a primary member to manage collaborators but never owners or the primary flag', async () => {
    const user = userEvent.setup();
    const viewer: MarketingOpsParticipant = {
      userId: candidateId,
      displayName: 'Beatriz Lima',
      avatarUrl: null,
      memberRole: 'viewer',
      isPrimary: false
    };
    const updateParticipant = vi.fn().mockResolvedValue(result({
      participant: { ...viewer, memberRole: 'editor' },
      campaignVersion: 4
    }));
    const client = makeClient({
      listParticipants: vi.fn().mockResolvedValue(result([owner, viewer])),
      updateParticipant
    });
    renderPanel(client, { tenantRole: 'member', currentUserId: ownerId });

    const ownerRole = await screen.findByLabelText(/papel de marina souza/i);
    expect(ownerRole.matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: /tornar marina souza principal/i })).toBeNull();

    const viewerRole = screen.getByLabelText(/papel de beatriz lima/i);
    expect(Array.from((viewerRole as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      'editor',
      'viewer'
    ]);
    await user.selectOptions(viewerRole, 'editor');
    await waitFor(() => expect(updateParticipant).toHaveBeenCalledWith(
      campaignId,
      candidateId,
      3,
      { memberRole: 'editor' },
      'idem-participant'
    ));
  });

  it('keeps exactly one primary owner in cache when a manager adds a new primary owner', async () => {
    const user = userEvent.setup();
    const newPrimary = {
      userId: candidateId,
      displayName: 'Beatriz Lima',
      avatarUrl: null,
      memberRole: 'owner' as const,
      isPrimary: true
    };
    const client = makeClient({
      addParticipant: vi.fn().mockResolvedValue(result({
        participant: newPrimary,
        campaignVersion: 4
      }))
    });
    renderPanel(client, { tenantRole: 'manager' });

    await screen.findByText('Marina Souza');
    await user.click(screen.getByRole('button', { name: /adicionar participante/i }));
    await user.type(screen.getByLabelText(/buscar pessoa/i), 'Bea');
    await user.click(await screen.findByRole('button', { name: /selecionar beatriz lima/i }));
    await user.selectOptions(screen.getByLabelText(/papel do novo participante/i), 'owner');
    await user.click(screen.getByLabelText(/tornar principal/i));
    await user.click(screen.getByRole('button', { name: /confirmar participante/i }));

    await screen.findByText('Beatriz Lima');
    expect(screen.getAllByText('Responsável principal')).toHaveLength(1);
    expect(screen.getByLabelText(/papel de marina souza/i).matches(':disabled')).toBe(false);
  });

  it('shows add failures inside the active participant dialog', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      addParticipant: vi.fn().mockRejectedValue(new Error('Participante não pôde ser adicionado'))
    });
    renderPanel(client);

    await screen.findByText('Marina Souza');
    await user.click(screen.getByRole('button', { name: /adicionar participante/i }));
    await user.type(screen.getByLabelText(/buscar pessoa/i), 'Bea');
    await user.click(await screen.findByRole('button', { name: /selecionar beatriz lima/i }));
    await user.click(screen.getByRole('button', { name: /confirmar participante/i }));

    const dialog = screen.getByRole('dialog', { name: /adicionar participante/i });
    expect(await within(dialog).findByText('Participante não pôde ser adicionado')).toBeTruthy();
  });

  it('hides every mutation in read-only mode while preserving the participant list', async () => {
    const client = makeClient();
    renderPanel(client, { readOnly: true, tenantRole: 'admin' });

    expect(await screen.findByText('Marina Souza')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /adicionar participante/i })).toBeNull();
    expect(screen.getByLabelText(/papel de marina souza/i).matches(':disabled')).toBe(true);
  });
});
