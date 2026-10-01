import { z } from 'zod';
import { adsProviders } from '../integrations/ads/types.js';
export const AdsProviderSchema = z.enum(adsProviders);
export const AdsCallbackSchema = z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().min(1).max(4096).optional(), error: z.string().min(1).max(200).optional() }).strict().refine(value => !!value.code !== !!value.error, 'Callback requires a code or denial');
export const AdsAccountInputSchema = z.object({ accountId: z.string().min(1).max(200) }).strict();
export const AdsLinkInputSchema = z.object({ provider: AdsProviderSchema, sourceId: z.string().uuid(), externalCampaignId: z.string().min(1).max(200), destination: z.enum(['native_form','landing_page','whatsapp']) }).strict();
export const AdsPeriodSchema = z.object({ from: z.string().date(), to: z.string().date() }).strict().refine(value => value.to >= value.from && (Date.parse(value.to)-Date.parse(value.from))/86400000 < 30 && Date.parse(value.to) <= Date.now(), 'Sync period must be ordered, at most 30 days and not in the future');
export const AdsDailySchema = z.object({ date: z.string().date(), currency: z.string().regex(/^[A-Z]{3}$/), timeZone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }), spend: z.number().finite().nonnegative().max(1e12).refine(value => Math.abs(value*100-Math.round(value*100))<0.0001, 'Money has at most two decimals'), impressions: z.number().int().safe().nonnegative(), clicks: z.number().int().safe().nonnegative(), conversions: z.number().finite().nonnegative().max(1e12).nullable() }).strict();
export function adsSyncPeriod(timeZone:string,now=Date.now()):{from:string;to:string}{
  const today=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const midnight=Date.parse(`${today}T00:00:00Z`);
  return {from:new Date(midnight-7*86400000).toISOString().slice(0,10),to:new Date(midnight-86400000).toISOString().slice(0,10)};
}
