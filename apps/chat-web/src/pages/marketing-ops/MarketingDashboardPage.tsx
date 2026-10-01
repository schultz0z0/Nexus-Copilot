import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BarChart3, ChevronRight, FileInput, Info, SlidersHorizontal } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { ChannelDistribution, PaidInvestment } from '@/components/dashboard/ChannelCharts';
import { LeadsTrend, ResultIndicators, SalesFunnel, resultPanel } from '@/components/dashboard/DashboardResults';
import { WeeklyResultsDialog } from '@/components/dashboard/WeeklyResultsDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { buildDashboard, CAMPAIGNS, CHANNELS, money, number, percent, PERIODS, rate, SNAPSHOT, type CampaignId, type ChannelId, type Filters } from '@/lib/dashboard/model';
import { cn } from '@/lib/utils';
import { LiveMarketingDashboard } from './LiveMarketingDashboard';

const selectStyle = 'h-11 min-w-0 w-full rounded-md border border-input bg-background px-3 text-base text-foreground md:text-sm';
type Detail = 'results' | 'health' | 'sources' | ChannelId;

export default function MarketingDashboardPage() {
  const { demoCampaignId } = useParams();
  const [params] = useSearchParams();
  if (!demoCampaignId && params.get('mode') !== 'demo') return <LiveMarketingDashboard />;
  const campaign = CAMPAIGNS.find(item => item.id === demoCampaignId);
  if (demoCampaignId && !campaign) return <div className="min-h-screen bg-background p-8 text-foreground"><h1 className="text-2xl">Campanha de demonstração não encontrada</h1><Link className="mt-6 inline-flex min-h-11 items-center text-brand-accent" to="/marketing-ops/dashboard">Voltar ao dashboard</Link></div>;
  return <DashboardContent key={campaign?.id ?? 'overview'} campaign={campaign} />;
}

