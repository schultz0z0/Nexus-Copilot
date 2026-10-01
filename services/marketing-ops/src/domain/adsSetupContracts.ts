import { z } from 'zod';
import { scopeSets } from '../integrations/ads/config.js';
import type { AdsProvider } from '../integrations/ads/types.js';

const base = {
  clientId: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9._:-]+$/),
  clientSecret: z.string().max(4096).optional(),
  apiVersion: z.string().trim().min(1).max(12),
  scopes: z.array(z.string().max(100)).min(1).max(10).refine(values => new Set(values).size === values.length),
  confirmReplacement: z.boolean().optional(), takeOverExternal: z.boolean().optional()
};
export function adsSetupSchema(provider: AdsProvider) {
  const schema = provider === 'meta'
    ? z.object({ ...base, metaLoginConfigId: z.string().trim().regex(/^\d{1,30}$/) }).strict()
    : provider === 'google'
      ? z.object({ ...base, googleLoginCustomerId: z.string().trim().transform(value => value.replace(/-/g, '')).refine(value => !value || /^\d{10}$/.test(value)).optional() }).strict()
      : z.object(base).strict();
  return schema.superRefine((value, context) => {
    if (!(provider === 'linkedin' ? /^20\d{2}(0[1-9]|1[0-2])$/ : provider === 'google' ? /^v\d{2}$/ : /^v\d{2}\.0$/).test(value.apiVersion)) context.addIssue({ code: 'custom', path: ['apiVersion'], message: 'Invalid provider API version' });
    if (value.scopes.some(scope => !scopeSets[provider].includes(scope))) context.addIssue({ code: 'custom', path: ['scopes'], message: 'Unsupported provider permission' });
    if (value.clientSecret && /[\u0000-\u001f\u007f]/.test(value.clientSecret)) context.addIssue({ code: 'custom', path: ['clientSecret'], message: 'Invalid client secret' });
  });
}
