import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, ChevronRight, Globe, ArrowUpRight } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { LeadCharts, LeadCoverage, LeadIndicators } from '@/components/dashboard/LeadResultsView';
import { DashboardInsights } from '@/components/dashboard/DashboardInsights';
import { DashboardAnalyticsPanel } from '@/components/dashboard/DashboardAnalyticsPanel';
import { DashboardOrganic } from '@/components/dashboard/DashboardOrganic';
import { WorkspaceWorkbench } from '@/components/marketing-ops/WorkspaceWorkbench';
import { LeadError } from '@/components/marketing-ops/LeadUi';
import { count, currency, leadDialog, leadSelect, shortDate } from '@/components/marketing-ops/leadUiHelpers';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { leadClient, leadKeys, type LeadClient, type LeadResults } from '@/lib/marketingOps/leads';
import { analyticsClient, analyticsKeys, defaultAnalyticsPeriod, validAnalyticsPeriod, type AnalyticsClient, type AnalyticsProvider } from '@/lib/marketingOps/analytics';
import { workspaceClient, workspaceServices, type WorkspaceClient, type WorkspaceService } from '@/lib/marketingOps/workspace';
import { buildMarketingInsights } from '@/lib/marketingOps/dashboardInsights';
import { marketingOpsFlags } from '@/lib/marketingOps/flags';
import { marketingOpsClient } from '@/lib/marketingOps/runtime';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';

const dashboardTabs = { overview: 'Visão geral', organic: 'Orgânico', campaigns: 'Campanhas', work: 'Trabalho' } as const;
type DashboardTab = keyof typeof dashboardTabs;

