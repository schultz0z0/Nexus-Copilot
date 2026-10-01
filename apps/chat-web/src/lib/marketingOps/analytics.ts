import { MarketingOpsApiError } from './client';
import { defaultAdsPeriod, validAdsPeriod, safeAuthorizationUrl } from './ads';
import type { LeadResponse } from './leads';

export const analyticsProviders = { ga4: 'Google Analytics', clarity: 'Microsoft Clarity' } as const;
export type AnalyticsProvider = keyof typeof analyticsProviders;
export type AnalyticsStatus = 'unprepared' | 'prepared' | 'pending_resource' | 'connected' | 'partial' | 'reconnect_required' | 'disconnected' | 'error';
export interface AnalyticsResource { id: string; name: string; timeZone: string; currency?: string }
export interface AnalyticsConnection { provider: AnalyticsProvider; status: AnalyticsStatus; version: number; resources: AnalyticsResource[]; selectedResourceId: string | null; lastSyncAt: string | null; safeError: string | null }
export interface AnalyticsTotals { sessions: number; botSessions?: number | null; engagedSessions: number | null; pageViews: number | null; keyEvents: number | null; rageClicks: number | null; deadClicks: number | null; scrollDepth: number | null }
export interface AnalyticsResults { provider: AnalyticsProvider; resource: AnalyticsResource | null; from: string; to: string; lastSyncAt: string | null; totals: AnalyticsTotals | null; daily: { date: string; sessions: number; engagedSessions: number | null; pageViews: number | null; keyEvents: number | null }[]; channels: { source: string; medium: string; sessions: number }[]; campaigns: { utmCampaign: string; sessions: number }[]; warnings: string[]; window: null | { from: string; to: string }; stale: boolean }
export interface AnalyticsLink { id: string; campaignId: string; provider: AnalyticsProvider; resourceId: string; utmCampaign: string; enabled: boolean; version: number }
export interface AnalyticsPeriod { from: string; to: string }
export interface ClarityInput { token: string; projectId: string; projectName: string; confirmReplacement?: boolean }
export interface AnalyticsReceipt { id: string; status: 'completed' | 'partial'; completedAt: string; warnings: string[] }
export const analyticsKeys = {
  all: ['web-analytics'] as const, connections: ['web-analytics', 'connections'] as const,
  resources: ['web-analytics', 'ga4', 'resources'] as const,
  results: (provider: AnalyticsProvider, period: AnalyticsPeriod) => ['web-analytics', 'results', provider, period] as const,
  links: (id: string) => ['web-analytics', 'links', id] as const,
  campaign: (id: string, period: AnalyticsPeriod) => ['web-analytics', 'campaign', id, period] as const,
};
export const analyticsMessages: Record<string, string> = {
  integration_unprepared: 'Um administrador precisa preparar o aplicativo Google nas configurações avançadas.',
  analytics_storage_unavailable: 'O armazenamento privado da instalação está indisponível. Peça ao responsável para verificar o servidor.',
  analytics_sync_in_progress: 'Uma atualização já está em andamento. Aguarde e atualize os resultados.',
  analytics_segment_already_linked: 'Este parâmetro de campanha já está vinculado a outra campanha. Revise os vínculos existentes.',
  analytics_connection_changed: 'A conexão mudou. Atualize e revise antes de confirmar.',
  analytics_resource_unavailable: 'Esse recurso não está acessível. Atualize a lista ou renove a autorização.',
  analytics_invalid_period: 'Escolha até 30 dias completos no fuso da propriedade. O dia atual ainda está em coleta.',
  analytics_page_limit: 'O provedor retornou dados além do limite seguro de leitura. Reduza o período e tente novamente.',
  oauth_state_invalid: 'Esta autorização não é mais válida. Inicie uma nova conexão nas integrações.',
  oauth_session_required: 'Sua sessão expirou. Entre novamente e inicie a conexão.',
  analytics_unprepared: 'Um administrador precisa preparar o aplicativo Google nas configurações avançadas.',
  analytics_permission_required: 'Seu usuário não tem acesso a esse recurso. Confira as permissões no provedor ou renove a autorização.',
  analytics_api_disabled: 'Habilite Google Analytics Admin API e Google Analytics Data API no projeto Google da empresa e tente novamente.',
  analytics_reconnect_required: 'A autorização expirou ou foi revogada. Conecte novamente para retomar a leitura.',
  analytics_resource_required: 'Escolha uma propriedade nas integrações antes de atualizar os resultados.',
  analytics_resource_not_accessible: 'Essa propriedade não está acessível. Atualize a lista ou renove a autorização.',
  analytics_not_connected: 'Conecte o provedor nas integrações para continuar.',
  analytics_rate_limited: 'O limite de consultas foi atingido. Aguarde a próxima janela de atualização.',
  analytics_quota_exhausted: 'O Clarity permite dez consultas por projeto por dia. Aguarde a renovação do limite.',
  analytics_sync_running: 'Uma atualização já está em andamento. Aguarde e atualize os resultados.',
  analytics_provider_unavailable: 'O provedor não respondeu. Tente novamente; os dados anteriores foram preservados.',
  analytics_invalid_response: 'Não foi possível validar a resposta do provedor. Os dados anteriores foram preservados.',
  analytics_confirmation_required: 'Confirme a troca após revisar os dados. O histórico será preservado.',
  analytics_link_conflict: 'Este parâmetro de campanha já está vinculado. Revise os vínculos existentes.',
  analytics_owner_inactive: 'O responsável pela conexão está inativo. Um gestor ou administrador deve autorizar novamente.',
  version_conflict: 'Os dados mudaram. A versão atual foi carregada; revise e confirme novamente.',
  connection_changed: 'A conexão mudou. Atualize e revise antes de confirmar.',
  forbidden: 'Seu usuário não pode realizar esta ação. Solicite ajuda ao administrador.',
  unauthorized: 'Sua sessão expirou. Entre novamente.',
  validation_error: 'Confira os campos e o período: use até 30 dias completos, sem datas futuras.',
  idempotency_conflict: 'A proposta mudou. Revise e prepare uma nova confirmação.',
  feature_disabled: 'Esta operação está desabilitada na instalação.',
};
export const analyticsWarnings: Record<string, string> = {
  analytics_thresholded: 'O Google aplicou limites de privacidade aos dados deste período.',
  analytics_sampled: 'O Google retornou dados amostrados.',
  analytics_other_row: 'Parte dos dados foi agrupada como outros pelo Google.',
  analytics_clarity_row_limit: 'O Clarity retorna até 1.000 linhas sem paginação; a distribuição pode estar incompleta.',
  analytics_clarity_rolling_window: 'O Clarity mostra uma janela móvel de 24 horas. Janelas sobrepostas não são somadas.',
  analytics_clarity_project_label_unverified: 'O ID e o nome do projeto Clarity foram informados pelo administrador. A API confirma a leitura do token, sem validar esses rótulos.',
  analytics_clarity_friction_unavailable: 'Esta leitura não informa contagens de cliques de frustração, cliques sem resposta ou rolagem com unidades validadas. Consulte os sinais de experiência no Clarity.',
  analytics_incomplete_coverage: 'Não há medição completa para todos os dias do período. Compare os indicadores com cautela.',
  analytics_segment_not_measured: 'Este parâmetro UTM não foi observado. Ausência do segmento não representa zero.',
  analytics_clarity_period_not_supported: 'O filtro de datas não recorta o Clarity: os valores correspondem à última janela móvel medida.',
  data_thresholding: 'O Google aplicou limites de privacidade aos dados deste período.',
  sampled_data: 'O Google retornou dados amostrados.',
  data_loss_from_other_row: 'Parte dos dados foi agrupada como outros pelo Google.',
  row_limit: 'O limite de linhas do provedor foi alcançado. A distribuição pode estar incompleta.',
  clarity_row_limit: 'O Clarity retorna até 1.000 linhas sem paginação; a distribuição pode estar incompleta.',
  clarity_friction_unavailable: 'O provedor não informou contagens de cliques válidas nesta leitura.',
  metric_unavailable: 'Alguns indicadores não foram informados pelo provedor.',
  rolling_window: 'O Clarity mostra uma janela móvel de 24 horas. Janelas sobrepostas não são somadas.',
  stale_data: 'Os dados estão desatualizados. Faça uma nova leitura quando a conexão estiver disponível.',
  resource_changed: 'O recurso selecionado mudou. Revise os vínculos das campanhas.',
};
export function createAnalyticsClient(options: { fetch?: typeof globalThis.fetch; baseUrl?: string } = {}) {
  const base = (options.baseUrl ?? '/api/marketing').replace(/\/$/, '');
  const request = async <T>(path: string, method = 'GET', body?: unknown, version?: number, key?: string): Promise<LeadResponse<T>> => {
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (version !== undefined) headers.set('If-Match', `"${version}"`);
    if (key) headers.set('Idempotency-Key', key);
    const response = await (options.fetch ?? globalThis.fetch)(base + path, { method, headers, credentials: 'same-origin', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new MarketingOpsApiError(payload.error?.code ?? 'request_failed', response.status, analyticsMessages[payload.error?.code] ?? 'Não foi possível concluir a operação. Tente novamente.', response.headers.get('x-correlation-id') ?? payload.error?.correlationId ?? null);
    return payload;
  };
  const route = (provider: AnalyticsProvider) => `/web-analytics/${provider}`;
  const links = (id: string) => `/campaigns/${encodeURIComponent(id)}/web-analytics-links`;
  const query = (period: AnalyticsPeriod) => new URLSearchParams({ from: period.from, to: period.to }).toString();
  return {
    connections: () => request<AnalyticsConnection[]>('/web-analytics/connections'),
    authorize: () => request<{ authorizationUrl: string }>('/web-analytics/ga4/authorize', 'POST', {}),
    resources: () => request<AnalyticsResource[]>('/web-analytics/ga4/resources'),
    selectResource: (resourceId: string, version: number, confirmReplacement = false) => request<AnalyticsConnection>('/web-analytics/ga4/resource', 'POST', { resourceId, ...(confirmReplacement ? { confirmReplacement: true } : {}) }, version),
    connectClarity: (input: ClarityInput, version: number, key: string) => request<AnalyticsConnection>('/web-analytics/clarity/connect', 'POST', input, version, key),
    disconnect: (provider: AnalyticsProvider, version: number) => request<AnalyticsConnection>(`${route(provider)}/disconnect`, 'POST', {}, version),
    sync: (provider: AnalyticsProvider, period: AnalyticsPeriod, key: string) => request<AnalyticsReceipt>(`${route(provider)}/sync`, 'POST', provider === 'ga4' ? period : {}, undefined, key),
    results: (provider: AnalyticsProvider, period: AnalyticsPeriod) => request<AnalyticsResults>(`${route(provider)}/results?${query(period)}`),
    links: (campaignId: string) => request<AnalyticsLink[]>(links(campaignId)),
    createLink: (campaignId: string, input: { provider: AnalyticsProvider; utmCampaign: string }, key: string) => request<AnalyticsLink>(links(campaignId), 'POST', input, undefined, key),
    disableLink: (campaignId: string, link: AnalyticsLink) => request<AnalyticsLink>(`${links(campaignId)}/${encodeURIComponent(link.id)}/disable`, 'POST', {}, link.version),
    campaignResults: (campaignId: string, period: AnalyticsPeriod) => request<{ ga4: AnalyticsResults | null; clarity: AnalyticsResults | null }>(`/campaigns/${encodeURIComponent(campaignId)}/web-analytics-results?${query(period)}`),
  };
}
export type AnalyticsClient = ReturnType<typeof createAnalyticsClient>;
export const analyticsClient = createAnalyticsClient();
export const safeGoogleAnalyticsUrl = (value: string) => safeAuthorizationUrl('google', value);
export const defaultAnalyticsPeriod = (timeZone = 'UTC', now = Date.now()) => defaultAdsPeriod(timeZone, now);
export function validAnalyticsPeriod(period: AnalyticsPeriod, timeZone = 'UTC', now = Date.now()) {
  return validAdsPeriod(period, now) && period.to <= defaultAdsPeriod(timeZone, now).to;
}
export function analyticsCallbackMessage(provider: string | null, result: string | null): string | null {
  if (provider !== 'ga4' || !result) return null;
  const messages: Record<string, string> = { connected: 'Autorização recebida. Escolha sua propriedade GA4.', cancelled: 'Autorização cancelada. Você pode conectar novamente.', invalid: 'Esta autorização não é mais válida. Inicie uma nova conexão.', permission_required: 'Confira seu acesso ao Analytics e se as APIs Admin e Data estão habilitadas no projeto Google.', unavailable: 'O Google não concluiu a autorização. Tente novamente.', session_required: 'Entre novamente e inicie a conexão.' };
  return Object.prototype.hasOwnProperty.call(messages, result) ? messages[result] : null;
}
