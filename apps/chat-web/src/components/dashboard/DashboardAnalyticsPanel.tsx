import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LeadError } from '@/components/marketing-ops/LeadUi';
import { useProposalKey, shortDate } from '@/components/marketing-ops/leadUiHelpers';
import { analyticsClient, analyticsKeys, analyticsProviders, defaultAnalyticsPeriod, validAnalyticsPeriod, type AnalyticsClient, type AnalyticsPeriod, type AnalyticsProvider } from '@/lib/marketingOps/analytics';
import type { LeadResults } from '@/lib/marketingOps/leads';
import { buildMarketingInsights } from '@/lib/marketingOps/dashboardInsights';
import { WebAnalyticsResults } from './WebAnalyticsResults';
import { DashboardInsights } from './DashboardInsights';

export function DashboardAnalyticsPanel({ provider, period: selectedPeriod, organic = false, campaignId, leads, canRead, canWrite, api = analyticsClient }: {
  provider: AnalyticsProvider; period?: Partial<AnalyticsPeriod>; organic?: boolean; campaignId?: string; leads?: LeadResults; canRead: boolean; canWrite: boolean; api?: AnalyticsClient;
}) {
  const qc = useQueryClient();
  const connections = useQuery({ queryKey: analyticsKeys.connections, queryFn: api.connections, enabled: canRead, retry: false });
  const connection = connections.data?.data.find(row => row.provider === provider);
  const resource = connection?.resources.find(row => row.id === connection.selectedResourceId);
  const defaults = defaultAnalyticsPeriod(resource?.timeZone ?? 'UTC');
  const period = { from: selectedPeriod?.from ?? defaults.from, to: selectedPeriod?.to ?? defaults.to };
  const valid = validAnalyticsPeriod(period, resource?.timeZone ?? 'UTC');
  const scope = organic ? 'organic' as const : undefined;
  // Clarity keeps its rolling window; the combined endpoint also validates GA4.
  const ga4Connection = connections.data?.data.find(row => row.provider === 'ga4');
  const ga4Resource = ga4Connection?.resources.find(row => row.id === ga4Connection.selectedResourceId);
  const campaignPeriod = provider === 'clarity' ? defaultAnalyticsPeriod(ga4Resource?.timeZone ?? 'UTC') : period;
  const general = useQuery({ queryKey: analyticsKeys.results(provider, period, scope), queryFn: () => api.results(provider, period, scope), enabled: canRead && !campaignId && !!resource && (provider === 'clarity' || valid), retry: false });
  const campaign = useQuery({ queryKey: analyticsKeys.campaign(campaignId ?? '', campaignPeriod), queryFn: () => api.campaignResults(campaignId!, campaignPeriod), enabled: canRead && !!campaignId && !!resource && (provider === 'clarity' || valid), retry: false });
  const measured = campaignId ? campaign.data?.data[provider] : general.data?.data;
  const read = campaignId ? campaign : general;
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [outcome, setOutcome] = useState(''); const lock = useRef(false); const proposal = useProposalKey();
  const sync = async () => {
    if (lock.current || !canWrite || !connection || !['connected', 'partial'].includes(connection.status) || (provider === 'ga4' && !valid)) return;
    lock.current = true; setBusy(true); setError(null); setOutcome('');
    try {
      const response = await api.sync(provider, period, proposal({ provider, period, version: connection.version }));
      proposal.reset(); setOutcome(response.data.status === 'partial' ? 'Leitura concluída com limitações. Confira a cobertura.' : 'Leitura atualizada.');
      await qc.invalidateQueries({ queryKey: analyticsKeys.all });
    } catch (issue) { setError(issue); } finally { lock.current = false; setBusy(false); }
  };
  if (!canRead) return <p className="text-sm text-muted-foreground">A análise do site está disponível para gestores e administradores.</p>;
  return <section aria-label={`${analyticsProviders[provider]}${organic ? ' orgânico' : campaignId ? ' da campanha' : ''}`} className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h2 className="text-xl font-medium">{organic ? 'Navegação orgânica' : campaignId ? 'Navegação atribuída à campanha' : analyticsProviders[provider]}</h2>
      <p className="mt-2 break-words text-sm text-muted-foreground">{resource?.name ?? analyticsProviders[provider]}</p>
      {resource && <p className="mt-2 text-xs text-muted-foreground">{provider === 'ga4' ? `${shortDate(period.from)} a ${shortDate(period.to)} · Fuso: ${resource.timeZone}` : 'Última janela móvel de 24 horas · UTC. O filtro do dashboard não recorta esta leitura.'}</p>}
    </div>{canWrite && resource && <Button variant="outline" className="min-h-11" disabled={busy || !['connected', 'partial'].includes(connection?.status ?? '') || (provider === 'ga4' && !valid)} onClick={() => { void sync(); }}><RefreshCw aria-hidden="true" className="h-4 w-4" />{busy ? 'Atualizando…' : `Atualizar ${analyticsProviders[provider]}`}</Button>}</header>
    {organic && <p className="text-xs leading-relaxed text-muted-foreground">Recorte por grupos de sessão: Organic Search, Organic Social, Organic Video e Organic Shopping. Não inclui tráfego pago, direto ou por referência. Sessões e eventos não são leads nem vendas.</p>}
    {organic && measured?.warnings.includes('analytics_organic_not_measured') && <p role="status" className="text-sm leading-relaxed text-status-warning">Esta leitura antiga ainda não mede os canais orgânicos. Use Atualizar Google Analytics para coletar esse recorte; o total geral do site não substitui esses dados.</p>}
    {campaignId && <p className="text-xs leading-relaxed text-muted-foreground">Somente valores exatos de utm_campaign vinculados à campanha. O nome interno não atribui visitas. Sessões não são somadas aos leads.</p>}
    <LeadError error={connections.error} retry={() => { void connections.refetch(); }} />
    {connections.isLoading && <p role="status">Carregando conexão de {analyticsProviders[provider]}…</p>}
    {!connections.isLoading && !connections.isError && !resource && <div className="space-y-3 rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">{connection?.status === 'pending_resource' ? 'Escolha a propriedade para visualizar os resultados.' : `Conecte ${analyticsProviders[provider]} para visualizar medições reais.`} A ausência de conexão não representa zero.</p><Button asChild variant="outline" className="min-h-11"><Link to="/settings/integrations?tab=analytics">Configurar conexão</Link></Button></div>}
    {resource && provider === 'ga4' && !valid && <LeadError error={new Error('Escolha até 30 dias completos no fuso da propriedade. O dia atual ainda está em coleta.')} />}
    <p role="status" aria-live="polite" className={outcome ? 'text-sm text-status-success' : 'sr-only'}>{outcome}</p>
    <LeadError error={error || read.error} retry={() => { setError(null); void read.refetch(); }} />
    {read.isLoading && resource && <p role="status">Carregando leitura de {analyticsProviders[provider]}…</p>}
    {measured && !read.isError && (provider === 'clarity' || valid) && <><WebAnalyticsResults results={measured} />{(organic || (campaignId && provider === 'ga4')) && <DashboardInsights items={buildMarketingInsights({ scope: organic ? 'organic' : 'campaigns', leads, ...(organic ? { organic: measured } : { ga4: measured }), campaignSelected: !!campaignId, period })} />}</>}
    {campaignId && campaign.data && !measured && <div className="space-y-3 rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Nenhuma leitura atribuída neste recorte. Confira os parâmetros UTM vinculados na campanha e atualize a fonte.</p><Link className="inline-flex min-h-11 items-center text-sm text-brand-accent" to={`/marketing-ops/campaigns/${campaignId}?tab=analytics`}>Revisar vínculos da campanha</Link></div>}
    {provider === 'clarity' && resource && /^[A-Za-z0-9_-]{1,100}$/.test(resource.id) && <a className="inline-flex min-h-11 items-center text-sm text-brand-accent" href={`https://clarity.microsoft.com/projects/view/${encodeURIComponent(resource.id)}/dashboard`} target="_blank" rel="noopener noreferrer">Abrir mapas de calor e gravações no Clarity</a>}
  </section>;
}