export function LiveMarketingDashboard({ api = leadClient, ops = marketingOpsClient, analytics = analyticsClient, workspace = workspaceClient }: { api?: LeadClient; ops?: MarketingOpsClient; analytics?: AnalyticsClient; workspace?: WorkspaceClient }) {
  const { normalizedRole } = useAuth();
  const canReadAnalytics = ['admin', 'manager'].includes(normalizedRole);
  const canWrite = canReadAnalytics && marketingOpsFlags(import.meta.env).write;
  const [params, setParams] = useSearchParams();
  const siteOpener = useRef<HTMLElement | null>(null);
  const tab = Object.prototype.hasOwnProperty.call(dashboardTabs, params.get('tab') ?? '') ? params.get('tab') as DashboardTab : 'overview';
  const date = (name: string) => /^\d{4}-\d{2}-\d{2}$/.test(params.get(name) ?? '') ? params.get(name)! : undefined;
  const campaignId = /^[0-9a-f-]{36}$/i.test(params.get('campaignId') ?? '') ? params.get('campaignId')! : undefined;
  const filters = { ...(campaignId ? { campaignId } : {}), ...(date('from') ? { from: date('from') } : {}), ...(date('to') ? { to: date('to') } : {}) };
  const period = { from: filters.from, to: filters.to };
  const invalidDates = !!filters.from && !!filters.to && filters.from > filters.to;
  const resultFilters = tab === 'organic' ? period : filters;
  const results = useQuery({ queryKey: leadKeys.results(resultFilters), queryFn: () => api.results(resultFilters), enabled: tab !== 'work' && !invalidDates, retry: false });
  const siteConnections = useQuery({ queryKey: analyticsKeys.connections, queryFn: analytics.connections, enabled: tab === 'overview' && canReadAnalytics, retry: false });
  const siteResource = (id: AnalyticsProvider) => { const connection = siteConnections.data?.data.find(row => row.provider === id); return connection?.resources.find(row => row.id === connection.selectedResourceId); };
  const ga4Resource = siteResource('ga4');
  const sitePeriod = { ...defaultAnalyticsPeriod(ga4Resource?.timeZone ?? 'UTC'), ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) };
  const siteGa4 = useQuery({ queryKey: analyticsKeys.results('ga4', sitePeriod), queryFn: () => analytics.results('ga4', sitePeriod), enabled: tab === 'overview' && canReadAnalytics && !!ga4Resource && validAnalyticsPeriod(sitePeriod, ga4Resource.timeZone), retry: false });
  const clarityPeriod = defaultAnalyticsPeriod('UTC');
  const siteClarity = useQuery({ queryKey: analyticsKeys.results('clarity', clarityPeriod), queryFn: () => analytics.results('clarity', clarityPeriod), enabled: tab === 'overview' && canReadAnalytics && !!siteResource('clarity'), retry: false });
  const campaigns = useQuery({ queryKey: [...leadKeys.all, 'campaign-options'], queryFn: async () => {
    const all = []; let cursor: string | undefined;
    do { const page = await ops.listCampaigns({ limit: 100, ...(cursor ? { cursor } : {}) }); all.push(...page.data); cursor = page.page?.nextCursor ?? undefined; } while (cursor && all.length < 2000);
    return all;
  }, enabled: tab === 'overview' || tab === 'campaigns', retry: false });
  const campaignQuery = new URLSearchParams({ ...(filters.from ? { from: filters.from } : {}), ...(filters.to ? { to: filters.to } : {}) }).toString();
  const update = (name: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(name, value); else next.delete(name); setParams(next, { replace: true }); };
  const navigateTab = (value: string) => { const next = new URLSearchParams(params); next.set('tab', value); next.delete('detail'); setParams(next); };
  const clearFilters = () => { const next = new URLSearchParams(params); ['from', 'to', 'campaignId'].forEach(name => next.delete(name)); setParams(next, { replace: true }); };
  const hubLink = (target: DashboardTab) => { const next = new URLSearchParams(params); next.set('tab', target); next.delete('detail'); return `/marketing-ops/dashboard?${next}`; };
  const source = params.get('source') === 'ga4' ? 'ga4' : 'search';
  const provider: AnalyticsProvider = params.get('provider') === 'clarity' ? 'clarity' : 'ga4';
  const service: WorkspaceService = Object.prototype.hasOwnProperty.call(workspaceServices, params.get('service') ?? '') ? params.get('service') as WorkspaceService : 'google_drive';
  const measured = results.data?.data;
  return <div className="min-h-screen bg-background text-foreground"><Sidebar /><MarketingOpsMobileBar label="Dashboard" icon={<BarChart3 className="h-4 w-4 text-brand-accent" />} /><main className="min-w-0 md:ml-20" onClickCapture={event => {
    const control = (event.target as HTMLElement).closest<HTMLElement>('button,a');
    if (control && (control.textContent === 'Análise do site e experiência' || control.getAttribute('href')?.includes('detail=site'))) siteOpener.current = control;
  }}><div className="mx-auto max-w-[1360px] space-y-7 px-4 py-6 pb-24 sm:px-6 lg:px-10 lg:py-10">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-medium tracking-tight sm:text-3xl">Dashboard de marketing</h1><p className="mt-2 text-sm text-muted-foreground">Resultados, descoberta e trabalho em uma leitura clara.</p></div><Button asChild variant="ghost" className="min-h-11 text-brand-accent"><Link to="/marketing-ops/dashboard?mode=demo">Ver demonstração</Link></Button></header>
    <Tabs value={tab} onValueChange={navigateTab} className="space-y-7">
      <TabsList aria-label="Seções do dashboard" className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl p-1 sm:w-auto sm:inline-flex">{Object.entries(dashboardTabs).map(([id, name]) => <TabsTrigger className="min-h-11 px-5" key={id} value={id}>{name}</TabsTrigger>)}</TabsList>
      {tab !== 'work' && <section aria-label="Filtros de resultados" className={`grid gap-3 sm:grid-cols-3 ${tab === 'organic' ? '' : 'lg:grid-cols-[1fr_1fr_1.5fr_auto]'} sm:items-end`}><div className="space-y-2"><Label htmlFor="live-from" className="text-xs text-muted-foreground">Período a partir de</Label><Input id="live-from" type="date" className="h-11" value={filters.from ?? ''} onChange={event => update('from', event.target.value)} /></div><div className="space-y-2"><Label htmlFor="live-to" className="text-xs text-muted-foreground">Período até</Label><Input id="live-to" type="date" className="h-11" value={filters.to ?? ''} onChange={event => update('to', event.target.value)} /></div>{tab !== 'organic' && <div className="space-y-2"><Label htmlFor="live-campaign" className="text-xs text-muted-foreground">Campanha</Label><select id="live-campaign" className={leadSelect} value={campaignId ?? ''} onChange={event => update('campaignId', event.target.value)}><option value="">Todas as campanhas</option>{campaignId && !campaigns.data?.some(campaign => campaign.id === campaignId) && <option value={campaignId}>Campanha selecionada</option>}{campaigns.data?.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></div>}<Button variant="ghost" className="min-h-11 text-muted-foreground" onClick={clearFilters}>Limpar filtros</Button></section>}
      {tab !== 'work' && invalidDates && <LeadError error={new Error('O fim do período deve ser igual ou posterior ao início.')} />}
      {!invalidDates && <>
        <TabsContent value="overview" className="space-y-7">
          <LeadError error={results.error} retry={() => { void results.refetch(); }} /><LeadError error={campaigns.error} retry={() => { void campaigns.refetch(); }} />
          {results.isLoading && <p role="status" className="py-6 text-sm text-muted-foreground">Carregando resultados…</p>}
          {measured && !results.isError && <><p className="text-sm text-text-secondary">{measured.coverage.sources || measured.coverage.reports ? 'Registros disponíveis no recorte. Confira a cobertura antes de interpretar a saúde da operação.' : 'Ainda não há fontes nem resultados medidos. Comece pela página de uma campanha.'}</p><LeadIndicators results={measured} /><LeadCharts results={measured} /></>}
          {canReadAnalytics && <>{siteConnections.isError && <section aria-label="Conexões da análise do site"><p className="mb-2 text-sm font-medium">Conexões da análise do site</p><LeadError error={siteConnections.error} retry={() => { void siteConnections.refetch(); }} /></section>}{siteGa4.isError && <section aria-label="Leitura Google Analytics"><p className="mb-2 text-sm font-medium">Google Analytics</p><LeadError error={siteGa4.error} retry={() => { void siteGa4.refetch(); }} /></section>}{siteClarity.isError && <section aria-label="Leitura Microsoft Clarity"><p className="mb-2 text-sm font-medium">Microsoft Clarity</p><LeadError error={siteClarity.error} retry={() => { void siteClarity.refetch(); }} /></section>}</>}
          <DashboardInsights items={buildMarketingInsights({ scope: 'overview', leads: !results.isError ? measured : undefined, ga4: canReadAnalytics && !siteGa4.isError ? siteGa4.data?.data : undefined, clarity: canReadAnalytics && !siteClarity.isError ? siteClarity.data?.data : undefined, campaignSelected: !!campaignId, campaignId, ...(filters.from && filters.to ? { period: { from: filters.from, to: filters.to } } : {}) })} />
            <div className="grid gap-3 sm:grid-cols-3"><QuickLink to={hubLink('organic')} title="Entender o orgânico" description="Pesquisas, páginas e navegação" /><QuickLink to={hubLink('campaigns')} title="Analisar campanhas" description="Mídia, funil e atribuição" /><QuickLink to={hubLink('work')} title="Acessar meu trabalho" description="Arquivos, e-mail e agenda" /></div>
            {measured && !results.isError && <LeadCoverage results={measured} />}<footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground"><p>{measured?.lastUpdated ? `Último registro em ${shortDate(measured.lastUpdated)}` : 'Sem atualização registrada'}</p><div className="flex flex-wrap gap-4">{canReadAnalytics && <Button variant="ghost" className="min-h-11 px-0 text-brand-accent" onClick={() => update('detail', 'site')}><Globe aria-hidden="true" className="h-4 w-4" />Análise do site e experiência</Button>}<Link className="inline-flex min-h-11 items-center text-brand-accent" to="/marketing-ops/campaigns">Abrir minhas campanhas</Link></div></footer>
        </TabsContent>
        <TabsContent value="organic"><DashboardOrganic source={source} onSourceChange={value => update('source', value)} period={period} leads={measured} canRead={canReadAnalytics} canWrite={canWrite} analytics={analytics} workspace={workspace} /></TabsContent>
        <TabsContent value="campaigns" className="space-y-7">
          <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-medium">Resultados das campanhas</h2><p className="mt-2 text-sm text-muted-foreground">Ações pagas e orgânicas, com resultados comerciais e navegação separados.</p></div><Button asChild variant="outline" className="min-h-11"><Link to="/marketing-ops/campaigns">Gerenciar campanhas</Link></Button></header>
          <LeadError error={results.error} retry={() => { void results.refetch(); }} /><LeadError error={campaigns.error} retry={() => { void campaigns.refetch(); }} />
          {results.isLoading && <p role="status">Carregando resultados de campanhas…</p>}
          {measured && !results.isError && <><LeadIndicators results={measured} campaign /><CampaignFunnel results={measured} /><DashboardInsights items={buildMarketingInsights({ scope: 'campaigns', leads: measured, campaignSelected: !!campaignId, campaignId, attributionChecked: false, ...(filters.from && filters.to ? { period: { from: filters.from, to: filters.to } } : {}) })} />
            <CampaignSummary results={measured} query={campaignQuery} />
            {campaignId && <details open={params.get('detail') === 'campaign'} onToggle={event => { const open = event.currentTarget.open; if (open !== (params.get('detail') === 'campaign')) update('detail', open ? 'campaign' : ''); }} className="rounded-xl border border-border bg-card p-5"><summary className="flex min-h-11 cursor-pointer items-center text-sm text-brand-accent">Ver navegação e experiência atribuídas à campanha</summary>{params.get('detail') === 'campaign' && <div className="mt-5 space-y-6"><div className="flex flex-wrap gap-3"><Button variant={provider === 'ga4' ? 'default' : 'outline'} className="min-h-11" onClick={() => update('provider', 'ga4')}>Google Analytics</Button><Button variant={provider === 'clarity' ? 'default' : 'outline'} className="min-h-11" onClick={() => update('provider', 'clarity')}>Microsoft Clarity</Button></div><DashboardAnalyticsPanel key={`${campaignId}:${provider}`} provider={provider} campaignId={campaignId} period={period} leads={measured} canRead={canReadAnalytics} canWrite={canWrite} api={analytics} /></div>}</details>}
            <LeadCoverage results={measured} />
          </>}
        </TabsContent>
      </>}
      <TabsContent value="work" className="space-y-7"><div><h2 className="text-xl font-medium">Meu espaço de trabalho</h2><p className="mt-2 text-sm text-muted-foreground">Acesse os serviços conectados. Abra uma campanha para vincular materiais e revisar importações no seu contexto.</p></div>{canReadAnalytics ? <WorkspaceWorkbench service={service} onServiceChange={value => { if (value === 'google_search_console') { const next = new URLSearchParams(params); next.set('tab', 'organic'); next.set('source', 'search'); next.delete('detail'); setParams(next); } else update('service', value); }} api={workspace} canManage={canWrite} /> : <p className="text-sm text-muted-foreground">O trabalho integrado está disponível para gestores e administradores.</p>}</TabsContent>
    </Tabs>
    {params.get('detail') === 'site' && <Dialog open onOpenChange={open => { if (!open) update('detail', ''); }}><DialogContent className={`${leadDialog} sm:max-w-6xl`} onCloseAutoFocus={event => {
      event.preventDefault();
      if (siteOpener.current?.isConnected) siteOpener.current.focus();
    }}><DialogHeader><DialogTitle>Análise do site e experiência</DialogTitle><DialogDescription>Visão geral do site. A leitura é independente dos resultados comerciais e do filtro de campanha.</DialogDescription></DialogHeader><div className="flex flex-wrap gap-3"><Button className="min-h-11" variant={provider === 'ga4' ? 'default' : 'outline'} onClick={() => update('provider', 'ga4')}>Google Analytics</Button><Button className="min-h-11" variant={provider === 'clarity' ? 'default' : 'outline'} onClick={() => update('provider', 'clarity')}>Microsoft Clarity</Button></div><DashboardAnalyticsPanel key={provider} provider={provider} period={period} canRead={canReadAnalytics} canWrite={canWrite} api={analytics} /></DialogContent></Dialog>}
  </div></main></div>;
}

