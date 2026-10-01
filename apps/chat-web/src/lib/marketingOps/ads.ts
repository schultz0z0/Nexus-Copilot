import { MarketingOpsApiError } from './client';
import type { LeadSource, LeadResponse } from './leads';

export const adsProviders = { meta: 'Meta Ads', google: 'Google Ads', linkedin: 'LinkedIn Ads' } as const;
export type AdsProvider = keyof typeof adsProviders;
export type AdsStatus = 'unprepared' | 'prepared' | 'pending_account' | 'connected' | 'partial' | 'reconnect_required' | 'disconnected' | 'error';
export interface AdsAccount { id: string; name: string; currency: string; timeZone: string | null; manager?: boolean; loginCustomerId?: string }
export interface AdsConnection { provider: AdsProvider; status: AdsStatus; version: number; accounts: AdsAccount[]; selectedAccountId: string | null; capabilities: { metrics: boolean; nativeLeads: boolean }; lastSyncAt: string | null; safeError: string | null }
export interface AdsSetup { provider: AdsProvider; version: number; mode: 'empty' | 'managed' | 'external'; writable: boolean; ready: boolean; publicOrigin: string | null; redirectUri: string | null; clientId: string | null; apiVersion: string | null; scopes: string[]; metaLoginConfigId: string | null; googleLoginCustomerId: string | null; hasClientSecret: boolean }
export interface AdsSetupInput { clientId: string; clientSecret?: string; apiVersion: string; scopes: string[]; metaLoginConfigId?: string; googleLoginCustomerId?: string; confirmReplacement?: boolean; takeOverExternal?: boolean }
export type AdsDestination = 'native_form' | 'landing_page' | 'whatsapp';
export const adsDestinations: Record<AdsDestination, string> = { native_form: 'Formulário do provedor', landing_page: 'Landing page', whatsapp: 'WhatsApp' };
export interface AdsLinkInput { provider: AdsProvider; sourceId: string; externalCampaignId: string; destination: AdsDestination }
export interface AdsLink extends AdsLinkInput { id: string; campaignId: string; externalAccountId: string; enabled: boolean; version: number; lastSyncAt: string | null; safeError: string | null }
export interface AdsExternalCampaign { id: string; name: string; status: string }
export interface AdsDailyMetric { date: string; currency: string; timeZone: string; spend: number; impressions: number; clicks: number; conversions: number | null }
export interface AdsReceipt { id: string; status: 'completed' | 'needs_review'; days: number; reports: number; previewId: string | null; previewIds: string[]; warnings: string[]; completedAt: string }
export interface AdsResults { daily: AdsDailyMetric[]; receipts: AdsReceipt[] }
export interface AdsPeriod { from: string; to: string }
export const adsKeys = { setup: (provider: AdsProvider) => ['marketing-ads', 'setup', provider] as const, all: ['marketing-ads'] as const, connections: ['marketing-ads', 'connections'] as const, accounts: (provider: AdsProvider) => ['marketing-ads', 'accounts', provider] as const, campaigns: (provider: AdsProvider, account: string | null, version: number) => ['marketing-ads', 'campaigns', provider, account, version] as const, links: (campaignId: string) => ['marketing-ads', 'links', campaignId] as const, results: (campaignId: string, linkId: string) => ['marketing-ads', 'results', campaignId, linkId] as const };
export const adsMessages: Record<string, string> = {
  ads_permission_required: 'O provedor recusou o acesso. Confira se sua conta de anúncios está configurada e se o usuário autorizado tem acesso a ela.',
  ads_setup_confirmation_required: 'Confirme a troca do aplicativo após revisar os dados. Uma nova autorização será necessária; o histórico será preservado.',
  ads_setup_secret_required: 'Informe o segredo do aplicativo para esta configuração.',
  ads_setup_storage_unavailable: 'O armazenamento privado da instalação está indisponível. Peça ao responsável para verificar o servidor e tente novamente.',
  ads_setup_origin_required: 'O responsável pela instalação precisa preparar o endereço público de retorno. Depois, tente carregar a configuração novamente.',
  version_conflict: 'Os dados mudaram. A versão atual foi carregada; revise antes de confirmar novamente.',
  connection_changed: 'A conexão ou conta mudou. Atualize e revise seu vínculo.',
  account_required: 'Escolha uma conta nas integrações antes de continuar.',
  account_not_accessible: 'Esta conta não está disponível. Atualize a lista ou renove a autorização.',
  source_disabled: 'A fonte está desabilitada. Escolha uma fonte ativa.',
  source_attribution_conflict: 'A fonte precisa corresponder ao provedor, à conta e à campanha selecionados.',
  external_campaign_not_accessible: 'Esta campanha não está disponível na conta escolhida. Atualize a seleção.',
  ads_link_conflict: 'Este anúncio ou fonte já possui um vínculo ativo. Revise os vínculos existentes.',
  ads_link_disabled: 'O vínculo está desabilitado. Seu histórico continua disponível.',
  ads_unprepared: 'A instalação ainda precisa ser configurada pelo responsável.',
  integration_unprepared: 'A instalação ainda precisa ser configurada pelo responsável.',
  integration_not_connected: 'Conecte e escolha uma conta nas integrações antes de sincronizar.',
  integration_owner_inactive: 'O responsável pela autorização está inativo. Um administrador ou gestor precisa autorizar a conexão novamente.',
  ads_reconnect_required: 'Renove a autorização nas integrações para voltar a sincronizar.',
  ads_provider_unavailable: 'O provedor está indisponível. Tente novamente mais tarde.',
  ads_rate_limited: 'O provedor limitou as consultas. Aguarde e tente novamente.',
  ads_provider_error: 'O provedor não concluiu a consulta. Tente novamente.',
  ads_invalid_response: 'Não foi possível validar os dados do provedor. Tente novamente mais tarde.',
  ads_sync_running: 'Já existe uma sincronização em andamento. Atualize os resultados em alguns instantes.',
  sync_in_progress: 'Já existe uma sincronização em andamento. Atualize os resultados em alguns instantes.',
  idempotency_in_progress: 'Esta operação ainda está em andamento. Aguarde e tente novamente com a mesma proposta.',
  idempotency_conflict: 'Esta proposta já foi usada para outra operação. Revise os dados e prepare uma nova confirmação.',
  oauth_session_required: 'Sua sessão expirou. Entre novamente e inicie a conexão.',
  oauth_state_invalid: 'Esta autorização não é mais válida. Inicie uma nova conexão nas integrações.',
  oauth_denied: 'A autorização foi recusada ou cancelada. Confira o acesso no provedor e tente novamente.',
  forbidden: 'Você não tem permissão para esta operação. Solicite ajuda a um administrador ou gestor.',
  unauthorized: 'Sua sessão expirou. Entre novamente.',
  validation_error: 'Confira os campos. O período deve ter até 30 dias e não pode estar no futuro.',
  feature_disabled: 'Esta operação está desabilitada na instalação.',
};
export const adsWarnings: Record<string, string> = {
  native_leads_permission_required: 'A autorização não permite consultar contatos de formulários. Renove as permissões nas integrações.',
  metrics_permission_required: 'A autorização não permite consultar métricas. Renove as permissões nas integrações.',
  manual_report_overlap: 'Há um relatório manual neste período. Ele foi preservado; confira a cobertura antes de comparar valores.',
  foreign_currency_excluded: 'A moeda desta conta difere de BRL. O investimento foi excluído do total em reais; os valores originais estão na tabela.',
  missing_days_retired: 'O provedor revisou a medição. Dias retirados deixaram de compor os totais; o histórico foi preservado.',
  ads_form_version_unavailable: 'Não foi possível validar a versão do formulário. Os contatos desse formulário não foram preparados para importação.',
  ads_page_limit: 'O provedor retornou mais páginas que o limite desta consulta. A sincronização está incompleta.',
  ...adsMessages,
};
export function createAdsClient(options: { fetch?: typeof globalThis.fetch; baseUrl?: string } = {}) {
  const base = (options.baseUrl ?? '/api/marketing').replace(/\/$/, '');
  const request = async <T>(path: string, method = 'GET', body?: unknown, version?: number, key?: string): Promise<LeadResponse<T>> => {
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (version !== undefined) headers.set('If-Match', `"${version}"`);
    if (key) headers.set('Idempotency-Key', key);
    const response = await (options.fetch ?? globalThis.fetch)(base + path, { method, headers, credentials: 'same-origin', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new MarketingOpsApiError(payload.error?.code ?? 'request_failed', response.status, adsMessages[payload.error?.code] ?? 'Não foi possível concluir a operação. Tente novamente.', response.headers.get('x-correlation-id') ?? payload.error?.correlationId ?? null);
    return payload;
  };
  const providerPath = (provider: AdsProvider) => `/ads-integrations/${provider}`;
  const linksPath = (campaignId: string) => `/campaigns/${encodeURIComponent(campaignId)}/ads-links`;
  const linkPath = (campaignId: string, linkId: string) => `${linksPath(campaignId)}/${encodeURIComponent(linkId)}`;
  return {
    connections: () => request<AdsConnection[]>('/ads-integrations'),
    setup: (provider: AdsProvider) => request<AdsSetup>(`${providerPath(provider)}/setup`),
    saveSetup: (provider: AdsProvider, input: AdsSetupInput, version: number, key: string) => request<AdsSetup>(`${providerPath(provider)}/setup`, 'POST', input, version, key),
    authorize: (provider: AdsProvider) => request<{ authorizationUrl: string }>(`${providerPath(provider)}/authorize`, 'POST', {}),
    accounts: (provider: AdsProvider) => request<AdsAccount[]>(`${providerPath(provider)}/accounts`),
    selectAccount: (provider: AdsProvider, accountId: string, version: number) => request<AdsConnection>(`${providerPath(provider)}/account`, 'POST', { accountId }, version),
    disconnect: (provider: AdsProvider, version: number) => request<AdsConnection>(`${providerPath(provider)}/disconnect`, 'POST', {}, version),
    campaigns: (provider: AdsProvider) => request<AdsExternalCampaign[]>(`${providerPath(provider)}/campaigns`),
    links: (campaignId: string) => request<AdsLink[]>(linksPath(campaignId)),
    createLink: (campaignId: string, input: AdsLinkInput, key: string) => request<AdsLink>(linksPath(campaignId), 'POST', input, undefined, key),
    disableLink: (campaignId: string, linkId: string, version: number, key: string) => request<AdsLink>(`${linkPath(campaignId, linkId)}/disable`, 'POST', {}, version, key),
    sync: (campaignId: string, linkId: string, period: AdsPeriod, key: string) => request<AdsReceipt>(`${linkPath(campaignId, linkId)}/sync`, 'POST', period, undefined, key),
    results: (campaignId: string, linkId: string) => request<AdsResults>(`${linkPath(campaignId, linkId)}/results`),
  };
}
export type AdsClient = ReturnType<typeof createAdsClient>;
export const adsClient = createAdsClient();
export function safeAuthorizationUrl(provider: AdsProvider, value: string) {
  const url = new URL(value);
  const hosts: Record<AdsProvider, string> = { google: 'accounts.google.com', meta: 'www.facebook.com', linkedin: 'www.linkedin.com' };
  const pathValid = provider === 'google' ? url.pathname === '/o/oauth2/v2/auth' : provider === 'linkedin' ? url.pathname === '/oauth/v2/authorization' : /^\/v\d+\.\d+\/dialog\/oauth$/.test(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== hosts[provider] || url.port || url.username || url.password || url.hash || !pathValid) throw new Error('O endereço de autorização não é válido. Atualize a tela e tente novamente.');
  return url.href;
}
export function callbackMessage(provider: string | null, result: string | null): string | null {
  if (!provider || !Object.prototype.hasOwnProperty.call(adsProviders, provider) || !result) return null;
  const messages: Record<string, string> = { connected: 'Autorização recebida. Escolha sua conta.', cancelled: 'Autorização cancelada. Você pode tentar novamente.', invalid: 'Esta autorização não é mais válida. Inicie uma nova conexão.', permission_required: 'O provedor não concedeu as permissões necessárias. Revise o acesso e tente novamente.', unavailable: 'O provedor não concluiu a autorização. Tente novamente mais tarde.', session_required: 'Entre novamente e inicie a conexão para continuar.' };
  return Object.prototype.hasOwnProperty.call(messages, result) ? messages[result] : null;
}
export function defaultAdsPeriod(timeZone: string, now = Date.now()): AdsPeriod {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  const midnight = Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  return { from: new Date(midnight - 7 * 86400000).toISOString().slice(0, 10), to: new Date(midnight - 86400000).toISOString().slice(0, 10) };
}
export function validAdsPeriod(period: AdsPeriod, now = Date.now()) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return validDate(period.from) && validDate(period.to) && period.to >= period.from && (Date.parse(period.to) - Date.parse(period.from)) / 86400000 < 30 && Date.parse(period.to) <= now;
}
export function compatibleSources(sources: LeadSource[], provider: AdsProvider, accountId: string, externalCampaignId: string, destination: AdsDestination) {
  return sources.filter(source => source.enabled && source.classification === 'lead' && source.channel === `${provider}_ads` && (!source.externalAccountId || source.externalAccountId === accountId) && (!source.externalCampaignId || source.externalCampaignId === externalCampaignId) && (source.kind === 'manual' || (destination !== 'native_form' && source.kind === destination)));
}
