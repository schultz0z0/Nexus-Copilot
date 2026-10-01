import { MarketingOpsApiError } from './client';

export const leadChannels = { meta_ads: 'Meta Ads', google_ads: 'Google Ads', linkedin_ads: 'LinkedIn Ads', email: 'E-mail', whatsapp: 'WhatsApp', organic: 'Orgânico', google_maps: 'Google Maps', other: 'Outro' } as const;
export type LeadChannel = keyof typeof leadChannels;
export type LeadClassification = 'cold' | 'lead';
export interface LeadSourceInput {
  name: string; channel: LeadChannel; kind: 'landing_page' | 'whatsapp' | 'manual'; classification?: LeadClassification;
  actionId?: string | null; externalAccountId?: string | null; externalCampaignId?: string | null;
  allowedOrigins?: string[]; whatsappPhone?: string | null; enabled?: boolean;
}
export interface LeadSource extends LeadSourceInput {
  id: string; campaignId: string; publicId: string; version: number; createdAt: string; updatedAt: string;
  classification: LeadClassification; allowedOrigins: string[]; enabled: boolean; actionId: string | null;
}
export interface LeadRow { name: string; email?: string; phone?: string; company?: string; externalId?: string; occurredAt: string; classification?: LeadClassification }
export interface LeadContact {
  id: string; name: string; email: string | null; phone: string | null; company: string | null; campaignId: string;
  classification: LeadClassification; sourceId: string; sourceName: string; firstOccurredAt: string; capturedAt: string | null; createdAt: string;
  origin: { campaignId: string; sourceId: string; channel: LeadChannel } | null;
}
export interface ContactCandidate { id: string; name: string; email: string | null; phone: string | null; company: string | null }
export interface ImportDecision { rowIndex: number; action: 'create' | 'link' | 'skip'; contactId?: string }
export type ReviewStatus = 'new' | 'duplicate' | 'possible_duplicate' | 'invalid';
export interface ImportPreview {
  id: string; sourceId: string; campaignId: string; expiresAt: string;
  rows: Array<{ rowIndex: number; status: ReviewStatus; input: LeadRow | null; issues: string[]; candidates: ContactCandidate[]; contactId: string | null }>;
  summary: Record<ReviewStatus, number>;
}
export interface ImportReceipt { previewId: string; created: number; linked: number; skipped: number; duplicate: number; invalid: number }
export interface ImportReview extends ImportPreview { receipt: ImportReceipt | null }
export interface CaptureReview { id: string; sourceId: string; createdAt: string; input: { name: string; email?: string; phone?: string; company?: string }; candidates: ContactCandidate[] }
export const reportMetricLabels = { sent: 'Enviados', delivered: 'Entregues', opened: 'Aberturas', clicked: 'Cliques', responded: 'Respostas', spend: 'Investimento', qualified: 'Qualificados', sales: 'Vendas', revenue: 'Receita' } as const;
export type ReportMetrics = Partial<Record<keyof typeof reportMetricLabels, number>>;
export interface ResultReportInput { sourceId: string; actionId?: string | null; periodFrom: string; periodTo: string; timeZone: string; metrics: ReportMetrics; notes?: string | null }
export interface ResultReport extends ResultReportInput { id: string; campaignId: string; version: number; createdAt: string; updatedAt: string; adsLinkId?: string | null; adsActive?: boolean }
export interface LeadResults {
  contactsCold: number; capturedLeads: number; whatsappClicks: number;
  qualified: number | null; sales: number | null; revenue: number | null; spend: number | null;
  weekly: Array<{ week: string; leads: number }>;
  channels: Array<{ channel: LeadChannel; leads: number }>;
  campaigns: Array<{ id: string; name: string; contactsCold: number; capturedLeads: number; qualified: number | null; sales: number | null; revenue: number | null; spend: number | null }>;
  coverage: { sources: number; reports: number; partialReportsExcluded: number; metricReports: Record<'qualified' | 'sales' | 'revenue' | 'spend', number> };
  lastUpdated: string | null;
}
export interface LeadResponse<T> { data: T; page?: { limit: number; count: number; nextCursor: string | null } }
export const leadKeys = {
  all: ['marketing-leads'] as const,
  sources: (id: string) => ['marketing-leads', 'sources', id] as const,
  contacts: (id: string) => ['marketing-leads', 'contacts', id] as const,
  reports: (id: string) => ['marketing-leads', 'reports', id] as const,
  reviews: (id: string) => ['marketing-leads', 'reviews', id] as const,
  results: (filters: { campaignId?: string; from?: string; to?: string } = {}) => ['marketing-leads', 'results', filters] as const,
};
const messages: Record<string, string> = {
  report_overlap: 'Este período se sobrepõe a um relatório da mesma fonte. Revise o relatório existente.',
  version_conflict: 'Os dados mudaram durante a edição. Atualize a tela e revise sua proposta.',
  review_conflict: 'Encontramos mudanças nos contatos após a prévia. Gere uma nova prévia para revisar.',
  preview_expired: 'A prévia expirou. Selecione o arquivo e revise novamente.',
  source_disabled: 'Esta fonte está desabilitada. Habilite-a ou escolha outra.',
  review_required: 'Revise os contatos pendentes antes de confirmar.',
  forbidden: 'Você não tem permissão para alterar esta campanha.',
  validation_error: 'Confira os campos e os formatos informados.',
  unauthorized: 'Sua sessão expirou. Entre novamente.',
};

