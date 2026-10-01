import { ArrowRight, BarChart3, CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { MarketingOpsCampaign } from '@/lib/marketingOps/types';
import type { ReactNode } from 'react';

const channelNames: Record<string, string> = {
  google: 'Google Ads', google_ads: 'Google Ads', meta: 'Meta Ads', meta_ads: 'Meta Ads',
  linkedin: 'LinkedIn', linkedin_ads: 'LinkedIn Ads', email: 'E-mail', whatsapp: 'WhatsApp',
  organic: 'Orgânico', instagram: 'Instagram', facebook: 'Facebook', website: 'Site',
  paid_media: 'Mídia paga', events: 'Eventos', press: 'Imprensa', other: 'Outro',
};
const date = (value: string | null) => value ? value.split('-').reverse().join('/') : 'Não definido';

// This view receives only persisted campaign fields. It must never import fixtures
// from lib/dashboard: the demonstration does not establish measured results.
export function CampaignOverview({ campaign, owner, onPlanning, onTeam, resultsContent }: {
  campaign: MarketingOpsCampaign;
  owner: string;
  onPlanning: () => void;
  onTeam: () => void;
  resultsContent?: ReactNode;
}) {
  return <div className="mx-auto max-w-5xl space-y-8 px-4 py-7 sm:px-6 md:px-8">
    {resultsContent ?? <><section aria-label="Indicadores da campanha" className="grid grid-cols-2 gap-6 border-b border-border pb-7 sm:grid-cols-4">
      {['Novos leads', 'Vendas', 'Receita', 'Investimento em mídia'].map(label => <div key={label}><h2 className="text-xs text-muted-foreground">{label}</h2><p className="mt-2 text-3xl tabular-nums" aria-label={`${label}: ainda não medido`}>—</p></div>)}
    </section>
    <section aria-labelledby="campaign-results-empty" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-start">
      <BarChart3 className="h-6 w-6 shrink-0 text-brand-accent" aria-hidden="true" />
      <div><h2 id="campaign-results-empty" className="text-base font-medium">Resultados ainda não medidos</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Esta campanha ainda não tem resultados registrados. Os indicadores e gráficos aparecerão aqui quando os dados estiverem disponíveis. A ausência de medição não representa resultado zero.</p></div>
    </section>
    </>}
    <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
      <section aria-label="Resumo da campanha">
        <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold tracking-tight">Direção da campanha</h2><Button variant="ghost" className="h-11 text-brand-accent" onClick={onPlanning}>Ver planejamento<ArrowRight className="h-4 w-4" /></Button></div>
        <dl className="mt-4 space-y-6 text-sm"><div><dt className="text-xs text-muted-foreground">Objetivo</dt><dd className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{campaign.objective || 'Objetivo ainda não definido.'}</dd></div><div><dt className="text-xs text-muted-foreground">Público</dt><dd className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-text-secondary">{campaign.audience || 'Público ainda não definido.'}</dd></div><div><dt className="text-xs text-muted-foreground">Oferta ou iniciativa</dt><dd className="mt-2 break-words text-text-secondary">{campaign.referenceTitleSnapshot || campaign.referenceKey || 'Não definida'}</dd></div></dl>
      </section>
      <section aria-label="Organização da campanha" className="rounded-xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 text-base font-medium"><CalendarDays className="h-4 w-4 text-brand-accent" aria-hidden="true" />Período e canais</h2>
        <dl className="mt-5 space-y-5 text-sm"><div><dt className="text-xs text-muted-foreground">Período planejado</dt><dd className="mt-2 tabular-nums">{date(campaign.startsOn)} → {date(campaign.endsOn)}</dd></div><div><dt className="text-xs text-muted-foreground">Canal principal</dt><dd className="mt-2 break-words">{campaign.primaryChannel ? channelNames[campaign.primaryChannel] ?? campaign.primaryChannel : 'Não definido'}</dd></div>{campaign.secondaryChannels.length > 0 && <div><dt className="text-xs text-muted-foreground">Canais de apoio</dt><dd className="mt-2 break-words text-text-secondary">{campaign.secondaryChannels.map(channel => channelNames[channel] ?? channel).join(' · ')}</dd></div>}<div><dt className="text-xs text-muted-foreground">Responsável principal</dt><dd className="mt-2 break-words">{owner}</dd></div></dl>
        <Button variant="link" className="mt-3 min-h-11 p-0" onClick={onTeam}>Ver equipe<ArrowRight /></Button>
      </section>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"><p className="text-sm text-muted-foreground">Acompanhe as ações vinculadas a esta campanha.</p><Button asChild variant="outline" className="h-11"><Link to={`/marketing-ops/production?campaignId=${encodeURIComponent(campaign.id)}`}>Abrir ações da campanha<ArrowRight /></Link></Button></div>
  </div>;
}
