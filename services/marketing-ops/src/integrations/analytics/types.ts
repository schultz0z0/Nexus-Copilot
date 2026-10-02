import type { AdsTokens } from '../ads/types.js';
export type AnalyticsProvider = 'ga4' | 'clarity';
export interface AnalyticsResource {
    id: string;
    name: string;
    timeZone: string;
    currency?: string;
}
export interface AnalyticsTotals {
    botSessions?: number | null;
    sessions: number;
    engagedSessions: number | null;
    pageViews: number | null;
    keyEvents: number | null;
    rageClicks: number | null;
    deadClicks: number | null;
    scrollDepth: number | null;
}
export interface AnalyticsDaily {
    date: string;
    sessions: number;
    engagedSessions: number | null;
    pageViews: number | null;
    keyEvents: number | null;
}
export interface AnalyticsChannel {
    channelGroup?: string;
    engagedSessions?: number | null;
    pageViews?: number | null;
    keyEvents?: number | null;
    source: string;
    medium: string;
    sessions: number;
}
export interface AnalyticsCampaign {
    utmCampaign: string;
    sessions: number;
}
export interface AnalyticsResults {
    provider: AnalyticsProvider;
    resource: AnalyticsResource | null;
    from: string;
    to: string;
    lastSyncAt: string | null;
    totals: AnalyticsTotals | null;
    daily: AnalyticsDaily[];
    channels: AnalyticsChannel[];
    campaigns: AnalyticsCampaign[];
    warnings: string[];
    window: {
        from: string;
        to: string;
    } | null;
    stale: boolean;
}
export interface AnalyticsConnection {
    provider: AnalyticsProvider;
    status: 'unprepared' | 'prepared' | 'pending_resource' | 'connected' | 'partial' | 'reconnect_required' | 'disconnected' | 'error';
    version: number;
    resources: AnalyticsResource[];
    selectedResourceId: string | null;
    lastSyncAt: string | null;
    safeError: string | null;
}
export interface AnalyticsLink {
    id: string;
    campaignId: string;
    provider: AnalyticsProvider;
    resourceId: string;
    utmCampaign: string;
    enabled: boolean;
    version: number;
}
export interface AnalyticsSyncReceipt {
    id: string;
    status: 'completed' | 'partial';
    completedAt: string;
    warnings: string[];
}
export interface AnalyticsBatch {
    /** Version 1 measures official session channel groups and every channel metric. */
    channelMetricsVersion?: 1;
    totals: AnalyticsTotals;
    daily: AnalyticsDaily[];
    channels: (AnalyticsChannel & {
        date?: string;
        utmCampaign?: string;
    })[];
    campaigns: (AnalyticsCampaign & Partial<AnalyticsDaily>)[];
    campaignChannels: (AnalyticsChannel & {
        date: string;
        utmCampaign: string;
    })[];
    warnings: string[];
    window: {
        from: string;
        to: string;
    } | null;
}
export interface Ga4ProviderClient {
    authorizationUrl(state: string, verifier: string): string;
    exchange(code: string, verifier: string,signal?:AbortSignal): Promise<AdsTokens>;
    refresh(tokens: AdsTokens,signal?:AbortSignal): Promise<AdsTokens>;
    resources(tokens: AdsTokens,signal?:AbortSignal): Promise<AnalyticsResource[]>;
    report(tokens: AdsTokens, resourceId: string, from: string, to: string,signal?:AbortSignal): Promise<AnalyticsBatch>;
}
export interface ClarityProviderClient {
    report(token: string, reserve?: (calls: number) => Promise<void>): Promise<AnalyticsBatch>;
}