function QuickLink({ to, title, description }: { to: string; title: string; description: string }) {
  return <Link to={to} className="flex min-h-24 items-center justify-between gap-3 rounded-xl border border-border p-5 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="mt-2 text-xs text-muted-foreground">{description}</p></div><ArrowUpRight className="h-4 w-4 shrink-0 text-brand-accent" aria-hidden="true" /></Link>;
}
function CampaignFunnel({ results }: { results: LeadResults }) {
  const rows = [{ label: 'Leads identificados', value: results.coverage.sources || results.capturedLeads ? results.capturedLeads : null }, { label: 'Qualificados informados', value: results.qualified }, { label: 'Vendas informadas', value: results.sales }];
  return <section aria-label="Etapas do funil comercial" className="rounded-xl border border-border bg-card p-5 sm:p-6"><h2 className="text-lg font-medium">Leads → qualificação → vendas</h2><div className="mt-5 grid grid-cols-3 gap-4">{rows.map(({ label, value }) => <div key={label} className="min-w-0"><p className="text-xs leading-relaxed text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-medium tabular-nums">{count(value)}</p></div>)}</div><p className="mt-5 text-xs leading-relaxed text-muted-foreground">Contagens do período com fontes diferentes. Não representam uma coorte de pessoas acompanhadas e não geram uma taxa de conversão automaticamente.</p></section>;
}
function CampaignSummary({ results, query }: { results: LeadResults; query: string }) {
  return <section aria-label="Campanhas no período"><h2 className="mb-4 text-lg font-medium">Campanhas no período</h2>{!results.campaigns.length ? <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Nenhum resultado de campanha registrado neste recorte. Abra uma campanha para configurar a captação e registrar os resultados.</p> : <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{results.campaigns.map(campaign => <li key={campaign.id}><Link to={`/marketing-ops/campaigns/${campaign.id}${query ? `?${query}` : ''}`} aria-label={`Ver resultados de ${campaign.name}`} className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-5 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1.8fr)_1fr_1fr_1.2fr_20px]"><div className="min-w-0"><h3 className="break-words text-sm font-medium">{campaign.name}</h3><p className="mt-2 text-xs text-muted-foreground sm:hidden">{count(campaign.capturedLeads)} leads · {count(campaign.sales)} vendas · {currency(campaign.spend)} investimento</p></div><span className="hidden text-right text-sm tabular-nums sm:block">{count(campaign.capturedLeads)} <span className="text-xs text-muted-foreground">leads</span></span><span className="hidden text-right text-sm tabular-nums sm:block">{count(campaign.sales)} <span className="text-xs text-muted-foreground">vendas</span></span><span className="hidden text-right text-sm tabular-nums sm:block">{currency(campaign.spend)}<span className="mt-1 block text-xs text-muted-foreground">investimento</span></span><ChevronRight className="h-4 w-4 text-brand-accent" aria-hidden="true" /></Link></li>)}</ul>}</section>;
}
