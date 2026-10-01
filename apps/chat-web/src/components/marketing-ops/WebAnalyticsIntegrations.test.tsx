// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAnalyticsIntegrations } from './WebAnalyticsIntegrations';
import type { AnalyticsClient, AnalyticsConnection } from '@/lib/marketingOps/analytics';
const ga4: AnalyticsConnection = { provider: 'ga4', status: 'prepared', version: 2, resources: [], selectedResourceId: null, lastSyncAt: null, safeError: null };
const clarity: AnalyticsConnection = { ...ga4, provider: 'clarity', status: 'unprepared', version: 0 };
const resource = { id: 'properties/123', name: 'Site Prometeus', timeZone: 'America/Sao_Paulo' };
const client = (overrides: Partial<AnalyticsClient> = {}) => ({ connections: vi.fn().mockResolvedValue({ data: [ga4, clarity] }), authorize: vi.fn().mockResolvedValue({ data: { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque' } }), resources: vi.fn().mockResolvedValue({ data: [resource] }), selectResource: vi.fn().mockResolvedValue({ data: { ...ga4, status: 'connected' } }), connectClarity: vi.fn().mockResolvedValue({ data: { ...clarity, status: 'connected' } }), disconnect: vi.fn().mockResolvedValue({ data: { ...ga4, status: 'disconnected' } }), ...overrides } as unknown as AnalyticsClient);
function mount(api: AnalyticsClient, manage = true, configure = true, path = '/', redirect = vi.fn()) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><WebAnalyticsIntegrations api={api} canManage={manage} canConfigure={configure} redirect={redirect} /></MemoryRouter></QueryClientProvider>);
}
afterEach(cleanup);
describe('Web analytics integrations', () => {
  it('opens Google consent with one action without asking the user for a client secret', async () => {
    const api = client(); const redirect = vi.fn(); mount(api, true, true, '/', redirect);
    await userEvent.click(await screen.findByRole('button', { name: 'Conectar Google Analytics' }));
    expect(api.authorize).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?state=opaque');
    expect(screen.queryByLabelText(/segredo do aplicativo/i)).toBeNull();
  });
  it('requires property selection and explicit confirmation using the observed version', async () => {
    const api = client({ connections: vi.fn().mockResolvedValue({ data: [{ ...ga4, status: 'pending_resource' }, clarity] }) }); mount(api);
    const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Escolher propriedade' }));
    await user.click(await screen.findByLabelText(/Site Prometeus/));
    expect(api.selectResource).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar propriedade' }));
    await waitFor(() => expect(api.selectResource).toHaveBeenCalledWith('properties/123', 2, false));
  });
  it('offers a useful empty property state for a user who has not installed GA4', async () => {
    mount(client({ connections: vi.fn().mockResolvedValue({ data: [{ ...ga4, status: 'pending_resource' }] }), resources: vi.fn().mockResolvedValue({ data: [] }) }));
    await userEvent.click(await screen.findByRole('button', { name: 'Escolher propriedade' }));
    await screen.findByText(/Nenhuma propriedade acessível/);
    expect(screen.getByRole('link', { name: 'Criar propriedade GA4' }).getAttribute('href')).toBe('https://analytics.google.com/');
  });
  it('validates Clarity only after explicit submit and clears the secret after success', async () => {
    const api = client(); mount(api); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Conectar Microsoft Clarity' }));
    const secret = screen.getByLabelText('Token de exportação'); expect(secret.getAttribute('type')).toBe('password');
    await user.type(screen.getByLabelText('ID do projeto'), 'project1');
    await user.type(screen.getByLabelText('Nome do projeto'), 'Site');
    await user.type(secret, 'private-token'); expect(api.connectClarity).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Validar e conectar' }));
    await screen.findByText('Clarity conectado. A leitura do projeto foi validada.');
    expect(screen.queryByLabelText('Token de exportação')).toBeNull();
    expect(api.connectClarity).toHaveBeenCalledWith({ token: 'private-token', projectId: 'project1', projectName: 'Site' }, 0, expect.any(String));
  });
  it('does not offer mutation controls to members, and restricts Clarity token preparation to admins', async () => {
    mount(client(), false, false); await screen.findByRole('heading', { name: 'Google Analytics' });
    expect(screen.queryByRole('button', { name: /Conectar|Trocar|Desconectar|Escolher/ })).toBeNull();
  });
  it('requires explicit confirmation before disconnection and preserves historical data', async () => {
    const api = client({ connections: vi.fn().mockResolvedValue({ data: [{ ...ga4, status: 'connected', resources: [resource], selectedResourceId: resource.id }] }) }); mount(api);
    const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Desconectar Google Analytics' }));
    expect(api.disconnect).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar desconexão' }));
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith('ga4', 2));
    await screen.findByText('Conexão encerrada. O histórico foi preservado.');
  });
  it('requires confirmation before replacing a connected Google authorization', async () => {
    const api = client({ connections: vi.fn().mockResolvedValue({ data: [{ ...ga4, status: 'connected', resources: [resource], selectedResourceId: resource.id }] }) }); const redirect = vi.fn(); mount(api, true, true, '/', redirect);
    const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Trocar conta Google' }));
    expect(api.authorize).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar nova autorização' }));
    await waitFor(() => expect(api.authorize).toHaveBeenCalledOnce());
  });
});
