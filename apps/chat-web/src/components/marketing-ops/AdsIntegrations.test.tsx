// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdsIntegrations } from './AdsIntegrations';
import { LeadImportDialog } from './LeadImportDialog';
import { CampaignReportsDialog } from './CampaignReportsDialog';
import type { AdsClient, AdsConnection } from '@/lib/marketingOps/ads';
import type { LeadClient } from '@/lib/marketingOps/leads';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { MarketingOpsApiError } from '@/lib/marketingOps/client';

const connection: AdsConnection = { provider: 'meta', status: 'pending_account', version: 2, accounts: [], selectedAccountId: null, capabilities: { metrics: true, nativeLeads: false }, lastSyncAt: null, safeError: null };
function mount(node: React.ReactNode, path = '/') { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{node}</MemoryRouter></QueryClientProvider>); }
const api = (overrides: Partial<AdsClient> = {}) => ({ connections: vi.fn().mockResolvedValue({ data: [connection, { ...connection, provider: 'google', status: 'unprepared' }, { ...connection, provider: 'linkedin', status: 'partial' }] }), accounts: vi.fn().mockResolvedValue({ data: [{ id: 'a', name: 'Empresa', currency: 'BRL', timeZone: 'America/Sao_Paulo' }, { id: 'm', name: 'Gerenciadora', currency: 'BRL', timeZone: null, manager: true }] }), selectAccount: vi.fn().mockResolvedValue({ data: { ...connection, status: 'connected', selectedAccountId: 'a', version: 3 } }), ...overrides } as AdsClient);
afterEach(cleanup);
describe('Advertising integrations', () => {
  it('offers configuration for all unprepared providers only to an administrator', async () => {
    const client = api({ connections: vi.fn().mockResolvedValue({ data: ['meta', 'google', 'linkedin'].map(provider => ({ ...connection, provider, status: 'unprepared' })) }), setup: vi.fn() });
    mount(<AdsIntegrations api={client} canManage canConfigure />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Configurar aplicativo/ })).toHaveLength(3));
    expect(client.setup).not.toHaveBeenCalled();
  });
  it('shows pending selection, independent permissions and honest unprepared setup', async () => {
    mount(<AdsIntegrations api={api()} canManage />);
    await screen.findByRole('heading', { name: 'Google Ads' });
    expect(screen.getByText('Aguardando configuração')).toBeTruthy();
    expect(screen.getByText('Escolha uma conta')).toBeTruthy();
    expect(screen.getByText('Permissões parciais')).toBeTruthy();
    expect(screen.queryByLabelText(/segredo/i)).toBeNull();
  });
  it('selects a non-manager account explicitly using the observed connection version', async () => {
    const client = api(); const user = userEvent.setup(); mount(<AdsIntegrations api={client} canManage />);
    await user.click(await screen.findByRole('button', { name: 'Escolher conta Meta Ads' }));
    await screen.findByText('Empresa');
    expect(screen.getByLabelText(/Gerenciadora/).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByLabelText(/Empresa/));
    expect(client.selectAccount).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar conta' }));
    await waitFor(() => expect(client.selectAccount).toHaveBeenCalledWith('meta', 'a', 2));
    await screen.findByText('Conta selecionada.');
  });
  it('offers no mutation controls to a member', async () => {
    mount(<AdsIntegrations api={api()} canManage={false} />);
    await screen.findByText('Escolha uma conta');
    expect(screen.queryByRole('button', { name: /Escolher conta|Conectar|Desconectar|Renovar/ })).toBeNull();
    expect(screen.getByText(/administrador ou gestor/)).toBeTruthy();
  });
  it('refreshes a stale account version before a second explicit confirmation', async () => {
    const client = api({ connections: vi.fn().mockResolvedValueOnce({ data: [connection] }).mockResolvedValue({ data: [{ ...connection, version: 3 }] }), selectAccount: vi.fn().mockRejectedValueOnce(new MarketingOpsApiError('version_conflict', 409, 'Confira a versão atual', null)).mockResolvedValue({ data: { ...connection, version: 4 } }) });
    const user = userEvent.setup(); mount(<AdsIntegrations api={client} canManage />);
    await user.click(await screen.findByRole('button', { name: 'Escolher conta Meta Ads' }));
    await user.click(await screen.findByLabelText(/Empresa/));
    await user.click(screen.getByRole('button', { name: 'Confirmar conta' }));
    await screen.findByRole('alert');
    await waitFor(() => expect(client.connections).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Confirmar conta' }));
    await waitFor(() => expect(client.selectAccount).toHaveBeenNthCalledWith(2, 'meta', 'a', 3));
  });
  it('requires an explicit disconnection and announces the durable result', async () => {
    const client = api({ connections: vi.fn().mockResolvedValue({ data: [{ ...connection, status: 'connected', selectedAccountId: 'a' }] }), disconnect: vi.fn().mockResolvedValue({ data: { ...connection, status: 'disconnected', version: 3 } }) });
    const user = userEvent.setup(); mount(<AdsIntegrations api={client} canManage />);
    await user.click(await screen.findByRole('button', { name: 'Desconectar Meta Ads' }));
    expect(client.disconnect).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar desconexão' }));
    await screen.findByText('Conexão encerrada. O histórico foi preservado.');
    expect(client.disconnect).toHaveBeenCalledWith('meta', 2);
  });
  it('refreshes after an OAuth outcome without claiming an account is connected', async () => {
    const client = api(); mount(<AdsIntegrations api={client} canManage />, '/settings/integrations?provider=meta&result=connected');
    await screen.findByText('Autorização recebida. Escolha sua conta.');
    expect(screen.queryByText('Conta conectada')).toBeNull();
    expect(client.connections).toHaveBeenCalled();
  });
  it('loads native contacts for human review without showing a file form or auto-importing', async () => {
    const preview = { id: 'preview', sourceId: 'source', rows: [{ rowIndex: 0, status: 'new', input: { name: 'Ana' }, issues: [], candidates: [] }, { rowIndex: 1, status: 'possible_duplicate', input: { name: 'Maria' }, issues: [], candidates: [] }], summary: { new: 1, possible_duplicate: 1, duplicate: 0, invalid: 0 } };
    const client = { importPreview: vi.fn().mockResolvedValue({ data: preview }), confirmImport: vi.fn(), sources: vi.fn() } as unknown as LeadClient;
    mount(<LeadImportDialog campaignId="campaign" api={client} existingPreviewId="preview" onClose={() => {}} />);
    await screen.findByText('Possível duplicado');
    expect(screen.queryByLabelText('Arquivo de contatos')).toBeNull();
    expect(screen.getByText(/Nada foi importado ainda/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar importação' }).hasAttribute('disabled')).toBe(true);
    expect(client.confirmImport).not.toHaveBeenCalled();
  });
  it('directs an expired native preview back to synchronization without rebuilding its contacts', async () => {
    const client = { importPreview: vi.fn().mockRejectedValue(new MarketingOpsApiError('preview_expired', 409, 'expirou', null)), sources: vi.fn(), previewImport: vi.fn() } as unknown as LeadClient;
    mount(<LeadImportDialog campaignId="campaign" api={client} existingPreviewId="expired" onClose={() => {}} />);
    await screen.findByText(/Sincronize novamente/);
    expect(screen.queryByLabelText('Arquivo de contatos')).toBeNull();
    expect(client.previewImport).not.toHaveBeenCalled();
  });
  it('handles the actor-bound preview 404 without claiming its existence or bypassing it', async () => {
    const client = { importPreview: vi.fn().mockRejectedValue(new MarketingOpsApiError('not_found', 404, 'not_found', null)), sources: vi.fn(), previewImport: vi.fn() } as unknown as LeadClient;
    mount(<LeadImportDialog campaignId="campaign" api={client} existingPreviewId="owned" onClose={() => {}} />);
    await screen.findByText(/Esta prévia não está disponível para sua conta/);
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).toBeNull();
    expect(client.previewImport).not.toHaveBeenCalled();
  });
  it('clears a native preview when the source revision returns version_conflict and requires fresh synchronization', async () => {
    const preview = { id: 'preview', sourceId: 'source', expiresAt: '2099-09-30T12:00:00Z', rows: [{ rowIndex: 0, status: 'new', input: { name: 'Ana' }, issues: [], candidates: [] }], summary: { new: 1, possible_duplicate: 0, duplicate: 0, invalid: 0 } };
    const client = { importPreview: vi.fn().mockResolvedValue({ data: preview }), confirmImport: vi.fn().mockRejectedValue(new MarketingOpsApiError('version_conflict', 409, 'changed', null)), previewImport: vi.fn(), sources: vi.fn() } as unknown as LeadClient;
    const user = userEvent.setup(); mount(<LeadImportDialog campaignId="campaign" api={client} existingPreviewId="preview" onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Confirmar importação' }));
    await screen.findByText(/Sincronize novamente/);
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).toBeNull();
    expect(client.confirmImport).toHaveBeenCalledTimes(1);
    expect(client.previewImport).not.toHaveBeenCalled();
    expect(client.importPreview).toHaveBeenCalledTimes(1);
  });
  it('reopens a confirmed expired native batch as its persisted receipt without another confirmation or synchronization', async () => {
    const preview = { id: 'preview', sourceId: 'source', expiresAt: '2000-09-30T12:00:00Z', rows: [{ rowIndex: 0, status: 'possible_duplicate', input: { name: 'Ana' }, issues: [], candidates: [] }], summary: { new: 0, possible_duplicate: 1, duplicate: 0, invalid: 0 }, receipt: { previewId: 'preview', created: 17, linked: 9, skipped: 4, duplicate: 3, invalid: 2 } };
    const client = { importPreview: vi.fn().mockResolvedValue({ data: preview }), confirmImport: vi.fn(), previewImport: vi.fn(), sources: vi.fn() } as unknown as LeadClient;
    mount(<LeadImportDialog campaignId="campaign" api={client} existingPreviewId="preview" onClose={() => {}} />);
    await screen.findByText('Importação concluída');
    expect(screen.getByText('Este lote já foi confirmado. Confira o recibo da importação registrada nesta campanha.')).toBeTruthy();
    expect(screen.getByText('17 criados · 9 vinculados · 3 já registrados · 4 ignorados · 2 inválidos')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).toBeNull();
    expect(screen.queryByLabelText('Decisão para linha 1')).toBeNull();
    expect(screen.queryByLabelText('Arquivo de contatos')).toBeNull();
    expect(screen.queryByText(/Nada foi importado ainda/)).toBeNull();
    expect(screen.queryByText(/Sincronize novamente/)).toBeNull();
    expect(client.confirmImport).not.toHaveBeenCalled();
    expect(client.previewImport).not.toHaveBeenCalled();
    expect(client.sources).not.toHaveBeenCalled();
  });
  it('keeps provider report history readable and removes its manual revision control', async () => {
    const client = { reports: vi.fn().mockResolvedValue({ data: [{ id: 'r', sourceId: 's', periodFrom: '2026-09-01', periodTo: '2026-09-01', metrics: { spend: 10 }, adsLinkId: 'link', version: 1 }] }), sources: vi.fn().mockResolvedValue({ data: [] }), reportRevisions: vi.fn() } as unknown as LeadClient;
    mount(<CampaignReportsDialog campaignId="campaign" api={client} ops={{} as MarketingOpsClient} readOnly={false} onClose={() => {}} />);
    await screen.findByText('Atualizado pelo provedor');
    expect(screen.queryByRole('button', { name: 'Revisar relatório' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver histórico' })).toBeTruthy();
  });
});
