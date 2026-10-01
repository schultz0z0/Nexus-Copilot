import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { LeadIndicators, LeadCharts, LeadCoverage } from '@/components/dashboard/LeadResultsView';
import { leadKeys, type LeadClient } from '@/lib/marketingOps/leads';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type { MarketingOpsCampaign } from '@/lib/marketingOps/types';
import { CampaignOverview } from './CampaignOverview';
import { CampaignReportsDialog } from './CampaignReportsDialog';
import { LeadError } from './LeadUi';

export function CampaignResultsOverview({ campaign, owner, onPlanning, onTeam, onSources, api, ops, readOnly }: { campaign: MarketingOpsCampaign; owner: string; onPlanning: () => void; onTeam: () => void; onSources: () => void; api: LeadClient; ops: MarketingOpsClient; readOnly: boolean }) {
  const [params, setParams] = useSearchParams(); const [open, setOpen] = useState(false);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get('from') ?? '') ? params.get('from')! : undefined;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.get('to') ?? '') ? params.get('to')! : undefined;
  const filters = { campaignId: campaign.id, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const invalid = !!from && !!to && from > to;
  const query = useQuery({ queryKey: leadKeys.results(filters), queryFn: () => api.results(filters), enabled: !invalid });
  const update = (name: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(name, value); else next.delete(name); setParams(next, { replace: true }); };
  return <CampaignOverview campaign={campaign} owner={owner} onPlanning={onPlanning} onTeam={onTeam} resultsContent={<div className="space-y-6">
    <section aria-label="Filtros dos resultados da campanha" className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><div className="space-y-2"><Label htmlFor="campaign-results-from" className="text-xs text-muted-foreground">Resultados a partir de</Label><Input id="campaign-results-from" type="date" className="h-11" value={from ?? ''} onChange={event => update('from', event.target.value)} /></div><div className="space-y-2"><Label htmlFor="campaign-results-to" className="text-xs text-muted-foreground">Resultados até</Label><Input id="campaign-results-to" type="date" className="h-11" value={to ?? ''} onChange={event => update('to', event.target.value)} /></div><Button variant="outline" className="min-h-11" onClick={() => setOpen(true)}>Relatórios de resultados</Button></section>
    {invalid ? <LeadError error={new Error('O fim do período deve ser igual ou posterior ao início.')} /> : <>
      <LeadError error={query.error} retry={() => { void query.refetch(); }} />
      {query.isLoading && <p role="status" className="py-5 text-sm text-muted-foreground">Carregando resultados…</p>}
      {query.data && !query.isError && <>
        <LeadIndicators campaign results={query.data.data} />
        {query.data.data.coverage.sources || query.data.data.coverage.reports ? <LeadCharts results={query.data.data} /> : <section className="rounded-xl border border-border bg-card p-6"><h2 className="text-base font-medium">Resultados ainda não medidos</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Cadastre as fontes e importe contatos ou registre os números medidos. A ausência de medição não representa zero.</p>{!readOnly && <Button variant="link" className="mt-3 min-h-11 p-0" onClick={onSources}>Configurar fontes de captação</Button>}</section>}
        <LeadCoverage results={query.data.data} />
      </>}
    </>}
    {open && <CampaignReportsDialog campaignId={campaign.id} api={api} ops={ops} readOnly={readOnly} onClose={() => setOpen(false)} />}
  </div>} />;
}
