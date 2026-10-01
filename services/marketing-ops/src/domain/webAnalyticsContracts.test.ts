import { describe, it, expect } from 'vitest';
import { AnalyticsPeriodSchema, analyticsPeriod, ClarityConnectSchema, AnalyticsLinkSchema } from './webAnalyticsContracts.js';
describe('analytics contracts', () => {
    it('rejects fabricated days, reversed windows and missing bounds', () => {
        for (const input of [{ from: '2026-02-30', to: '2026-03-01' }, { from: '2026-09-02', to: '2026-09-01' }, { from: '2026-09-01' }])
            expect(AnalyticsPeriodSchema.safeParse(input).success).toBe(false);
    });
    it('requires complete property-timezone days and limits each report to thirty days', () => {
        expect(analyticsPeriod({ from: '2026-09-01', to: '2026-09-30' })).toEqual({ from: '2026-09-01', to: '2026-09-30' });
        expect(() => analyticsPeriod({ from: '2026-08-01', to: '2026-09-30' })).toThrow();
        const future = '2099-01-01';
        expect(() => analyticsPeriod({ from: future, to: future })).toThrow();
    });
    it('preserves exact UTM case and forbids whitespace/control ambiguity', () => {
        expect(AnalyticsLinkSchema.parse({ provider: 'ga4', utmCampaign: 'Launch-ABC' }).utmCampaign).toBe('Launch-ABC');
        for (const utmCampaign of [' Launch', 'Launch ', 'a\nb'])
            expect(AnalyticsLinkSchema.safeParse({ provider: 'ga4', utmCampaign }).success).toBe(false);
    });
    it('does not accept a project URL or arbitrary callback in Clarity credentials', () => {
        expect(ClarityConnectSchema.safeParse({ token: 'a'.repeat(30), projectId: 'https://evil.invalid', projectName: 'Site' }).success).toBe(false);
        expect(ClarityConnectSchema.safeParse({ token: 'a'.repeat(30), projectId: 'abc123', projectName: 'Site', redirectUri: 'https://evil.invalid' }).success).toBe(false);
    });
});
