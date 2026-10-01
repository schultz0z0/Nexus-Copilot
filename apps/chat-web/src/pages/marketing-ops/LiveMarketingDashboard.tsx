import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, ChevronRight } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { LeadCharts, LeadCoverage, LeadIndicators } from '@/components/dashboard/LeadResultsView';
import { LeadError } from '@/components/marketing-ops/LeadUi';
import { count, currency, leadSelect, shortDate } from '@/components/marketing-ops/leadUiHelpers';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { leadClient, leadKeys, type LeadClient } from '@/lib/marketingOps/leads';
import { marketingOpsClient } from '@/lib/marketingOps/runtime';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';

export function LiveMarketingDashboard({ api = leadClient, ops = marketingOpsClient }: { api?: LeadClient; ops?: MarketingOpsClient }) {
  const { normalizedRole } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = (name: string) => /^\d{4}-\d{2}-\d{2}$/.test(params.get(name) ?? '') ? params.get(name)! : undefined;
  const campaignId = /^[0-9a-f-]{36}$/i.test(params.get('campaignId') ?? '') ? params.get('campaignId')! : undefined;
  const filters = { ...(campaignId ? { campaignId } : {}), ...(date('from') ? { from: date('from') } : {}), ...(date('to') ? { to: date('to') } : {}) };
  const invalidDates = !!filters.from && !!filters.to && filters.from > filters.to;
  const results = useQuery({ queryKey: leadKeys.results(filters), queryFn: () => api.results(filters), enabled: !invalidDates });
  const campaigns = useQuery({ queryKey: [...leadKeys.all, 'campaign-options'], queryFn: async () => {
    const all = []; let cursor: string | undefined;
    do { const page = await ops.listCampaigns({ limit: 100, ...(cursor ? { cursor } : {}) }); all.push(...page.data); cursor = page.page?.nextCursor ?? undefined; } while (cursor && all.length < 2000);
    return all;
  } });
  const campaignQuery = new URLSearchParams({ ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) }).toString();
  const update = (name: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(name, value); else next.delete(name); setParams(next, { replace: true }); };
  return <div className="min-h-screen bg-background text-foreground"><Sidebar /><MarketingOpsMobileBar label="Dashboard" icon={<BarChart3 className="h-4 w-4 text-brand-accent" />} /><main className="min-w-0 md:ml-20"><div className="mx-auto max-w-[1360px] space-y-8 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-medium tracking-tight sm:text-3xl">Dashboard de marketing</h1><p className="mt-2 text-sm text-muted-foreground">Uma leitura dos resultados registrados nas suas campanhas.</p></div><Button asChild variant="ghost" className="min-h-11 text-brand-accent"><Link to="/marketing-ops/dashboard?mode=demo">Ver demonstração</Link></Button></header>
    <section aria-label="Filtros de resultados" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end"><div className="space-y-2"><Label htmlFor="live-from" className="text-xs text-muted-foreground">Período a partir de</Label><Input id="live-from" type="date" className="h-11" value={filters.from ?? ''} onChange={event => update('from', event.target.value)} /></div><div className="space-y-2"><Label htmlFor="live-to" className="text-xs text-muted-foreground">Período até</Label><Input id="live-to" type="date" className="h-11" value={filters.to ?? ''} onChange={event => update('to', event.target.value)} /></div><div className="space-y-2"><Label htmlFor="live-campaign" className="text-xs text-muted-foreground">Campanha</Label><select id="live-campaign" className={leadSelect} value={campaignId ?? ''} onChange={event => update('campaignId', event.target.value)}><option value="">Todas as campanhas</option>{campaignId && !campaigns.data?.some(campaign => campaign.id === campaignId) && <option value={campaignId}>Campanha selecionada</option>}{campaigns.data?.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></div><Button variant="ghost" className="min-h-11 text-muted-foreground" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Limpar filtros</Button></section>
    {invalidDates ? <LeadError error={new Error('O fim do período deve ser igual ou posterior ao início.')} /> : <>
      <LeadError error={results.error} retry={() => { void results.refetch(); }} /><LeadError error={campaigns.error} retry={() => { void campaigns.refetch(); }} />
      {results.isLoading && <p role="status" className="py-6 text-sm text-muted-foreground">Carregando resultados…</p>}
      {results.data && !results.isError && <>
        <p className="text-sm text-text-secondary">{results.data.data.coverage.sources || results.data.data.coverage.reports ? 'Leitura dos registros disponíveis. A cobertura das fontes ainda precisa ser validada pelo gestor.' : 'Ainda não há fontes nem resultados medidos. Comece pela página de uma campanha.'}</p>
        <LeadIndicators results={results.data.data} /><LeadCharts results={results.data.data} />
        {!!results.data.data.campaigns.length && <section aria-label="Campanhas no período"><h2 className="mb-4 text-lg font-semibold tracking-tight">Campanhas no período</h2><ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{results.data.data.campaigns.map(campaign => <li key={campaign.id}><Link to={`/marketing-ops/campaigns/${campaign.id}${campaignQuery ? `?${campaignQuery}` : ""}`} aria-label={`Ver resultados de ${campaign.name}`} className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-5 hover:bg-secondary/40 sm:grid-cols-[minmax(0,1.8fr)_1fr_1fr_1.2fr_20px]"><div className="min-w-0"><h3 className="break-words text-sm font-medium">{campaign.name}</h3><p className="mt-2 text-xs text-muted-foreground sm:hidden">{count(campaign.capturedLeads)} leads · {count(campaign.sales)} vendas</p></div><span className="hidden text-right text-sm tabular-nums sm:block">{count(campaign.capturedLeads)} <span className="text-xs text-muted-foreground">leads</span></span><span className="hidden text-right text-sm tabular-nums sm:block">{count(campaign.sales)} <span className="text-xs text-muted-foreground">vendas</span></span><span className="hidden text-right text-sm tabular-nums sm:block">{currency(campaign.revenue)}</span><ChevronRight className="h-4 w-4 text-brand-accent" aria-hidden="true" /></Link></li>)}</ul></section>}
        <LeadCoverage results={results.data.data} /><footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p>{results.data.data.lastUpdated ? `Último registro em ${shortDate(results.data.data.lastUpdated)}` : 'Sem atualização registrada'}</p><div className="flex flex-wrap gap-5">{['admin', 'manager'].includes(normalizedRole) && <Link className="inline-flex min-h-11 items-center text-brand-accent" to="/marketing-ops/analytics">Análise do site</Link>}<Link className="inline-flex min-h-11 items-center text-brand-accent" to="/marketing-ops/campaigns">Abrir minhas campanhas</Link></div></footer>
      </>}
    </>}
  </div></main></div>;
}
