import { readFileSync } from 'node:fs';
import { adsProviders, type AdsConfig, type AdsProvider, type AdsProviderConfig } from './types.js';

export const scopeSets: Record<AdsProvider, string[]> = {
  google: ['https://www.googleapis.com/auth/adwords'],
  meta: ['ads_read', 'leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'business_management'],
  linkedin: ['r_ads', 'r_ads_reporting', 'r_marketing_leadgen_automation']
};
function secret(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (env[`${name}_FILE`]) {
    try {
      const value = readFileSync(env[`${name}_FILE`]!, 'utf8').trim();
      if (!value && name === 'ADS_TOKEN_ENCRYPTION_KEY') throw new Error('Missing key');
      return value || undefined;
    } catch {
      if (name === 'ADS_TOKEN_ENCRYPTION_KEY') throw new Error('Ads operational encryption key is unavailable');
      return undefined;
    }
  }
  return env[name]?.trim() || undefined;
}
export function loadAdsConfig(env: NodeJS.ProcessEnv, installationKey?: Buffer): AdsConfig {
  const result: AdsConfig = { providers: {}, syncIntervalMs: 15 * 60_000 };
  const origin = env.ADS_PUBLIC_ORIGIN?.trim() || (env.NODE_ENV === 'development' ? 'http://127.0.0.1:8088' : undefined);
  if (origin) {
    const url = new URL(origin);
    if ((url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('ADS_PUBLIC_ORIGIN must be an HTTPS origin or local loopback origin');
    result.publicOrigin = url.origin;
  }
  const encoded = secret(env, 'ADS_TOKEN_ENCRYPTION_KEY');
  if (encoded) {
    const bytes = /^[a-f0-9]{64}$/i.test(encoded) ? Buffer.from(encoded, 'hex') : Buffer.from(encoded, 'base64');
    if (bytes.length !== 32 || (!/^[a-f0-9]{64}$/i.test(encoded) && bytes.toString('base64') !== encoded)) throw new Error('ADS_TOKEN_ENCRYPTION_KEY must contain exactly 32 bytes as hex or canonical base64');
    result.encryptionKey = bytes;
  }
  if (installationKey) {
    if (installationKey.length !== 32 || (result.encryptionKey && !result.encryptionKey.equals(installationKey))) throw new Error('Ads installation encryption key does not match the operational key');
    result.encryptionKey = installationKey;
  }
  for (const provider of adsProviders) {
    const prefix = `ADS_${provider.toUpperCase()}`;
    const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = secret(env, `${prefix}_CLIENT_SECRET`);
    const apiVersion = env[`${prefix}_API_VERSION`]?.trim();
    if (!clientId || !clientSecret || !apiVersion || !result.publicOrigin || !result.encryptionKey) continue;
    if (!(provider === 'linkedin' ? /^20\d{4}$/ : provider === 'google' ? /^v\d{2}$/ : /^v\d{2}\.0$/).test(apiVersion)) throw new Error(`${prefix}_API_VERSION is invalid`);
    const scopes = env[`${prefix}_SCOPES`]?.split(/[\s,]+/).filter(Boolean) ?? (provider === 'meta' ? ['ads_read'] : provider === 'linkedin' ? ['r_ads', 'r_ads_reporting'] : scopeSets.google);
    if (!scopes.length || scopes.some(value => !scopeSets[provider].includes(value))) throw new Error(`${prefix}_SCOPES contains unsupported permissions`);
    const item: AdsProviderConfig = { clientId, clientSecret, apiVersion, scopes: [...new Set(scopes)], redirectUri: `${result.publicOrigin}/api/ads/oauth/${provider}/callback` };
    if (provider === 'meta') {
      const id = env.ADS_META_LOGIN_CONFIG_ID?.trim();
      if (!id || !/^\d+$/.test(id)) continue;
      item.loginConfigId = id;
    }
    if (provider === 'google' && env.ADS_GOOGLE_LOGIN_CUSTOMER_ID) {
      const id = env.ADS_GOOGLE_LOGIN_CUSTOMER_ID.replace(/-/g, '').trim();
      if (!/^\d{10}$/.test(id)) throw new Error('ADS_GOOGLE_LOGIN_CUSTOMER_ID is invalid');
      item.loginCustomerId = id;
    }
    result.providers[provider] = item;
  }
  return result;
}
