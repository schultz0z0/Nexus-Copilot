// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type { MarketingOpsMaterial, MarketingOpsResult } from '@/lib/marketingOps/types';
import { MaterialsPanel } from './MaterialsPanel';

const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const materialId = '33333333-3333-4333-8333-333333333333';
const artifactId = '44444444-4444-4444-8444-444444444444';

const material: MarketingOpsMaterial = {
  id: materialId,
  campaignId,
  artifactId,
  artifactOwnerId: '11111111-1111-4111-8111-111111111111',
  filename: 'briefing.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  sha256: 'a'.repeat(64),
  source: 'upload',
  createdBy: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-07-14T12:00:00.000Z'
};

const result = <T,>(data: T): MarketingOpsResult<T> => ({
  data,
  correlationId: 'corr-materials',
  etag: null
});

function makeClient(overrides: Partial<MarketingOpsClient> = {}): MarketingOpsClient {
  return {
    listParticipants: vi.fn().mockResolvedValue(result([{
      userId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Marina Souza',
      avatarUrl: null,
      memberRole: 'owner',
      isPrimary: true
    }])),
    listMaterials: vi.fn().mockResolvedValue(result([material])),
    uploadMaterial: vi.fn().mockResolvedValue(result({ material, campaignVersion: 4 })),
    linkMaterial: vi.fn().mockResolvedValue(result({ material, campaignVersion: 4 })),
    unlinkMaterial: vi.fn().mockResolvedValue(result({ materialId, campaignVersion: 4 })),
    createMaterialAccessLink: vi.fn().mockResolvedValue(result({
      url: 'https://artifacts.example.test/access/signed',
      expiresAt: '2026-07-14T12:05:00.000Z'
    })),
    ...overrides
  } as unknown as MarketingOpsClient;
}

function renderPanel(
  client: MarketingOpsClient,
  options: {
    readOnly?: boolean;
    tenantRole?: 'member' | 'manager' | 'admin';
    currentUserId?: string | null;
    onCampaignVersionChange?: (version: number) => void;
    openExternal?: (url: string) => void;
  } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MaterialsPanel
        campaignId={campaignId}
        campaignVersion={3}
        client={client}
        tenantRole={options.tenantRole ?? 'manager'}
        currentUserId={options.currentUserId ?? '11111111-1111-4111-8111-111111111111'}
        readOnly={options.readOnly ?? false}
        idempotencyKey={() => 'idem-material'}
        onCampaignVersionChange={options.onCampaignVersionChange ?? vi.fn()}
        openExternal={options.openExternal ?? vi.fn()}
      />
    </QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe('MaterialsPanel', () => {
  it('uses the correct material count plural', async () => {
    const second = { ...material, id: '55555555-5555-4555-8555-555555555555', filename: 'referencia.webp' };
    const client = makeClient({ listMaterials: vi.fn().mockResolvedValue(result([material, second])) });
    renderPanel(client);
    expect(await screen.findByText('2 materiais')).toBeTruthy();
  });

  it('blocks an oversized file before network and accepts an allowed upload', async () => {
    const user = userEvent.setup();
    const onVersion = vi.fn();
    const client = makeClient();
    renderPanel(client, { onCampaignVersionChange: onVersion });
    const input = await screen.findByLabelText(/adicionar material/i);

    const oversized = new File(
      [new Uint8Array(25 * 1024 * 1024 + 1)],
      'large.pdf',
      { type: 'application/pdf' }
    );
    await user.upload(input, oversized);
    expect(client.uploadMaterial).not.toHaveBeenCalled();
    expect(screen.getByText(/máximo de 25 mib/i)).toBeTruthy();

    const allowed = new File(['conteúdo'], 'novo.pdf', { type: 'application/pdf' });
    await user.upload(input, allowed);
    await waitFor(() => expect(client.uploadMaterial).toHaveBeenCalledWith(
      campaignId,
      3,
      allowed,
      'idem-material'
    ));
    expect(onVersion).toHaveBeenCalledWith(4);
  });

  it('opens a short-lived link without rendering its URL and unlinks only after confirmation', async () => {
    const user = userEvent.setup();
    const openExternal = vi.fn();
    const client = makeClient();
    renderPanel(client, { openExternal });

    expect(await screen.findByText(/adicionado por você em/i)).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /abrir briefing\.pdf/i }));
    await waitFor(() => expect(client.createMaterialAccessLink).toHaveBeenCalledWith(campaignId, materialId));
    expect(openExternal).toHaveBeenCalledWith('https://artifacts.example.test/access/signed');
    expect(screen.queryByText(/artifacts\.example\.test/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: /desvincular briefing\.pdf/i }));
    expect(client.unlinkMaterial).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /confirmar desvínculo/i }));
    await waitFor(() => expect(client.unlinkMaterial).toHaveBeenCalledWith(
      campaignId,
      materialId,
      3,
      'idem-material'
    ));
  });

  it('links an existing artifact and hides material mutations for viewers', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const first = renderPanel(client);
    await user.click(await screen.findByRole('button', { name: /vincular existente/i }));
    await user.type(screen.getByLabelText(/id do artefato/i), artifactId);
    await user.click(screen.getByRole('button', { name: /confirmar vínculo/i }));
    await waitFor(() => expect(client.linkMaterial).toHaveBeenCalledWith(
      campaignId,
      3,
      artifactId,
      'idem-material'
    ));
    first.unmount();

    renderPanel(makeClient({
      listParticipants: vi.fn().mockResolvedValue(result([{
        userId: '11111111-1111-4111-8111-111111111111',
        displayName: 'Marina Souza',
        avatarUrl: null,
        memberRole: 'viewer',
        isPrimary: false
      }]))
    }), { tenantRole: 'member' });
    expect(await screen.findByText('briefing.pdf')).toBeTruthy();
    expect(screen.queryByLabelText(/adicionar material/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /vincular existente/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /desvincular briefing\.pdf/i })).toBeNull();
  });

  it('shows link failures inside the active material dialog', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      linkMaterial: vi.fn().mockRejectedValue(new Error('Artefato já está vinculado'))
    });
    renderPanel(client);

    await user.click(await screen.findByRole('button', { name: /vincular existente/i }));
    await user.type(screen.getByLabelText(/id do artefato/i), artifactId);
    await user.click(screen.getByRole('button', { name: /confirmar vínculo/i }));

    const dialog = screen.getByRole('dialog', { name: /vincular artefato existente/i });
    expect(await within(dialog).findByText('Artefato já está vinculado')).toBeTruthy();
  });
});
