// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignLeadsPanel } from './CampaignLeadsPanel';
import { LeadSourcesPanel } from './LeadSourcesPanel';
import { CampaignReportsDialog } from './CampaignReportsDialog';
import type { LeadClient, LeadSource, ResultReport } from '@/lib/marketingOps/leads';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { MarketingOpsApiError } from '@/lib/marketingOps/client';

const source: LeadSource = { id: 'source', campaignId: 'campaign', publicId: 'public', name: 'Meta • conversão', channel: 'meta_ads', kind: 'manual', classification: 'lead', actionId: null, allowedOrigins: [], enabled: true, version: 1, createdAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:00:00Z' };
const report: ResultReport = { id: 'report', campaignId: 'campaign', sourceId: 'source', periodFrom: '2026-09-21', periodTo: '2026-09-27', timeZone: 'America/Sao_Paulo', metrics: { sent: 100, sales: 2 }, version: 1, createdAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:00:00Z' };
function client(overrides: Partial<LeadClient> = {}): LeadClient {
  return { sources: vi.fn().mockResolvedValue({ data: [source] }), contacts: vi.fn().mockResolvedValue({ data: [], page: { nextCursor: null } }), captureReviews: vi.fn().mockResolvedValue({ data: [] }), reports: vi.fn().mockResolvedValue({ data: [report] }), reportRevisions: vi.fn().mockResolvedValue({ data: [] }), createSource: vi.fn().mockResolvedValue({ data: source }), updateSource: vi.fn(), previewImport: vi.fn().mockResolvedValue({ data: { id: 'preview', sourceId: 'source', campaignId: 'campaign', expiresAt: '2099-09-30T12:00:00Z', summary: { new: 1, duplicate: 0, possible_duplicate: 1, invalid: 0 }, rows: [{ rowIndex: 0, status: 'new', input: { name: 'Ana', email: 'ana@example.test' }, issues: [], candidates: [] }, { rowIndex: 1, status: 'possible_duplicate', input: { name: 'Maria', email: 'maria@example.test' }, issues: [], candidates: [{ id: 'contact', name: 'Maria', email: 'maria@example.test', phone: null, company: null }] }] } }), confirmImport: vi.fn().mockResolvedValue({ data: { previewId: 'preview', created: 1, linked: 1, duplicate: 0, skipped: 0, invalid: 0 } }), resolveCapture: vi.fn().mockResolvedValue({ data: { status: 'linked' } }), createReport: vi.fn().mockResolvedValue({ data: report }), updateReport: vi.fn().mockResolvedValue({ data: { ...report, version: 2 } }), results: vi.fn(), ...overrides } as LeadClient;
}
const ops = { listProductionSchedule: vi.fn().mockResolvedValue({ data: [], page: { nextCursor: null } }) } as unknown as MarketingOpsClient;
function mount(node: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{node}</MemoryRouter></QueryClientProvider>); }
afterEach(cleanup);
describe('Campaign acquisition', () => {
  it('requires server preview and an explicit duplicate decision before importing', async () => {
    const api = client(); const user = userEvent.setup();
    mount(<CampaignLeadsPanel campaignId="campaign" api={api} readOnly={false} />);
    await user.click(await screen.findByRole('button', { name: 'Importar contatos' }));
    await user.selectOptions(await screen.findByLabelText('Fonte da importação'), 'source');
    const file = new File(['Nome,Email\nAna,ana@example.test\nMaria,maria@example.test'], 'leads.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => 'Nome,Email\nAna,ana@example.test\nMaria,maria@example.test' });
    await user.upload(screen.getByLabelText('Arquivo de contatos'), file);
    await user.type(await screen.findByLabelText('Data de captação quando ausente'), '2026-09-30');
    await user.click(screen.getByRole('button', { name: 'Gerar prévia' }));
    expect(await screen.findByText('Possível duplicado')).toBeTruthy();
    expect(api.confirmImport).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirmar importação' }).hasAttribute('disabled')).toBe(true);
    await user.selectOptions(screen.getByLabelText('Decisão para linha 2'), 'link:contact');
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }));
    await screen.findByText('Importação concluída');
    expect(api.confirmImport).toHaveBeenCalledWith('campaign', 'preview', [{ rowIndex: 0, action: 'create' }, { rowIndex: 1, action: 'link', contactId: 'contact' }], expect.any(String));
  });
  it('keeps read-only contacts visible without mutation controls', async () => {
    mount(<CampaignLeadsPanel campaignId="campaign" api={client()} readOnly />);
    await screen.findByText('Nenhum contato neste recorte.');
    expect(screen.queryByRole('button', { name: 'Importar contatos' })).toBeNull();
  });
  it('creates a Maps source as cold contacts and does not describe it as an Ads connection', async () => {
    const api = client(); const user = userEvent.setup();
    mount(<LeadSourcesPanel campaignId="campaign" api={api} ops={ops} readOnly={false} />);
    await user.click(await screen.findByRole('button', { name: 'Nova fonte' }));
    await user.type(screen.getByLabelText('Nome da fonte'), 'Prospecção Maps');
    await user.selectOptions(screen.getByLabelText('Canal da fonte'), 'google_maps');
    expect(screen.getByLabelText('Classificação inicial')).toHaveProperty('value', 'cold');
    await user.click(screen.getByRole('button', { name: 'Salvar fonte' }));
    await waitFor(() => expect(api.createSource).toHaveBeenCalledWith('campaign', expect.objectContaining({ channel: 'google_maps', classification: 'cold', kind: 'manual' }), expect.any(String)));
  });
  it('revises a weekly report with measured zero and omits blank metrics', async () => {
    const api = client(); const user = userEvent.setup();
    mount(<CampaignReportsDialog campaignId="campaign" api={api} ops={ops} readOnly={false} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Revisar relatório' }));
    await user.clear(screen.getByLabelText('Vendas')); await user.type(screen.getByLabelText('Vendas'), '0');
    await user.click(screen.getByRole('button', { name: 'Revisar valores' }));
    expect(api.updateReport).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar revisão' }));
    await waitFor(() => expect(api.updateReport).toHaveBeenCalledWith('campaign', 'report', 1, { sourceId: 'source', actionId: null, periodFrom: '2026-09-21', periodTo: '2026-09-27', timeZone: 'America/Sao_Paulo', notes: null, metrics: { sent: 100, sales: 0 } }, expect.any(String)));
  });
  it('restores source dialog keyboard focus to its opening control', async () => {
    const user = userEvent.setup(); mount(<LeadSourcesPanel campaignId="campaign" api={client()} ops={ops} readOnly={false} />);
    const trigger = await screen.findByRole('button', { name: 'Nova fonte' }); await user.click(trigger);
    await screen.findByRole('dialog'); await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('preserves report edits through a version conflict and requires another review', async () => {
    const fresh = { ...report, version: 2, metrics: { sent: 200, sales: 4 } };
    const api = client({ reports: vi.fn().mockResolvedValueOnce({ data: [report] }).mockResolvedValue({ data: [fresh] }), updateReport: vi.fn().mockRejectedValueOnce(new MarketingOpsApiError('version_conflict', 409, 'O relatório mudou', 'corr')).mockResolvedValue({ data: { ...fresh, version: 3 } }) });
    const user = userEvent.setup(); mount(<CampaignReportsDialog campaignId="campaign" api={api} ops={ops} readOnly={false} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Revisar relatório' }));
    await user.clear(screen.getByLabelText('Vendas')); await user.type(screen.getByLabelText('Vendas'), '3');
    await user.click(screen.getByRole('button', { name: 'Revisar valores' })); await user.click(screen.getByRole('button', { name: 'Confirmar revisão' }));
    await user.click(await screen.findByRole('button', { name: 'Carregar versão atual' }));
    expect(api.updateReport).toHaveBeenCalledTimes(1);
    await user.click(await screen.findByRole('button', { name: 'Revisar minhas alterações' }));
    expect(screen.getByLabelText('Vendas')).toHaveProperty('value', '3');
    await user.click(screen.getByRole('button', { name: 'Revisar valores' })); await user.click(screen.getByRole('button', { name: 'Confirmar revisão' }));
    await waitFor(() => expect(api.updateReport).toHaveBeenLastCalledWith('campaign', 'report', 2, expect.objectContaining({ metrics: { sent: 100, sales: 3 } }), expect.any(String)));
  });
  it('shows read-only revision history with exact measured cents', async () => {
    const api = client({ reportRevisions: vi.fn().mockResolvedValue({ data: [{ version: 1, snapshot: { ...report, metrics: { revenue: 123.45 } }, createdAt: report.createdAt }] }) });
    const user = userEvent.setup(); mount(<CampaignReportsDialog campaignId="campaign" api={api} ops={ops} readOnly onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Ver histórico' }));
    expect(await screen.findByText(/123,45/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Registrar relatório' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revisar relatório' })).toBeNull();
  });
  it('creates a fresh preview after expiration while keeping file mapping and capture date', async () => {
    const api = client({ confirmImport: vi.fn().mockRejectedValue(new MarketingOpsApiError('preview_expired', 409, 'A prévia expirou', 'corr')) });
    const user = userEvent.setup(); mount(<CampaignLeadsPanel campaignId="campaign" api={api} readOnly={false} />);
    await user.click(await screen.findByRole('button', { name: 'Importar contatos' }));
    await user.selectOptions(await screen.findByLabelText('Fonte da importação'), 'source');
    const file = new File(['Nome,Email\nAna,ana@example.test'], 'leads.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => 'Nome,Email\nAna,ana@example.test' });
    await user.upload(screen.getByLabelText('Arquivo de contatos'), file); await user.type(await screen.findByLabelText('Data de captação quando ausente'), '2026-09-30');
    await user.click(screen.getByRole('button', { name: 'Gerar prévia' }));
    await user.selectOptions(await screen.findByLabelText('Decisão para linha 2'), 'skip'); await user.click(screen.getByRole('button', { name: 'Confirmar importação' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Data de captação quando ausente')).toHaveProperty('value', '2026-09-30');
    await user.click(screen.getByRole('button', { name: 'Gerar prévia' }));
    await screen.findByLabelText('Decisão para linha 2');
    const calls = vi.mocked(api.previewImport).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[1][3]).not.toBe(calls[0][3]);
  });
  it('exposes the selected calendar action and notes before confirming a report revision', async () => {
    const api = client({ reports: vi.fn().mockResolvedValue({ data: [{ ...report, actionId: 'action', notes: 'Relatório conferido no serviço' }] }) });
    const schedule = { listProductionSchedule: vi.fn().mockResolvedValue({ data: [{ id: 'action', title: 'Disparo da campanha' }], page: { nextCursor: null } }) } as unknown as MarketingOpsClient;
    const user = userEvent.setup(); mount(<CampaignReportsDialog campaignId="campaign" api={api} ops={schedule} readOnly={false} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Revisar relatório' }));
    await user.click(screen.getByRole('button', { name: 'Revisar valores' }));
    const review = screen.getByRole('region', { name: 'Revisão dos valores' });
    expect(review.textContent).toContain('Disparo da campanha');
    expect(review.textContent).toContain('Relatório conferido no serviço');
    expect(api.updateReport).not.toHaveBeenCalled();
  });
});
