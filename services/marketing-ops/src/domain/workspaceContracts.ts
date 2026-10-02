import { z } from 'zod';
import { appError } from '../errors.js';
import { workspaceServices } from '../integrations/workspace/types.js';
export const WorkspaceServiceSchema = z.enum(workspaceServices);
export const WorkspaceFamilySchema = z.enum(['google', 'microsoft']);
const identifier = z.string().min(1).max(2048).refine(v => !/[\u0000-\u001f]/.test(v));
export const WorkspaceSetupSchema = z.object({ clientId: z.string().trim().min(3).max(500), clientSecret: z.string().min(1).max(12000).optional(), tenantId: z.string().regex(/^[A-Za-z0-9.-]{1,253}$/).optional(), confirmReplacement: z.boolean().optional() }).strict();
export const WorkspaceAuthorizeSchema = z.object({ confirmReplacement: z.boolean().optional() }).strict();
export const WorkspaceSelectSchema = z.object({ resourceId: identifier, confirmReplacement: z.boolean().optional() }).strict();
export const WorkspaceBrowseSchema = z.object({ parentId: identifier.optional(), search: z.string().max(200).optional(), page: z.string().max(4000).optional() }).strict();
export const WorkspaceSheetSchema = z.object({ resourceId: identifier.optional() }).strict();
export const WorkspaceMailSchema = z.object({ to: z.array(z.string().email().max(254)).min(1).max(20), subject: z.string().min(1).max(300).refine(v => !/[\r\n]/.test(v)), text: z.string().min(1).max(50000), campaignId: z.string().uuid().optional() }).strict();
export const WorkspaceSendSchema = z.object({ confirm: z.literal(true), campaignId: z.string().uuid().optional() }).strict();
const timestamp = z.string().datetime({ offset: true });
export const WorkspaceEventSchema = z.object({ title: z.string().trim().min(1).max(300), description: z.string().max(10000), start: timestamp, end: timestamp, timeZone: z.string().max(100).refine(v => {
        try {
            new Intl.DateTimeFormat('en', { timeZone: v });
            return true;
        }
        catch {
            return false;
        }
    }), campaignId: z.string().uuid().optional(), actionId: z.string().uuid().optional(), confirm: z.literal(true) }).strict().refine(v => Date.parse(v.end) > Date.parse(v.start) && Date.parse(v.end) - Date.parse(v.start) <= 31 * 86400000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const WorkspacePeriodSchema = z.object({ from: day.optional(), to: day.optional() }).strict().refine(v => !!v.from === !!v.to && (!v.from || v.from <= v.to!));
export function workspacePeriod(input: unknown) {
    const v = WorkspacePeriodSchema.parse(input);
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 1);
    const to = v.to ?? end.toISOString().slice(0, 10);
    const start = new Date(to);
    start.setUTCDate(start.getUTCDate() - 27);
    const from = v.from ?? start.toISOString().slice(0, 10);
    if (Date.parse(to) - Date.parse(from) > 92 * 86400000)
        throw appError('workspace_invalid_period', 422, 'Choose at most 93 days');
    return { from, to };
}
export const WorkspaceLinkSchema = z.object({ service: WorkspaceServiceSchema, kind: z.enum(['file', 'message']), resourceId: identifier }).strict();
