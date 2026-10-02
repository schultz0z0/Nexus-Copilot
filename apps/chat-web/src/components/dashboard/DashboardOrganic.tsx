import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LeadError } from '@/components/marketing-ops/LeadUi';
import { SearchConsoleResults } from '@/components/marketing-ops/SearchConsoleResults';
import { workspaceClient, workspaceKeys, type WorkspaceClient, type SearchConsoleReport } from '@/lib/marketingOps/workspace';
import type { AnalyticsClient, AnalyticsPeriod } from '@/lib/marketingOps/analytics';
import type { LeadResults } from '@/lib/marketingOps/leads';
import { buildMarketingInsights } from '@/lib/marketingOps/dashboardInsights';
import { DashboardInsights } from './DashboardInsights';
import { DashboardAnalyticsPanel } from './DashboardAnalyticsPanel';
import { count } from '@/components/marketing-ops/leadUiHelpers';

export function DashboardOrganic({ source, onSourceChange, period, leads, canRead, canWrite, analytics, workspace = workspaceClient }: {
  source: 'search' | 'ga4'; onSourceChange: (source: 'search' | 'ga4') => void; period?: Partial<AnalyticsPeriod>; leads?: LeadResults; canRead: boolean; canWrite: boolean; analytics: AnalyticsClient; workspace?: WorkspaceClient;
}) {
  const connections = useQuery({ queryKey: workspaceKeys.connections, queryFn: workspace.connections, enabled: canRead && source === 'search', retry: false });
  const connection = connections.data?.data.find(row => row.service === 'google_search_console');
  const reportKey = `${connection?.generation}:${connection?.selectedResource?.id}:${period?.from ?? ''}:${period?.to ?? ''}`;
  const [savedReport, setReport] = useState<{ key: string; report: SearchConsoleReport | null } | null>(null);
  const onReport = useCallback((report: SearchConsoleReport | null) => setReport({ key: reportKey, report }), [reportKey]);
  const report = savedReport?.key === reportKey ? savedReport.report : null;
  if (!canRead) return <p className="text-sm text-muted-foreground">A análise orgânica está disponível para gestores e administradores.</p>;
  return <section className="space-y-7" aria-label="Insights orgânicos">
    <div><h2 className="text-xl font-medium tracking-tight">Descoberta e navegação orgânica</h2><p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">Entenda como seu público encontra o site e o que faz depois. Esta leitura abrange o site; o filtro de campanha não atribui tráfego orgânico automaticamente.</p></div>
    <Tabs value={source} onValueChange={value => onSourceChange(value as 'search' | 'ga4')}><TabsList className="h-auto min-h-11 flex-wrap"><TabsTrigger value="search" className="min-h-11">Busca no Google</TabsTrigger><TabsTrigger value="ga4" className="min-h-11">Navegação orgânica</TabsTrigger></TabsList>
      <TabsContent value="search" className="mt-6 space-y-6"><LeadError error={connections.error} retry={() => { void connections.refetch(); }} />
        {connections.isLoading && <p role="status">Carregando conexão do Search Console…</p>}
        {connection?.selectedResource && !connections.isError ? <><SearchConsoleResults key={`${connection.generation}:${connection.selectedResource.id}`} connection={connection} api={workspace} canManage={canWrite} period={period} embedded onReport={onReport} /><DashboardInsights items={buildMarketingInsights({ scope: 'organic', search: report, period: report ? { from: report.from, to: report.to } : undefined })} /></> : !connections.isLoading && !connections.isError && <div className="space-y-3 rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Conecte uma propriedade do Search Console para consultar cliques, pesquisas e páginas encontradas.</p><Link className="inline-flex min-h-11 items-center text-sm text-brand-accent" to="/settings/integrations?tab=workspace&service=google_search_console">Configurar Search Console</Link></div>}
      </TabsContent>
      <TabsContent value="ga4" className="mt-6"><DashboardAnalyticsPanel provider="ga4" organic period={period} canRead={canRead} canWrite={canWrite} api={analytics} /></TabsContent>
    </Tabs>
    <details className="border-t border-border pt-3 text-sm"><summary className="flex min-h-11 cursor-pointer items-center text-brand-accent">Prospecção e contatos frios</summary><div className="mt-3 space-y-2 rounded-xl border border-border bg-card p-5"><p>{count(leads?.contactsCold ?? null)} contatos frios registrados no recorte comercial.</p><p className="text-xs leading-relaxed text-muted-foreground">Listas prospectadas no Google Maps e outras fontes são contatos frios. Permanecem separados de visitas, cliques e leads identificados. A identificação do canal de um lead depende da sua fonte de captação.</p></div></details>
  </section>;
}
