import { createHash, createHmac } from 'node:crypto';
import { appError } from '../../errors.js';
import { createLogger, type Logger } from '../../observability/logger.js';
import type { AdsAccount, AdsDailyMetric, AdsExternalCampaign, AdsLead, AdsProvider, AdsProviderClient, AdsProviderConfig, AdsTokens } from './types.js';

type ObjectValue = Record<string, unknown>;
type Http = (url: string | URL, init?: RequestInit) => Promise<Response>;
const invalid = () => appError('ads_invalid_response', 502, 'O provedor retornou dados incompatíveis.');
function object(value: unknown): ObjectValue { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(); return value as ObjectValue; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw invalid(); return value; }
function string(value: unknown): string { if (typeof value !== 'string' || !value.length) throw invalid(); return value; }
function identifier(value: unknown): string { const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : string(value); if (!/^\d{1,30}$/.test(id)) throw invalid(); return id; }
function number(value: unknown, integer = false): number { if (value === '' || value == null) throw invalid(); const n = Number(value); if (!Number.isFinite(n) || n < 0 || (integer && !Number.isSafeInteger(n))) throw invalid(); return n; }
function money(value: unknown): number { return Math.round((number(value) + Number.EPSILON) * 100) / 100; }
function currency(value: unknown): string { const result = string(value); if (!/^[A-Z]{3}$/.test(result)) throw invalid(); return result; }
function date(value: unknown): string { const result = string(value); const stamp = new Date(`${result}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0, 10) !== result) throw invalid(); return result; }
function zone(value: unknown): string { const result = string(value); try { new Intl.DateTimeFormat('en', { timeZone: result }).format(); } catch { throw invalid(); } return result; }
function googleId(value: unknown): string { return identifier(string(value).split('/').at(-1)); }
function linkedinDate(value: unknown): string { const item = object(value); return date(`${identifier(item.year)}-${identifier(item.month).padStart(2, '0')}-${identifier(item.day).padStart(2, '0')}`); }
function restDate(value: string): string { const [year, month, day] = date(value).split('-').map(Number); return `(year:${year},month:${month},day:${day})`; }
function timeWindow(from: string, to: string) { date(from); date(to); if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 30) throw appError('ads_period_invalid', 422, 'Selecione até 31 dias para a sincronização.'); }

const googleAccessReasons = new Set(['NOT_ADS_USER','USER_PERMISSION_DENIED','INCOMPLETE_SIGNUP','CUSTOMER_NOT_ENABLED','CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION','CLOUD_PROJECT_NOT_UNDER_ORGANIZATION','PROJECT_DISABLED','SERVICE_ACCESS_DENIED','AUTHORIZATION_ERROR','ACTION_NOT_PERMITTED','MISSING_TOS','ORGANIZATION_NOT_APPROVED','ORGANIZATION_NOT_RECOGNIZED','TWO_STEP_VERIFICATION_NOT_ENROLLED','INVALID_LOGIN_CUSTOMER_ID_SERVING_CUSTOMER_ID_COMBINATION','SERVICE_DISABLED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','CONSUMER_INVALID']);
function googleAccessReason(failure: unknown): string {
  const body = failure && typeof failure === 'object' ? failure as ObjectValue : {};
  const error = body.error && typeof body.error === 'object' ? body.error as ObjectValue : {};
  for (const entry of Array.isArray(error.details) ? error.details : []) {
    if (!entry || typeof entry !== 'object') continue;
    const detail = entry as ObjectValue;
    if (typeof detail.reason === 'string' && googleAccessReasons.has(detail.reason)) return detail.reason;
    for (const item of Array.isArray(detail.errors) ? detail.errors : []) {
      if (!item || typeof item !== 'object') continue;
      const value = (item as ObjectValue).errorCode;
      const code = value && typeof value === 'object' ? value as ObjectValue : {};
      for (const reason of [code.authorizationError, code.authenticationError]) {
        if (typeof reason === 'string' && googleAccessReasons.has(reason)) return reason;
      }
    }
  }
  return 'UNCLASSIFIED';
}
export function createAdsProviderClient(provider: AdsProvider, config: AdsProviderConfig, http: Http = fetch, logger: Pick<Logger, 'warn'> = createLogger()): AdsProviderClient {
  const apiOrigin = provider === 'meta' ? 'https://graph.facebook.com' : provider === 'google' ? 'https://googleads.googleapis.com' : 'https://api.linkedin.com';
  const base = provider === 'linkedin' ? `${apiOrigin}/rest/` : `${apiOrigin}/${config.apiVersion}/`;
  async function request(url: string | URL, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    const target = new URL(url);
    const bearer = new Headers(init.headers).get('authorization');
    if (provider === 'meta' && target.origin === apiOrigin && bearer?.startsWith('Bearer ')) {
      target.searchParams.set('appsecret_proof', createHmac('sha256', config.clientSecret).update(bearer.slice(7)).digest('hex'));
    }
    try { response = await http(typeof url === 'string' && target.href === url ? url : target, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { throw appError('ads_provider_unavailable', 503, 'O provedor está indisponível. Tente novamente.'); }
    if (!response.ok) {
      // Never include provider bodies, URLs or tokens in product errors/logs.
      let failure: unknown;
      if (response.status === 400 || (provider === 'google' && response.status === 403)) {
        try { const text = await response.text(); if (Buffer.byteLength(text) <= 8192) failure = JSON.parse(text); } catch { /* Only trusted error codes are read. */ }
      }
      if (provider === 'google' && response.status === 403) {
        const operation = target.origin === apiOrigin && target.pathname.endsWith('/customers:listAccessibleCustomers') ? 'account_discovery' : target.origin === apiOrigin && target.pathname.endsWith('/googleAds:searchStream') ? 'search' : 'oauth';
        logger.warn('Ads provider request failed', { provider, operation, httpStatus: response.status, accessCode: googleAccessReason(failure) });
      }
      if (response.status === 400) {
        const body = failure && typeof failure === 'object' ? failure as ObjectValue : {};
        const detail = body.error && typeof body.error === 'object' ? body.error as ObjectValue : {};
        if (body.error === 'invalid_grant' || detail.code === 190) throw appError('ads_reconnect_required', 401, 'A autorização do provedor precisa ser renovada.');
      }
      if (response.status === 401) throw appError('ads_reconnect_required', 401, 'A autorização do provedor precisa ser renovada.');
      if (response.status === 403) throw appError('ads_permission_required', 403, 'O provedor não concedeu acesso a este recurso.');
      if (response.status === 429) throw appError('ads_rate_limited', 429, 'O limite do provedor foi atingido. Tente mais tarde.');
      throw appError('ads_provider_error', 502, 'Não foi possível concluir a leitura no provedor.');
    }
    try {
      if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw invalid();
      const body = await response.text();
      if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw invalid();
      return JSON.parse(body);
    } catch { throw invalid(); }
  }
  function headers(tokens: AdsTokens, account?: AdsAccount): Record<string, string> {
    return { Authorization: `Bearer ${tokens.accessToken}`, ...(provider === 'linkedin' ? { 'LinkedIn-Version': config.apiVersion, 'X-Restli-Protocol-Version': '2.0.0' } : {}), ...(provider === 'google' && (account?.loginCustomerId || config.loginCustomerId) ? { 'login-customer-id': account?.loginCustomerId || config.loginCustomerId! } : {}) };
  }
  // A custom REST verb in the first segment (customers:listAccessibleCustomers)
  // must remain relative; otherwise URL interprets customers: as a scheme.
  function api(path: string, params: Record<string, string> = {}): URL { const url = new URL(`./${path}`, base); for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value); return url; }
  async function pages(path: string, params: Record<string, string>, tokens: AdsTokens, mode: 'cursor' | 'offset' = 'cursor'): Promise<ObjectValue[]> {
    let url: URL | null = api(path, params); const collected: ObjectValue[] = []; const visited = new Set<string>();
    for (let page = 0; url && page < 50; page++) {
      if (visited.has(url.href)) throw invalid(); visited.add(url.href);
      const body = object(await request(url, { headers: headers(tokens) }));
      const items = array(body[provider === 'meta' ? 'data' : 'elements']).map(object); collected.push(...items);
      if (collected.length > 5000) throw appError('ads_page_limit', 422, 'Há mais registros que o limite desta consulta. Reduza o período.');
      if (provider === 'meta') {
        const paging = body.paging ? object(body.paging) : {};
        if (!paging.next) { url = null; continue; }
        const next = new URL(string(paging.next));
        if (next.origin !== apiOrigin || next.username || next.password || !next.pathname.startsWith(`/${config.apiVersion}/`)) throw invalid();
        next.searchParams.delete('access_token'); next.searchParams.delete('appsecret_proof'); url = next;
      } else if (mode === 'cursor') {
        const token = body.metadata ? object(body.metadata).nextPageToken : undefined;
        url = token ? api(path, { ...params, pageToken: string(token) }) : null;
      } else {
        const paging = body.paging ? object(body.paging) : {};
        const links = Array.isArray(paging.links) ? paging.links.map(object) : [];
        const total = typeof paging.total === 'number' && Number.isSafeInteger(paging.total) ? paging.total : null;
        const hasNext = links.some(link => link.rel === 'next') || (total !== null && collected.length < total);
        if (hasNext && items.length === 0) throw invalid();
        url = hasNext ? api(path, { ...params, start: String(collected.length) }) : null;
      }
    }
    if (url) throw appError('ads_page_limit', 422, 'O limite de páginas foi atingido. Reduza a consulta.');
    return collected;
  }
  async function gaql(tokens: AdsTokens, account: AdsAccount, query: string): Promise<ObjectValue[]> {
    const body = array(await request(api(`customers/${identifier(account.id)}/googleAds:searchStream`), { method: 'POST', headers: { ...headers(tokens, account), 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }));
    const rows = body.flatMap(chunk => { const item = object(chunk); return item.results === undefined ? [] : array(item.results).map(object); });
    if (rows.length > 5000) throw appError('ads_page_limit', 422, 'Reduza a consulta para até 5.000 registros.');
    return rows;
  }
  function tokenResult(payload: unknown, previous?: AdsTokens): AdsTokens {
    const body = object(payload); const scopes = typeof body.scope === 'string' ? body.scope.split(/[\s,]+/).filter(Boolean) : previous?.scopes ?? config.scopes;
    return { accessToken: string(body.access_token), scopes, ...(body.refresh_token ? { refreshToken: string(body.refresh_token) } : previous?.refreshToken ? { refreshToken: previous.refreshToken } : {}), ...(body.expires_in ? { expiresAt: new Date(Date.now() + number(body.expires_in) * 1000).toISOString() } : {}), ...(body.refresh_token_expires_in ? { refreshExpiresAt: new Date(Date.now() + number(body.refresh_token_expires_in) * 1000).toISOString() } : previous?.refreshExpiresAt ? { refreshExpiresAt: previous.refreshExpiresAt } : {}) };
  }
  async function tokenPost(params: Record<string, string>, previous?: AdsTokens) {
    const url = provider === 'google' ? 'https://oauth2.googleapis.com/token' : provider === 'linkedin' ? 'https://www.linkedin.com/oauth/v2/accessToken' : api('oauth/access_token').href;
    return tokenResult(await request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret }) }), previous);
  }
  const client: AdsProviderClient = {
    authorizationUrl(state, verifier) {
      const url = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : provider === 'linkedin' ? 'https://www.linkedin.com/oauth/v2/authorization' : `https://www.facebook.com/${config.apiVersion}/dialog/oauth`);
      for (const [key, value] of Object.entries({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', state })) url.searchParams.set(key, value);
      if (provider === 'meta' && config.loginConfigId) url.searchParams.set('config_id', config.loginConfigId);
      else url.searchParams.set('scope', config.scopes.join(' '));
      if (provider === 'google') { url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent'); url.searchParams.set('code_challenge_method', 'S256'); url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url')); }
      return url.href;
    },
    async exchange(code, verifier) {
      let tokens = await tokenPost({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, ...(provider === 'google' ? { code_verifier: verifier } : {}) });
      if (provider === 'meta') {
        if (tokens.expiresAt && Date.parse(tokens.expiresAt) - Date.now() < 2 * 86400000) tokens = await tokenPost({ grant_type: 'fb_exchange_token', fb_exchange_token: tokens.accessToken }, tokens);
        const permissions = object(await request(api('me/permissions'), { headers: headers(tokens) }));
        tokens.scopes = array(permissions.data).map(object).filter(row => row.status === 'granted').map(row => string(row.permission));
      }
      return tokens;
    },
    async refresh(tokens) {
      if (!tokens.refreshToken || (tokens.refreshExpiresAt && Date.parse(tokens.refreshExpiresAt) <= Date.now())) throw appError('ads_reconnect_required', 401, 'A autorização do provedor precisa ser renovada.');
      return tokenPost({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, tokens);
    },
    async accounts(tokens) {
      if (provider === 'meta') return (await pages('me/adaccounts', { fields: 'id,account_id,name,currency,timezone_name', limit: '100' }, tokens)).map(row => ({ id: identifier(row.account_id ?? string(row.id).replace(/^act_/, '')), name: string(row.name), currency: currency(row.currency), timeZone: zone(row.timezone_name) }));
      if (provider === 'linkedin') return (await pages('adAccounts', { q: 'search', 'search.status.values[0]': 'ACTIVE', pageSize: '100' }, tokens)).map(row => ({ id: identifier(row.id), name: string(row.name), currency: currency(row.currency), timeZone: 'UTC' }));
      const body = object(await request(api('customers:listAccessibleCustomers'), { headers: headers(tokens) }));
      const ids = array(body.resourceNames).map(googleId); if (ids.length > 200) throw appError('ads_page_limit', 422, 'A conta possui clientes demais para esta consulta.');
      const accounts = new Map<string, AdsAccount>();
      for (const id of ids) {
        const root = { id, name: id, currency: 'BRL', timeZone: null };
        const rows = await gaql(tokens, root, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1');
        const row = object(rows[0]?.customer); const account: AdsAccount = { id, name: typeof row.descriptiveName === 'string' && row.descriptiveName ? row.descriptiveName : id, currency: currency(row.currencyCode), timeZone: zone(row.timeZone), manager: row.manager === true };
        accounts.set(id, account);
        if (account.manager) {
          const children = await gaql(tokens, { ...account, loginCustomerId: id }, 'SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client WHERE customer_client.manager = FALSE');
          for (const child of children) { const value = object(child.customerClient); const childId = googleId(value.clientCustomer); accounts.set(childId, { id: childId, name: typeof value.descriptiveName === 'string' && value.descriptiveName ? value.descriptiveName : childId, currency: currency(value.currencyCode), timeZone: zone(value.timeZone), manager: false, loginCustomerId: id }); }
        }
      }
      return [...accounts.values()];
    },
    async campaigns(tokens, account) {
      const id = identifier(account.id);
      if (provider === 'meta') return (await pages(`act_${id}/campaigns`, { fields: 'id,name,status', limit: '100' }, tokens)).map(row => ({ id: identifier(row.id), name: string(row.name), status: string(row.status) }));
      if (provider === 'linkedin') return (await pages(`adAccounts/${id}/adCampaigns`, { q: 'search', pageSize: '100' }, tokens)).map(row => ({ id: identifier(row.id), name: string(row.name), status: string(row.status) }));
      return (await gaql(tokens, account, 'SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != REMOVED')).map(row => { const campaign = object(row.campaign); return { id: identifier(campaign.id), name: string(campaign.name), status: string(campaign.status) }; });
    },
    async dailyMetrics(tokens, account, campaignId, from, to) {
      timeWindow(from, to); identifier(campaignId); identifier(account.id);
      if (provider === 'google') return (await gaql(tokens, account, `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${from}' AND '${to}'`)).map(row => { const metrics = object(row.metrics); return { date: date(object(row.segments).date), currency: account.currency, timeZone: zone(account.timeZone), spend: money(number(metrics.costMicros) / 1_000_000), impressions: number(metrics.impressions, true), clicks: number(metrics.clicks, true), conversions: metrics.conversions == null ? null : number(metrics.conversions) }; });
      if (provider === 'meta') return (await pages(`${campaignId}/insights`, { fields: 'date_start,spend,impressions,clicks,account_currency', time_increment: '1', time_range: JSON.stringify({ since: from, until: to }), limit: '100' }, tokens)).map(row => ({ date: date(row.date_start), currency: currency(row.account_currency ?? account.currency), timeZone: zone(account.timeZone), spend: money(row.spend), impressions: number(row.impressions, true), clicks: number(row.clicks, true), conversions: null }));
      const params = { q: 'analytics', pivot: 'CAMPAIGN', timeGranularity: 'DAILY', dateRange: `(start:${restDate(from)},end:${restDate(to)})`, campaigns: `List(urn:li:sponsoredCampaign:${campaignId})`, accounts: `List(urn:li:sponsoredAccount:${account.id})`, fields: 'dateRange,costInLocalCurrency,impressions,clicks,externalWebsiteConversions', count: '100', start: '0' };
      return (await pages('adAnalytics', params, tokens, 'offset')).map(row => ({ date: linkedinDate(object(row.dateRange).start), currency: account.currency, timeZone: 'UTC', spend: money(row.costInLocalCurrency), impressions: number(row.impressions, true), clicks: number(row.clicks, true), conversions: row.externalWebsiteConversions == null ? null : number(row.externalWebsiteConversions) }));
    },
    async leads(tokens, account, campaignId, from, to) {
      timeWindow(from, to); identifier(campaignId); identifier(account.id);
      const output: AdsLead[] = [];
      const lead = (externalId: unknown, fields: Record<string, string>, occurredAt: string) => {
        const name = fields.FULL_NAME || [fields.FIRST_NAME, fields.LAST_NAME].filter(Boolean).join(' ') || fields.EMAIL || 'Contato captado';
        if (!fields.EMAIL && !fields.PHONE_NUMBER) return;
        const stamp = new Date(occurredAt); if (!Number.isFinite(stamp.getTime())) throw invalid();
        output.push({ externalId: string(externalId), externalCampaignId: campaignId, name, occurredAt: stamp.toISOString(), ...(fields.EMAIL ? { email: fields.EMAIL } : {}), ...(fields.PHONE_NUMBER ? { phone: fields.PHONE_NUMBER } : {}), ...(fields.COMPANY_NAME ? { company: fields.COMPANY_NAME } : {}) });
      };
      if (provider === 'google') {
        const rows = await gaql(tokens, account, `SELECT lead_form_submission_data.id, lead_form_submission_data.campaign, lead_form_submission_data.submission_date_time, lead_form_submission_data.lead_form_submission_fields FROM lead_form_submission_data WHERE campaign.id = ${campaignId} AND lead_form_submission_data.submission_date_time >= '${from} 00:00:00' AND lead_form_submission_data.submission_date_time <= '${to} 23:59:59'`);
        for (const row of rows) { const item = object(row.leadFormSubmissionData); if (googleId(item.campaign) !== campaignId) throw invalid(); const fields = Object.fromEntries(array(item.leadFormSubmissionFields).map(object).map(field => [string(field.fieldType), string(field.fieldValue)])); lead(item.id, fields, string(item.submissionDateTime).replace(' ', 'T')); }
      } else if (provider === 'meta') {
        if (!tokens.scopes.includes('leads_retrieval')) throw appError('ads_permission_required', 403, 'A leitura de formulários da Meta não foi autorizada.');
        const ads = await pages(`${campaignId}/ads`, { fields: 'id', limit: '100' }, tokens);
        for (const ad of ads) {
          const rows = await pages(`${identifier(ad.id)}/leads`, { fields: 'id,created_time,field_data,campaign_id', filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 86400 }]), limit: '100' }, tokens);
          for (const row of rows) { if (row.campaign_id && identifier(row.campaign_id) !== campaignId) throw invalid(); const occurredAt = string(row.created_time); const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone(account.timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(occurredAt)); if (localDate < from || localDate > to) continue; const names: Record<string, string> = { full_name: 'FULL_NAME', first_name: 'FIRST_NAME', last_name: 'LAST_NAME', email: 'EMAIL', phone_number: 'PHONE_NUMBER', company_name: 'COMPANY_NAME' }; const fields = Object.fromEntries(array(row.field_data).map(object).filter(field => names[String(field.name)]).map(field => [names[String(field.name)]!, string(array(field.values)[0])])); lead(row.id, fields, occurredAt); }
        }
      } else {
        if (!tokens.scopes.includes('r_marketing_leadgen_automation')) throw appError('ads_permission_required', 403, 'O aplicativo precisa de acesso ao produto LinkedIn Lead Sync.');
        // Cover the whole final UTC day, including fractional seconds. The
        // response date check below excludes the next midnight if returned.
        const rows = await pages('leadFormResponses', { q: 'owner', owner: `(sponsoredAccount:urn:li:sponsoredAccount:${account.id})`, leadType: '(leadType:SPONSORED)', limitedToTestLeads: 'false', submittedAt: `(start:${Date.parse(`${from}T00:00:00Z`)},end:${Date.parse(`${to}T00:00:00Z`)+86400000})`, count: '100', start: '0' }, tokens, 'offset');
        const formCache = new Map<string, ObjectValue>();
        for (const row of rows) {
          const metadata = object(object(row.leadMetadata).sponsoredLeadMetadata); if (String(metadata.campaign) !== `urn:li:sponsoredCampaign:${campaignId}`) continue;
          const owner = object(row.owner); if (owner.sponsoredAccount !== `urn:li:sponsoredAccount:${account.id}` || row.testLead === true) continue;
          const occurredAt = new Date(number(row.submittedAt, true)).toISOString(); if (occurredAt.slice(0, 10) < from || occurredAt.slice(0, 10) > to) continue;
          const formUrn = string(row.versionedLeadGenFormUrn); const match = formUrn.match(/^urn:li:versionedLeadGenForm:\(urn:li:leadGenForm:(\d+),(\d+)\)$/); if (!match) throw invalid();
          let form = formCache.get(formUrn); if (!form) { form = object(await request(api(`leadForms/${match[1]}`), { headers: headers(tokens) })); if (String(form.versionId) !== match[2]) throw appError('ads_form_version_unavailable', 422, 'O formulário foi alterado. Revise a versão antes de importar respostas.'); formCache.set(formUrn, form); }
          const questions: ObjectValue[] = array(object(form.content).questions).map(object).map(question => ({ ...question, questionId: identifier(question.questionId) })); const fields: Record<string, string> = {};
          for (const item of array(object(row.formResponse).answers).map(object)) { const questionId = identifier(item.questionId); const question = questions.find(q => q.questionId === questionId); if (!question?.predefinedField) continue; const detail = object(item.answerDetails); if (!detail.textQuestionAnswer) continue; fields[string(question.predefinedField)] = string(object(detail.textQuestionAnswer).answer); }
          lead(row.id, fields, occurredAt);
        }
      }
      if (output.length > 5000) throw appError('ads_page_limit', 422, 'Reduza o período da importação de leads.');
      return output;
    }
  };
  return client;
}