export function createLeadClient(options: { fetch?: typeof globalThis.fetch; baseUrl?: string } = {}) {
  const base = (options.baseUrl ?? '/api/marketing').replace(/\/$/, '');
  const request = async <T>(path: string, method = 'GET', body?: unknown, key?: string, version?: number): Promise<LeadResponse<T>> => {
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (key) headers.set('Idempotency-Key', key);
    if (version !== undefined) headers.set('If-Match', `"${version}"`);
    const response = await (options.fetch ?? globalThis.fetch)(base + path, { method, headers, credentials: 'same-origin', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new MarketingOpsApiError(payload.error?.code ?? 'request_failed', response.status, messages[payload.error?.code] ?? 'Não foi possível concluir a operação. Tente novamente.', response.headers.get('x-correlation-id') ?? payload.error?.correlationId ?? null, payload.error?.details);
    return payload;
  };
  const campaign = (id: string) => `/campaigns/${encodeURIComponent(id)}`;
  const params = (filters: Record<string, unknown>) => { const values = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') values.set(key, String(value)); return values.size ? `?${values}` : ''; };
  return {
    sources: (id: string) => request<LeadSource[]>(`${campaign(id)}/lead-sources`),
    createSource: (id: string, body: LeadSourceInput, key: string) => request<LeadSource>(`${campaign(id)}/lead-sources`, 'POST', body, key),
    updateSource: (id: string, sourceId: string, version: number, body: Partial<Pick<LeadSource, 'name' | 'allowedOrigins' | 'whatsappPhone' | 'enabled'>>, key: string) => request<LeadSource>(`${campaign(id)}/lead-sources/${encodeURIComponent(sourceId)}`, 'PATCH', body, key, version),
    contacts: (id: string, filters: { limit?: number; cursor?: string; classification?: LeadClassification } = {}) => request<LeadContact[]>(`${campaign(id)}/leads${params(filters)}`),
    previewImport: (id: string, sourceId: string, rows: LeadRow[], key: string) => request<ImportPreview>(`${campaign(id)}/lead-imports/preview`, 'POST', { sourceId, rows }, key),
    importPreview: (id: string, previewId: string) => request<ImportReview>(`${campaign(id)}/lead-imports/${encodeURIComponent(previewId)}`),
    confirmImport: (id: string, previewId: string, decisions: ImportDecision[], key: string) => request<ImportReceipt>(`${campaign(id)}/lead-imports/${encodeURIComponent(previewId)}/confirm`, 'POST', { decisions }, key),
    captureReviews: (id: string) => request<CaptureReview[]>(`${campaign(id)}/lead-capture-reviews`),
    resolveCapture: (id: string, captureId: string, decision: Omit<ImportDecision, 'rowIndex'>, key: string) => request<{ status: string }>(`${campaign(id)}/lead-capture-reviews/${encodeURIComponent(captureId)}/resolve`, 'POST', decision, key),
    reports: (id: string) => request<ResultReport[]>(`${campaign(id)}/result-reports`),
    createReport: (id: string, body: ResultReportInput, key: string) => request<ResultReport>(`${campaign(id)}/result-reports`, 'POST', body, key),
    updateReport: (id: string, reportId: string, version: number, body: ResultReportInput, key: string) => request<ResultReport>(`${campaign(id)}/result-reports/${encodeURIComponent(reportId)}`, 'PATCH', body, key, version),
    reportRevisions: (id: string, reportId: string) => request<Array<{ version: number; snapshot: ResultReport; createdAt: string }>>(`${campaign(id)}/result-reports/${encodeURIComponent(reportId)}/revisions`),
    results: (filters: { campaignId?: string; from?: string; to?: string } = {}) => request<LeadResults>(`/results${params(filters)}`),
  };
}
export type LeadClient = ReturnType<typeof createLeadClient>;
export const leadClient = createLeadClient();
