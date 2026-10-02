import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Globe, RefreshCw } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AnalyticsProviderSwitch } from '@/components/marketing-ops/AnalyticsProviderSwitch';
import { useAuth } from '@/contexts/AuthContext';
import { marketingOpsFlags } from '@/lib/marketingOps/flags';
import { analyticsClient, analyticsKeys, analyticsProviders, defaultAnalyticsPeriod, validAnalyticsPeriod, type AnalyticsPeriod, type AnalyticsProvider } from '@/lib/marketingOps/analytics';
import { WebAnalyticsResults } from '@/components/dashboard/WebAnalyticsResults';
import { LeadError } from '@/components/marketing-ops/LeadUi';
import { useProposalKey } from '@/components/marketing-ops/leadUiHelpers';

export default function WebAnalyticsPage() {
  const { normalizedRole } = useAuth(); const canRead = normalizedRole === 'admin' || normalizedRole === 'manager'; const canWrite = canRead && marketingOpsFlags(import.meta.env).write;
  const [params, setParams] = useSearchParams(); const qc = useQueryClient(); const [selected, setSelected] = useState<AnalyticsProvider | null>(params.get('provider') === 'clarity' ? 'clarity' : params.get('provider') === 'ga4' ? 'ga4' : null);
  const connections = useQuery({ queryKey: analyticsKeys.connections, queryFn: analyticsClient.connections, enabled: canRead });
  const provider = selected ?? (connections.data?.data.find(row => row.provider === 'ga4')?.selectedResourceId ? 'ga4' : connections.data?.data.find(row => row.provider === 'clarity')?.selectedResourceId ? 'clarity' : 'ga4');
  const connection = connections.data?.data.find(row => row.provider === provider); const resource = connection?.resources.find(row => row.id === connection.selectedResourceId);
  const [filter, setFilter] = useState<AnalyticsPeriod | null>(null); const period = filter ?? defaultAnalyticsPeriod(resource?.timeZone ?? 'UTC');
  const valid = validAnalyticsPeriod(period, resource?.timeZone ?? 'UTC');
  const results = useQuery({ queryKey: analyticsKeys.results(provider, period), queryFn: () => analyticsClient.results(provider, period), enabled: canRead && !!resource && (provider === 'clarity' || valid), retry: false });
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [outcome, setOutcome] = useState(''); const lock = useRef(false); const proposal = useProposalKey();
  const sync = async () => { if (lock.current || !connection || !['connected', 'partial'].includes(connection.status) || (provider === 'ga4' && !valid)) return; lock.current = true; setBusy(true); setError(null); setOutcome(''); try { const response = await analyticsClient.sync(provider, period, proposal({ provider, period, version: connection.version })); proposal.reset(); setOutcome(response.data.status === 'partial' ? 'Leitura concluída com limitações. Confira a cobertura dos dados.' : 'Resultados atualizados.'); await qc.invalidateQueries({ queryKey: analyticsKeys.all }); } catch (issue) { setError(issue); } finally { lock.current = false; setBusy(false); } };
  return <div className="min-h-screen bg-background text-foreground"><Sidebar /><div className="min-w-0 md:pl-20"><MarketingOpsMobileBar label="Análise do site" icon={<Globe aria-hidden="true" className="h-4 w-4" />} /><main className="mx-auto max-w-[1360px] space-y-7 px-4 py-7 pb-24 sm:px-6 md:pb-10 lg:px-10 lg:py-10"><header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-medium tracking-tight sm:text-3xl">Análise do site</h1><p className="mt-2 text-sm text-muted-foreground">Aquisição, navegação e experiência do seu público.</p></div><div className="flex flex-wrap gap-3"><Button asChild variant="outline" className="min-h-11"><Link to="/marketing-ops/workspace?service=google_search_console">Busca orgânica</Link></Button><Button asChild variant="outline" className="min-h-11"><Link to="/settings/integrations?tab=analytics">Gerenciar conexões</Link></Button></div></header>
    {!canRead ? <p className="text-sm text-muted-foreground">A análise geral do site está disponível para gestores e administradores.</p> : <>
      <AnalyticsProviderSwitch value={provider} onChange={next => { setSelected(next); setFilter(null); setError(null); setOutcome(''); setParams({ provider: next }, { replace: true }); }} />
      <LeadError error={connections.error} retry={() => { void connections.refetch(); }} />
      {connections.isLoading && <p role="status">Carregando conexão…</p>}
      {connection && !resource && <section className="space-y-4 rounded-xl border border-border bg-card p-6"><h2 className="font-medium">{connection.status === 'pending_resource' ? 'Escolha sua propriedade' : `Conecte ${analyticsProviders[provider]}`}</h2><p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{provider === 'ga4' ? 'Crie uma propriedade GA4, instale a tag no site e autorize a leitura pelo Prometeus. Sem uma propriedade conectada, não há resultados a exibir.' : 'Cadastre o token de exportação nas integrações. A primeira leitura validará o acesso ao projeto.'}</p><Button asChild className="min-h-11"><Link to="/settings/integrations?tab=analytics">Abrir integrações</Link></Button></section>}
      {resource && <>
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="break-words text-sm font-medium">{resource.name}</p><p className="mt-1 text-xs text-muted-foreground">{provider === 'ga4' ? `Fuso: ${resource.timeZone}` : 'Última janela medida, em UTC'}</p></div><div className="flex flex-wrap items-end gap-3">{provider === 'ga4' && <><div className="space-y-2"><Label htmlFor="analytics-from" className="text-xs">De</Label><Input className="h-11" id="analytics-from" type="date" value={period.from} onChange={event => { setFilter({ ...period, from: event.target.value }); setOutcome(''); }} /></div><div className="space-y-2"><Label htmlFor="analytics-to" className="text-xs">Até</Label><Input className="h-11" id="analytics-to" type="date" value={period.to} max={defaultAnalyticsPeriod(resource.timeZone).to} onChange={event => { setFilter({ ...period, to: event.target.value }); setOutcome(''); }} /></div></>}{canWrite && <Button className="min-h-11" disabled={busy || !['connected', 'partial'].includes(connection.status) || (provider === 'ga4' && !valid)} onClick={() => { void sync(); }}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />{busy ? 'Atualizando…' : 'Atualizar resultados'}</Button>}</div></div>
        {provider === 'ga4' && !valid && <LeadError error={new Error('Escolha até 30 dias completos no fuso da propriedade. O dia atual ainda está em coleta.')} />}
        <p role="status" aria-live="polite" className={outcome ? 'text-sm text-status-success' : 'sr-only'}>{outcome}</p><LeadError error={error || results.error} retry={() => { setError(null); void results.refetch(); }} />
        {results.isLoading && <p role="status">Carregando medições…</p>}{results.data && (provider === 'clarity' || valid) && <WebAnalyticsResults results={results.data.data} />}
        {provider === 'clarity' && /^[A-Za-z0-9_-]{1,100}$/.test(resource.id) && <a className="inline-flex min-h-11 items-center text-sm text-brand-accent" href={`https://clarity.microsoft.com/projects/view/${encodeURIComponent(resource.id)}/dashboard`} target="_blank" rel="noopener noreferrer">Abrir mapas de calor e gravações no Clarity</a>}
      </>}
    </>}
  </main></div></div>;
}
