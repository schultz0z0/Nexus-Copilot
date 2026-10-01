import { z } from 'zod';

export const LeadChannelSchema = z.enum(['meta_ads', 'google_ads', 'linkedin_ads', 'email', 'whatsapp', 'organic', 'google_maps', 'other']);
export const LeadClassificationSchema = z.enum(['cold', 'lead']);
export const phoneSchema = z.string().trim().max(40).transform(value => value.replace(/[\s()+.-]/g, '')).pipe(z.string().regex(/^[1-9][0-9]{7,14}$/, 'Use a phone with 8 to 15 digits, including the country code when known'));
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
const originSchema = z.string().max(300).url().refine(value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password; } catch { return false; }
}, 'Use an exact HTTP(S) origin without path or trailing slash');

const sourceFields = z.object({
  name: z.string().trim().min(1).max(160),
  channel: LeadChannelSchema,
  kind: z.enum(['landing_page', 'whatsapp', 'manual']),
  classification: LeadClassificationSchema.optional(),
  actionId: z.string().uuid().nullable().default(null),
  externalAccountId: z.string().trim().min(1).max(200).nullable().default(null),
  externalCampaignId: z.string().trim().min(1).max(200).nullable().default(null),
  allowedOrigins: z.array(originSchema).max(20).default([]),
  whatsappPhone: phoneSchema.nullable().default(null),
  enabled: z.boolean().default(true)
}).strict();
export const LeadSourceInputSchema = sourceFields.superRefine((source, context) => {
  if (source.kind === 'landing_page' && !source.allowedOrigins.length) context.addIssue({ code: 'custom', path: ['allowedOrigins'], message: 'A landing page requires allowed origins' });
  if (source.kind === 'whatsapp' && !source.whatsappPhone) context.addIssue({ code: 'custom', path: ['whatsappPhone'], message: 'A WhatsApp source requires a destination phone' });
}).transform(source => ({ ...source, classification: source.classification ?? (source.channel === 'google_maps' ? 'cold' : 'lead') }));
// Identity fields remain fixed after the first receipt: edits change presentation,
// destination and availability rather than retroactively changing attribution.
export const LeadSourcePatchSchema = sourceFields.pick({ name: true, allowedOrigins: true, whatsappPhone: true, enabled: true }).partial().strict().refine(value => Object.keys(value).length > 0, 'Patch must not be empty');
export type LeadSourceInput = z.infer<typeof LeadSourceInputSchema>;

export const LeadRowSchema = z.object({
  externalId: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  company: z.string().trim().max(200).optional(),
  occurredAt: z.string().datetime({ offset: true }).refine(value => Date.parse(value) <= Date.now() + 300_000, 'Date cannot be in the future'),
  classification: LeadClassificationSchema.optional()
}).strict().refine(value => !!value.email || !!value.phone, { message: 'Email or phone is required', path: ['email'] });
export type LeadRow = z.infer<typeof LeadRowSchema>;
export const ImportPreviewInputSchema = z.object({ sourceId: z.string().uuid(), rows: z.array(z.unknown()).min(1).max(500) }).strict();
export const ImportConfirmSchema = z.object({ decisions: z.array(z.object({ rowIndex: z.number().int().min(0).max(499), action: z.enum(['create', 'link', 'skip']), contactId: z.string().uuid().optional() }).strict().refine(value => (value.action === 'link') === !!value.contactId, 'Only link requires contactId')).max(500) }).strict().refine(value => new Set(value.decisions.map(row => row.rowIndex)).size === value.decisions.length, 'Each row accepts one decision');
export type ImportDecision = z.infer<typeof ImportConfirmSchema>['decisions'][number];
export interface ContactCandidate { id: string; name: string; email: string | null; phone: string | null; company: string | null }
export interface ImportReviewRow { rowIndex: number; status: 'new' | 'duplicate' | 'possible_duplicate' | 'invalid'; input: LeadRow | null; issues: string[]; candidates: ContactCandidate[]; contactId: string | null }
export interface ImportPreview { id: string; sourceId: string; campaignId: string; expiresAt: string; rows: ImportReviewRow[]; summary: Record<ImportReviewRow['status'], number> }
export interface ImportReceipt { previewId: string; created: number; linked: number; skipped: number; duplicate: number; invalid: number }

const count = z.number().int().safe().min(0).max(1_000_000_000);
const money = z.number().finite().min(0).max(1_000_000_000_000).refine(value => Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.0001, 'Use at most two decimal places');
export const ReportMetricsSchema = z.object({ sent: count.optional(), delivered: count.optional(), opened: count.optional(), clicked: count.optional(), responded: count.optional(), spend: money.optional(), qualified: count.optional(), sales: count.optional(), revenue: money.optional() }).strict().refine(metrics => Object.keys(metrics).length > 0, 'Enter at least one measured value').superRefine((metrics, context) => {
  for (const [higher, lower] of [['sent', 'delivered'], ['delivered', 'opened'], ['sent', 'responded']] as const) {
    if (metrics[higher] !== undefined && metrics[lower] !== undefined && metrics[lower]! > metrics[higher]!) context.addIssue({ code: 'custom', path: [lower], message: `${lower} cannot exceed ${higher}` });
  }
});
export type ReportMetrics = z.infer<typeof ReportMetricsSchema>;
export const ResultReportInputSchema = z.object({
  sourceId: z.string().uuid(), actionId: z.string().uuid().nullable().default(null),
  periodFrom: z.string().date(), periodTo: z.string().date(),
  timeZone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }),
  metrics: ReportMetricsSchema, notes: z.string().trim().max(4000).nullable().default(null)
}).strict().refine(value => value.periodTo >= value.periodFrom && Date.parse(value.periodTo) - Date.parse(value.periodFrom) <= 366 * 86400000, { message: 'Report period must be ordered and at most 367 days', path: ['periodTo'] });
export type ResultReportInput = z.infer<typeof ResultReportInputSchema>;
export const PublicCaptureSchema = z.object({
  submissionId: z.string().trim().min(8).max(128), name: z.string().trim().min(1).max(200),
  email: emailSchema.optional(), phone: phoneSchema.optional(), company: z.string().trim().max(200).optional(),
  utm: z.object({ source: z.string().max(200).optional(), medium: z.string().max(200).optional(), campaign: z.string().max(200).optional(), content: z.string().max(200).optional(), term: z.string().max(200).optional() }).strict().optional(),
  website: z.string().max(200).optional()
}).strict().refine(value => !!value.email || !!value.phone, 'Email or phone is required');