function DashboardContent({ campaign }: { campaign?: typeof CAMPAIGNS[number] }) {
  useLayoutEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, []);
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const filters = useMemo<Filters>(() => {
    const search = new URLSearchParams(query);
    const weeks = Number(search.get('weeks'));
    const channel = CHANNELS.find(item => item.id === search.get('channel'))?.id ?? 'all';
    const selected = CAMPAIGNS.find(item => item.id === search.get('campaign'))?.id ?? 'all';
    return { weeks: weeks === 1 || weeks === 2 ? weeks : 4, channel, campaign: campaign?.id ?? selected, unavailable: search.get('unavailable') === 'true' };
  }, [query, campaign?.id]);
  const model = useMemo(() => buildDashboard(filters), [filters]);
  const { current, available, complete } = model;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [weeklyChannel, setWeeklyChannel] = useState<'email' | 'whatsapp'>('email');
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const restoreFocus = () => dialogTrigger.current?.focus();
  const setFilters = (next: Filters) => {
    const search = new URLSearchParams();
    search.set('weeks', String(next.weeks));
    search.set('channel', next.channel);
    const overviewCampaign = campaign ? params.get('campaign') : next.campaign;
    if (CAMPAIGNS.some(item => item.id === overviewCampaign)) search.set('campaign', overviewCampaign!);
    if (next.unavailable) search.set('unavailable', 'true');
    search.set('mode', 'demo');
    setParams(search, { replace: true });
  };
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters({ ...filters, [key]: value });
  const openWeekly = (channel: 'email' | 'whatsapp' = filters.channel === 'whatsapp' ? 'whatsapp' : 'email') => { setWeeklyChannel(channel); setWeeklyOpen(true); };
  const channelDetail = model.channels.find(item => item.id === detail);
  const detailTitle = detail === 'results' ? 'Detalhes dos resultados' : detail === 'health' ? 'Saúde e prioridades' : detail === 'sources' ? 'Fontes e atualização' : `Resultados de ${channelDetail?.name ?? 'canal'}`;
  const health = !available ? 'Ainda não há dados para avaliar os resultados.' : !complete ? 'Leitura parcial · falta o informe de WhatsApp.' : model.resultHealth === 'on-track' ? 'Captação dentro da meta do período.' : 'Captação abaixo da meta do período.';
  const scopeQuery = params.toString() ? `?${params.toString()}` : '';
  return <div className="min-h-screen bg-background text-foreground">
    <Sidebar />
    <MarketingOpsMobileBar label={campaign ? 'Resultados da campanha' : 'Dashboard'} icon={<BarChart3 className="h-4 w-4 text-brand-accent" />} />
    <main className="min-w-0 md:ml-20" onClickCapture={event => {
      if (event.target instanceof Element) {
        const trigger = event.target.closest('button');
        if (trigger) dialogTrigger.current = trigger;
      }
    }}>
      <div className="mx-auto max-w-[1360px] space-y-8 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <header>
          {campaign && <Link to={`/marketing-ops/dashboard${scopeQuery}`} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Voltar ao dashboard</Link>}
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0"><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-brand-accent" aria-hidden="true" />{campaign ? 'Resultados da campanha' : 'Visão geral'}<span className="ml-1 rounded border border-border px-2 py-0.5">Demonstração</span></div><h1 className="break-words text-2xl font-medium tracking-tight sm:text-3xl">{campaign?.name ?? 'Dashboard de marketing'}</h1><p className="mt-2 text-sm text-muted-foreground">{campaign ? campaign.objective : 'Os números essenciais, em uma só leitura.'}</p></div>
            <div className="flex flex-wrap gap-2"><Button variant="ghost" className="h-11 text-text-secondary" onClick={() => setDetail('sources')}><Info />Fontes e atualização</Button><Button className="h-11" onClick={() => openWeekly()}><FileInput />Atualização semanal</Button></div>
          </div>
        </header>

        <section aria-label="Filtros de resultados" className={cn('grid gap-3 sm:items-end', campaign ? 'sm:grid-cols-[1fr_1fr_auto]' : 'sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_auto]')}>
          <div className="space-y-1.5"><Label htmlFor="dashboard-period" className="text-xs text-muted-foreground">Período dos resultados</Label><select id="dashboard-period" className={selectStyle} value={filters.weeks} onChange={event => setFilter('weeks', Number(event.target.value) as Filters['weeks'])}><option value={4}>4 semanas · 24 ago–20 set</option><option value={2}>2 semanas · 07–20 set</option><option value={1}>1 semana · 14–20 set</option></select></div>
          {!campaign && <div className="space-y-1.5"><Label htmlFor="dashboard-campaign" className="text-xs text-muted-foreground">Campanha</Label><select id="dashboard-campaign" className={selectStyle} value={filters.campaign} onChange={event => setFilter('campaign', event.target.value as CampaignId | 'all')}><option value="all">Todas as campanhas</option>{CAMPAIGNS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
          <div className="space-y-1.5"><Label htmlFor="dashboard-channel" className="text-xs text-muted-foreground">Canal</Label><select id="dashboard-channel" className={selectStyle} value={filters.channel} onChange={event => setFilter('channel', event.target.value as ChannelId | 'all')}><option value="all">Todos os canais</option>{CHANNELS.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></div>
          <Button variant="ghost" className="h-11 text-muted-foreground" onClick={() => setFilters({ weeks: 4, channel: 'all', campaign: campaign?.id ?? 'all', unavailable: filters.unavailable })}>Limpar filtros</Button>
        </section>

        <section aria-label="Saúde da operação" className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1">
          <p className="flex min-w-0 items-start gap-2 text-sm text-text-secondary"><Info className={cn('mt-0.5 h-4 w-4 shrink-0', available && !complete ? 'text-status-warning' : 'text-brand-accent')} aria-hidden="true" />{health}</p>
          <Button variant="link" className="h-11 p-0 text-xs" onClick={() => setDetail('health')}>Ver diagnóstico<ChevronRight /></Button>
        </section>

        <ResultIndicators model={model} />
        <div className="grid items-stretch gap-6 xl:grid-cols-[1.15fr_1fr]"><LeadsTrend model={model} /><ChannelDistribution model={model} onChannelDetails={setDetail} /></div>

        {campaign ? <>
          <div className="grid items-start gap-6 xl:grid-cols-2"><SalesFunnel model={model} /><PaidInvestment model={model} /></div>
          <section className={resultPanel} aria-label="Desempenho dos canais">
            <h2 className="text-lg font-semibold tracking-tight">Resultados por canal</h2>
            <p className="mt-1 text-xs text-muted-foreground">Somente {campaign.name} · {PERIODS[filters.weeks]}</p>
            <div className="mt-5 divide-y divide-border">{model.channels.map(channel => <button key={channel.id} type="button" onClick={() => setDetail(channel.id)} className="grid min-h-16 w-full grid-cols-[1fr_auto] items-center gap-3 rounded-md px-2 py-4 text-left hover:bg-secondary/50 sm:grid-cols-[1fr_1fr_1fr_auto]" aria-label={`Detalhar ${channel.name}`} aria-describedby={`channel-result-${channel.id}`}>
              <span className="text-sm">{channel.name}{!channel.complete ? <span className="ml-2 text-xs text-status-warning">Parcial</span> : null}</span>
              <span className="text-sm tabular-nums text-text-secondary">{channel.available ? number(channel.leads) : '—'} <span className="text-xs text-muted-foreground">leads</span></span>
              <span className="hidden text-sm tabular-nums text-text-secondary sm:block">{channel.available ? number(channel.qualified) : '—'} <span className="text-xs text-muted-foreground">qualificados</span></span>
              <ArrowRight className="hidden h-4 w-4 text-brand-accent sm:block" aria-hidden="true" />
              <span id={`channel-result-${channel.id}`} className="sr-only">{channel.available ? `${number(channel.leads)} leads, ${number(channel.qualified)} qualificados. ${channel.complete ? 'Dados completos.' : 'Dados parciais.'}` : 'Resultados indisponíveis.'}</span>
            </button>)}</div>
          </section>
        </> : <section aria-label="Campanhas no período">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold tracking-tight">Campanhas no período</h2><Button variant="ghost" className="h-11 text-brand-accent" onClick={() => setDetail('results')}><SlidersHorizontal />Explorar resultados</Button></div>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="hidden grid-cols-[minmax(0,1.8fr)_1fr_1fr_1.2fr_20px] gap-4 border-b border-border px-6 py-3 text-xs text-muted-foreground sm:grid"><span>Campanha</span><span className="text-right">Leads</span><span className="text-right">Vendas</span><span className="text-right">Receita</span></div>
            <ul className="divide-y divide-border">{model.campaigns.map(item => <li key={item.id}><Link to={`/marketing-ops/dashboard/campaigns/${item.id}${scopeQuery}`} aria-label={`Ver resultados de ${item.name}`} aria-describedby={`campaign-summary-${item.id}`} className="group grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-5 hover:bg-secondary/40 sm:grid-cols-[minmax(0,1.8fr)_1fr_1fr_1.2fr_20px] sm:px-6">
              <div className="min-w-0"><h3 className="text-sm font-medium group-hover:text-brand-accent">{item.name}</h3><p className="mt-1 text-xs text-muted-foreground">{item.owner}</p><p className="mt-2 text-xs tabular-nums text-text-secondary sm:hidden">{item.available ? number(item.leads) : '—'} leads · {item.available ? number(item.sales) : '—'} vendas</p></div>
              <span className="hidden text-right text-sm tabular-nums sm:block">{item.available ? number(item.leads) : '—'}</span><span className="hidden text-right text-sm tabular-nums sm:block">{item.available ? number(item.sales) : '—'}</span><span className="hidden text-right text-sm tabular-nums sm:block">{item.available ? money(item.revenue) : '—'}</span><ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-brand-accent" aria-hidden="true" />
            </Link><span id={`campaign-summary-${item.id}`} className="sr-only">{item.available ? `${number(item.leads)} leads, ${number(item.sales)} vendas, receita ${money(item.revenue)}. Responsável: ${item.owner}.` : 'Resultados indisponíveis.'}</span></li>)}</ul>
          </div>
        </section>}

        <footer className="flex flex-wrap items-center justify-between gap-2 pb-2 text-xs text-muted-foreground"><p>Dados de demonstração · corte em {SNAPSHOT}</p>{campaign ? <p>Responsável no exemplo: {campaign.owner}</p> : <Link className="inline-flex min-h-11 items-center gap-2 rounded-sm hover:text-foreground" to="/marketing-ops/campaigns">Abrir minhas campanhas<ArrowRight className="h-3.5 w-3.5" /></Link>}</footer>
      </div>
    </main>

    {weeklyOpen && <WeeklyResultsDialog onClose={() => setWeeklyOpen(false)} restoreFocus={restoreFocus} initialChannel={weeklyChannel} initialCampaign={campaign?.id} />}
    <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}>
      <DialogContent onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-xl bg-card sm:max-w-3xl">
        <DialogHeader><DialogTitle>{detailTitle}</DialogTitle><DialogDescription>{campaign?.name ?? 'Todas as campanhas do recorte'} · {PERIODS[filters.weeks]} · dados demonstrativos</DialogDescription></DialogHeader>
        {detail === 'results' && <div className="space-y-5"><div className="grid grid-cols-2 gap-5 border-y border-border py-5"><div><p className="text-xs text-muted-foreground">Leads qualificados</p><p className="mt-2 text-2xl tabular-nums">{available ? number(current.qualified) : '—'}</p></div><div><p className="text-xs text-muted-foreground">Oportunidades</p><p className="mt-2 text-2xl tabular-nums">{available ? number(current.opportunities) : '—'}</p></div></div><SalesFunnel model={model} /><PaidInvestment model={model} /></div>}
        {detail === 'health' && <div className="space-y-6">
          <div><h3 className="text-sm font-medium">{health}</h3><p className="mt-2 text-sm text-muted-foreground">{available ? `${number(current.leads)} de ${number(model.goal)} leads previstos · ${percent(rate(current.leads, model.goal))} da meta.` : 'Ausência de dados não representa resultado zero.'}</p><p className="mt-2 text-xs text-muted-foreground">{available && !complete ? 'Nenhuma conclusão positiva de saúde pode ser feita com a cobertura incompleta.' : 'A meta de captação é um sinal; custos, conversão e execução completam o diagnóstico.'}</p></div>
          <div className="border-t border-border pt-5"><h3 className="text-sm font-medium">Cobertura do recorte</h3><p className="mt-2 text-sm text-text-secondary">{available ? `${model.channels.filter(item => item.complete).length} de ${model.channels.length} canais completos` : 'Sem fontes disponíveis'}</p>{!complete && available && <p className="mt-2 text-xs text-muted-foreground">WhatsApp: falta 14–20 set. Use Atualização semanal para revisar o informe.</p>}</div>
          {!campaign && <div className="border-t border-border pt-5"><h3 className="text-sm font-medium">Execução geral · exemplo em 21 set</h3><p className="mt-2 text-sm text-text-secondary">{filters.unavailable ? 'Aguardando dados do calendário.' : '3 entregas atrasadas · 2 aprovações pendentes'}</p><p className="mt-2 text-xs text-muted-foreground">Retrato demonstrativo da operação, independente dos filtros de resultados.</p></div>}
        </div>}
        {detail === 'sources' && <div className="space-y-5">
          <p className="text-sm leading-relaxed text-text-secondary">Nenhuma plataforma conectada nesta prévia. Anúncios: Google Ads, Meta Ads e LinkedIn Ads. E-mail e WhatsApp: relatórios semanais informados pelo gestor e vinculados à campanha e à ação no calendário.</p>
          <ul className="divide-y divide-border">{model.channels.map(channel => <li key={channel.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span>{channel.name}</span><span className={cn('text-xs', !channel.complete && channel.available ? 'text-status-warning' : 'text-muted-foreground')}>{!channel.available ? 'Sem dados' : channel.complete ? 'Completo no exemplo' : 'Falta 14–20 set'}</span></li>)}</ul>
          <p className="text-xs leading-relaxed text-muted-foreground">O funil comercial ainda é demonstrativo. O CRM será desenvolvido após a validação do dashboard. A simulação semanal não grava dados nem envia mensagens ao Hermes.</p>
          <Button variant="outline" className="h-11" onClick={() => setFilter('unavailable', !filters.unavailable)}>{filters.unavailable ? 'Restaurar demonstração' : 'Ver cenário sem dados'}</Button>
        </div>}
        {channelDetail && <div className="space-y-5">
          {!channelDetail.complete && <p className="text-sm text-status-warning">Dados parciais · falta o relatório da última semana.</p>}
          <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3">{(channelDetail.id === 'email' || channelDetail.id === 'whatsapp' ? [
            ['Envios', channelDetail.available ? number(channelDetail.sent) : '—'],
            ['Entregas', channelDetail.available ? number(channelDetail.delivered) : '—'],
            ['Taxa de entrega', channelDetail.available ? percent(rate(channelDetail.delivered, channelDetail.sent)) : '—'],
            [channelDetail.id === 'email' ? 'Destinatários com clique' : 'Contatos que responderam', channelDetail.available ? number(channelDetail.interactions) : '—'],
            ['Leads', channelDetail.available ? number(channelDetail.leads) : '—'],
            ['Qualificados', channelDetail.available ? number(channelDetail.qualified) : '—'],
          ] : [
            ['Leads', channelDetail.available ? number(channelDetail.leads) : '—'],
            ['Qualificados', channelDetail.available ? number(channelDetail.qualified) : '—'],
            ['Oportunidades', channelDetail.available ? number(channelDetail.opportunities) : '—'],
            ['Vendas no período', channelDetail.available ? number(channelDetail.sales) : '—'],
            ['Receita', channelDetail.available ? money(channelDetail.revenue) : '—'],
            ['Investimento em mídia', channelDetail.available ? money(channelDetail.spend) : '—'],
          ]).map(([label, value]) => <div key={label} className="border-t border-border pt-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-xl font-medium tabular-nums">{value}</dd></div>)}</dl>
          <p className="text-xs leading-relaxed text-muted-foreground">{channelDetail.id === 'email' || channelDetail.id === 'whatsapp' ? 'Destinatários únicos da janela. Envios e respostas não representam automaticamente leads novos.' : channelDetail.paid ? 'Investimento considera apenas mídia paga; não inclui produção ou ferramentas.' : 'Origem principal dos leads de conteúdo e site.'}</p>
        </div>}
      </DialogContent>
    </Dialog>
  </div>;
}
