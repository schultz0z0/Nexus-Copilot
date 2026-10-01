import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';

export const leadSelect = 'h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring md:text-sm';
export const leadDialog = 'max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl bg-card sm:max-w-3xl [&>button:last-child]:inline-flex [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:items-center [&>button:last-child]:justify-center [&>div:first-child]:pr-10';
export const leadContainer = 'mx-auto max-w-5xl space-y-6 px-4 py-7 sm:px-6 md:px-8';
export const count = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('pt-BR').format(value);
export const currency = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
export function shortDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/');
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(timestamp);
}
export function useProposalKey() {
  const previous = useRef<{ payload: string; key: string }>();
  return Object.assign((value: unknown) => {
    const payload = JSON.stringify(value);
    if (previous.current?.payload !== payload) previous.current = { payload, key: crypto.randomUUID() };
    return previous.current.key;
  }, { reset: () => { previous.current = undefined; } });
}
export function useDialogReturnFocus(fallback?: () => HTMLElement | null) {
  const trigger = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return (event: Event) => { event.preventDefault(); (trigger.current?.isConnected ? trigger.current : fallback?.())?.focus(); };
}
export function useCampaignActions(campaignId: string, ops: MarketingOpsClient, enabled: boolean) {
  return useQuery({ queryKey: ['marketing-leads', 'calendar-actions', campaignId], enabled: enabled && typeof ops.listProductionSchedule === 'function', queryFn: async () => {
    const rows = []; let cursor: string | undefined;
    do {
      const page = await ops.listProductionSchedule({ campaignId, limit: 100, ...(cursor ? { cursor } : {}) });
      rows.push(...page.data); cursor = page.page?.nextCursor ?? undefined;
    } while (cursor && rows.length < 2000);
    return rows;
  } });
}
