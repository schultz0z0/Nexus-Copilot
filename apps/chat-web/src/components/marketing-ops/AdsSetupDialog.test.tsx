// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdsSetupDialog } from './AdsSetupDialog';
import { MarketingOpsApiError } from '@/lib/marketingOps/client';
import { adsKeys, type AdsClient, type AdsSetup } from '@/lib/marketingOps/ads';

const metadata: AdsSetup = { provider: 'meta', version: 1, mode: 'empty', writable: true, ready: false, publicOrigin: 'https://empresa.test', redirectUri: 'https://empresa.test/api/ads/oauth/meta/callback', clientId: null, apiVersion: null, scopes: [], metaLoginConfigId: null, googleLoginCustomerId: null, hasClientSecret: false };
function mount(overrides: Partial<AdsSetup> = {}, save = vi.fn().mockResolvedValue({ data: { ...metadata, mode: 'managed', ready: true, version: 2 } })) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = { setup: vi.fn().mockResolvedValue({ data: { ...metadata, ...overrides } }), saveSetup: save } as unknown as AdsClient;
  const onAuthorize = vi.fn(); const onClose = vi.fn();
  const result = render(<QueryClientProvider client={qc}><AdsSetupDialog provider={overrides.provider ?? 'meta'} api={api} onClose={onClose} onSaved={vi.fn()} onAuthorize={onAuthorize} focusFallback={() => null} /></QueryClientProvider>);
  return { api, qc, onAuthorize, onClose, ...result };
}
async function fill() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('ID do aplicativo'), '123');
  await user.type(screen.getByLabelText('Segredo do aplicativo'), 'entered-secret');
  await user.type(screen.getByLabelText('Versão da API'), 'v23.0');
  await user.type(screen.getByLabelText('ID da configuração de login'), '456');
  return user;
}
afterEach(cleanup);
describe('Ads application setup', () => {
  it('requires a review, keeps the secret out of review/cache and authorizes only after an explicit action', async () => {
    const client = mount(); const user = await fill();
    expect(screen.getByText(metadata.redirectUri!)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    expect(screen.queryByDisplayValue('entered-secret')).toBeNull();
    expect(screen.getByText('Novo segredo informado')).toBeTruthy();
    expect(client.api.saveSetup).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await screen.findByText('Aplicativo preparado. Falta autorizar e escolher a conta.');
    expect(client.onAuthorize).not.toHaveBeenCalled();
    expect(JSON.stringify(client.qc.getQueryCache().getAll().map(query => query.state.data))).not.toContain('entered-secret');
    expect(client.qc.getMutationCache().getAll()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Continuar e autorizar' }));
    expect(client.onAuthorize).toHaveBeenCalledTimes(1);
  });
  it('validates mandatory fields and focuses the first invalid control', async () => {
    const client = mount(); const user = userEvent.setup();
    await screen.findByLabelText('ID do aplicativo');
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    expect(document.activeElement).toBe(screen.getByLabelText('ID do aplicativo'));
    expect(screen.getByLabelText('ID do aplicativo').getAttribute('aria-invalid')).toBe('true');
    expect(client.api.saveSetup).not.toHaveBeenCalled();
  });
  it('preserves a managed secret when blank and requires replacement confirmation', async () => {
    const client = mount({ mode: 'managed', clientId: '123', apiVersion: 'v23.0', metaLoginConfigId: '456', scopes: ['ads_read'], hasClientSecret: true });
    const user = userEvent.setup(); await screen.findByLabelText('ID do aplicativo');
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    expect(screen.getByText('Segredo armazenado será preservado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar aplicativo' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByLabelText(/Confirmo a troca/));
    await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await waitFor(() => expect(client.api.saveSetup).toHaveBeenCalledWith('meta', expect.objectContaining({ confirmReplacement: true }), 1, expect.any(String)));
    expect(vi.mocked(client.api.saveSetup).mock.calls[0][1]).not.toHaveProperty('clientSecret');
  });
  it('requires explicit external takeover and a new secret', async () => {
    const client = mount({ mode: 'external', writable: false, clientId: '123', apiVersion: 'v23.0', metaLoginConfigId: '456', hasClientSecret: true });
    const user = userEvent.setup(); await screen.findByLabelText('ID do aplicativo');
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    expect(screen.getByText('Informe o segredo do aplicativo.')).toBeTruthy();
    await user.type(screen.getByLabelText('Segredo do aplicativo'), 'new-secret');
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    await user.click(screen.getByLabelText(/Confirmo a troca/));
    expect(screen.getByRole('button', { name: 'Salvar aplicativo' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByLabelText(/Assumir a gestão/));
    await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await waitFor(() => expect(client.api.saveSetup).toHaveBeenCalledWith('meta', expect.objectContaining({ takeOverExternal: true, clientSecret: 'new-secret' }), 1, expect.any(String)));
  });
  it('reuses the proposal on a network retry without sending duplicate in-flight requests', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ data: { ...metadata, ready: true, version: 2 } });
    const client = mount({}, save); const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[0][3]).toBe(save.mock.calls[1][3]);
    expect(client.onAuthorize).not.toHaveBeenCalled();
  });
  it('loads the fresh version after conflict, preserves input and requires another review', async () => {
    const save = vi.fn().mockRejectedValueOnce(new MarketingOpsApiError('version_conflict', 409, 'safe', null)).mockResolvedValue({ data: { ...metadata, ready: true, version: 3 } });
    const client = mount({}, save); const user = await fill();
    vi.mocked(client.api.setup).mockResolvedValue({ data: { ...metadata, version: 2 } });
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await screen.findByText(/A versão atual foi carregada/);
    expect(screen.getByLabelText('ID do aplicativo').getAttribute('value')).toBe('123');
    expect(screen.queryByRole('button', { name: 'Salvar aplicativo' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][2]).toBe(2); expect(save.mock.calls[0][3]).not.toBe(save.mock.calls[1][3]);
  });
  it('explains a missing server origin and offers retry without permitting save', async () => {
    const client = mount({ publicOrigin: null, redirectUri: null, writable: false });
    await screen.findByText(/endereço público de retorno/);
    expect(screen.queryByRole('button', { name: 'Revisar aplicativo' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Carregar configuração novamente' }));
    await waitFor(() => expect(client.api.setup).toHaveBeenCalledTimes(2));
  });
  it('blocks invalid credential characters and oversized IDs before review', async () => {
    mount(); const user = await fill();
    await user.clear(screen.getByLabelText('ID do aplicativo')); await user.type(screen.getByLabelText('ID do aplicativo'), 'client with spaces');
    await user.clear(screen.getByLabelText('ID da configuração de login')); await user.type(screen.getByLabelText('ID da configuração de login'), '1'.repeat(31));
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    expect(screen.getByLabelText('ID do aplicativo').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('ID da configuração de login').getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Revise antes de salvar')).toBeNull();
  });
  it('does not claim a version was loaded if conflict refresh fails', async () => {
    const client = mount({}, vi.fn().mockRejectedValue(new MarketingOpsApiError('version_conflict', 409, 'safe', null))); const user = await fill();
    vi.mocked(client.api.setup).mockRejectedValue(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' })); await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await screen.findByText(/Não foi possível carregar a versão atual/);
    expect(screen.queryByRole('button', { name: 'Revisar aplicativo' })).toBeNull();
    expect(screen.getByLabelText('Segredo do aplicativo').getAttribute('value')).toBe('entered-secret');
  });
  it('locks duplicate submissions and cancellation until the save resolves', async () => {
    let complete: (value: unknown) => void = () => {};
    const pending = new Promise(resolve => { complete = resolve; }); const save = vi.fn().mockReturnValue(pending);
    const client = mount({}, save); const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' })); await user.dblClick(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    expect(save).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Cancelar' }).hasAttribute('disabled')).toBe(true);
    await user.keyboard('{Escape}'); expect(client.onClose).not.toHaveBeenCalled();
    complete({ data: { ...metadata, ready: true, version: 2 } });
    await screen.findByRole('button', { name: 'Continuar e autorizar' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Continuar e autorizar' })));
  });
  it('retains the reviewed version when a background GET refreshes metadata before save', async () => {
    const client = mount(); const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    vi.mocked(client.api.setup).mockResolvedValue({ data: { ...metadata, version: 2 } });
    await act(async () => { await client.qc.refetchQueries({ queryKey: adsKeys.setup('meta') }); });
    await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await waitFor(() => expect(client.api.saveSetup).toHaveBeenCalledWith('meta', expect.any(Object), 1, expect.any(String)));
  });
  it('retains version, replacement mode and idempotency key after an ambiguous save and background refresh', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ data: { ...metadata, ready: true, version: 3 } });
    const client = mount({}, save); const user = await fill();
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' })); await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await screen.findByRole('alert');
    vi.mocked(client.api.setup).mockResolvedValue({ data: { ...metadata, mode: 'managed', version: 2, hasClientSecret: true } });
    await act(async () => { await client.qc.refetchQueries({ queryKey: adsKeys.setup('meta') }); });
    await user.click(screen.getByRole('button', { name: 'Salvar aplicativo' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][2]).toBe(1); expect(save.mock.calls[1][3]).toBe(save.mock.calls[0][3]);
    expect(save.mock.calls[1][1]).toEqual(save.mock.calls[0][1]);
  });
  it('opens advanced options before focusing an invalid Google manager ID', async () => {
    mount({ provider: 'google', mode: 'managed', clientId: 'google-client', apiVersion: 'v25', scopes: ['https://www.googleapis.com/auth/adwords'], hasClientSecret: true });
    const user = userEvent.setup(); await screen.findByLabelText('ID do cliente OAuth');
    await user.click(screen.getByText('Opções avançadas do Google Ads'));
    await user.type(screen.getByLabelText('ID da conta gerenciadora (opcional)'), '123');
    await user.click(screen.getByText('Opções avançadas do Google Ads'));
    await user.click(screen.getByRole('button', { name: 'Revisar aplicativo' }));
    const input = screen.getByLabelText('ID da conta gerenciadora (opcional)');
    expect(input.closest('details')?.open).toBe(true); expect(document.activeElement).toBe(input);
    expect(screen.getByText('Informe os 10 dígitos da conta gerenciadora.')).toBeTruthy();
  });
});
