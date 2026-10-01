export const adsProviders = ['meta', 'google', 'linkedin'] as const;
export type AdsProvider = typeof adsProviders[number];
export interface AdsProviderConfig {
  clientId: string; clientSecret: string; redirectUri: string; apiVersion: string;
  scopes: string[]; loginConfigId?: string; loginCustomerId?: string;
}
export interface AdsConfig {
  encryptionKey?: Buffer; publicOrigin?: string;
  providers: Partial<Record<AdsProvider, AdsProviderConfig>>;
  syncIntervalMs: number;
}
export interface AdsTokens {
  accessToken: string; refreshToken?: string; expiresAt?: string;
  refreshExpiresAt?: string; scopes: string[];
}
export interface AdsAccount {
  id: string; name: string; currency: string; timeZone: string | null; manager?: boolean; loginCustomerId?: string;
}
export interface AdsExternalCampaign { id: string; name: string; status: string }
export interface AdsDailyMetric {
  date: string; currency: string; timeZone: string;
  spend: number; impressions: number; clicks: number; conversions: number | null;
}
export interface AdsLead {
  externalId: string; name: string; email?: string; phone?: string; company?: string;
  occurredAt: string; externalCampaignId: string;
}
export interface AdsProviderClient {
  authorizationUrl(state: string, verifier: string): string;
  exchange(code: string, verifier: string): Promise<AdsTokens>;
  refresh(tokens: AdsTokens): Promise<AdsTokens>;
  accounts(tokens: AdsTokens): Promise<AdsAccount[]>;
  campaigns(tokens: AdsTokens, account: AdsAccount): Promise<AdsExternalCampaign[]>;
  dailyMetrics(tokens: AdsTokens, account: AdsAccount, campaignId: string, from: string, to: string): Promise<AdsDailyMetric[]>;
  leads(tokens: AdsTokens, account: AdsAccount, campaignId: string, from: string, to: string): Promise<AdsLead[]>;
}
