import { z } from 'zod';
import { appError } from '../errors.js';
export const AnalyticsProviderSchema = z.enum(['ga4', 'clarity']);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const AnalyticsPeriodSchema = z.object({ from: day.optional(), to: day.optional() }).strict().refine(v => !!v.from === !!v.to && (!v.from || v.from <= v.to!));
export const AnalyticsResultsSchema = z.object({ from: day.optional(), to: day.optional(), scope: z.literal('organic').optional() }).strict().refine(v => !!v.from === !!v.to && (!v.from || v.from <= v.to!));
export const AnalyticsResourceSchema = z.object({ resourceId: z.string().regex(/^[0-9]{1,30}$/), confirmReplacement: z.boolean().optional() }).strict();
export const ClarityConnectSchema = z.object({ token: z.string().min(20).max(12000).regex(/^[A-Za-z0-9_.-]+$/), projectId: z.string().regex(/^[a-zA-Z0-9]{1,40}$/), projectName: z.string().trim().min(1).max(120), confirmReplacement: z.boolean().optional() }).strict();
export const AnalyticsLinkSchema = z.object({ provider: AnalyticsProviderSchema, utmCampaign: z.string().min(1).max(200).refine(v => v.trim() === v && !/[\u0000-\u001f]/.test(v)) }).strict();
export function analyticsPeriod(input: unknown, timeZone = 'UTC'): {
    from: string;
    to: string;
} {
    const value = AnalyticsPeriodSchema.parse(input);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() - 1);
    const to = value.to ?? end.toISOString().slice(0, 10);
    const start = new Date(`${to}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    const from = value.from ?? start.toISOString().slice(0, 10);
    if (to >= today || Date.parse(to) - Date.parse(from) > 29 * 86400000)
        throw appError('analytics_invalid_period', 422, 'Choose at most 30 complete days');
    return { from, to };
}
