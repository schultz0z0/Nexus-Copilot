import type { AnalyticsResults } from './analytics';
import type { LeadResults } from './leads';
import type { SearchConsoleReport } from './workspace';

export interface DashboardInsight {
  id: string;
  title: string;
  evidence: string;
  action: string;
  source: string;
  href?: string;
  tone: 'neutral' | 'attention';
}
export interface MarketingInsightInput {
  scope: 'overview' | 'organic' | 'campaigns';
  leads?: LeadResults;
  organic?: AnalyticsResults | null;
  search?: SearchConsoleReport | null;
  ga4?: AnalyticsResults | null;
  clarity?: AnalyticsResults | null;
  campaignSelected?: boolean;
  attributionChecked?: boolean;
  campaignId?: string;
  period?: { from: string; to: string };
}
const number = (value: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
const displayDate = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
const displayStamp = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value));
const range = (value: { from: string; to: string }) => `${displayDate(value.from)} a ${displayDate(value.to)}`;
const limited = (value: AnalyticsResults) => value.stale || value.warnings.some(w => ['analytics_thresholded', 'analytics_sampled', 'analytics_other_row', 'analytics_incomplete_coverage', 'analytics_organic_not_measured', 'analytics_segment_not_measured'].includes(w));

/** Rules describe the observed slice. They never infer people or a sales cohort. */
export function buildMarketingInsights(input: MarketingInsightInput): DashboardInsight[] {
  const insights: DashboardInsight[] = [];
  const { scope, leads, organic, search, ga4, clarity } = input;
  const period = input.period ? ` · ${range(input.period)}` : ' · recorte dos registros disponíveis';
  const add = (item: DashboardInsight) => insights.push(item);
  if (scope !== 'organic' && leads) {
    if (leads.coverage.partialReportsExcluded > 0) add({ id: 'commercial-period', title: 'Há relatórios fora do recorte', evidence: `${number(leads.coverage.partialReportsExcluded)} relatórios foram excluídos por cruzarem as datas escolhidas${period}.`, action: 'Amplie o período para incluir os relatórios completos antes de comparar resultados.', source: 'Resultados registrados', tone: 'attention' });
    const absent = (['qualified', 'sales', 'revenue', 'spend'] as const).filter(k => leads[k] === null);
    const labels = { qualified: 'qualificação', sales: 'vendas', revenue: 'receita', spend: 'investimento' };
    if (absent.length) add({ id: 'commercial-coverage', title: 'Complete a medição do funil', evidence: `Sem medição de ${absent.map(k => labels[k]).join(', ')}${period}.`, action: 'Revise os informes nas campanhas. Os valores ausentes impedem avaliar o retorno da operação.', source: 'Resultados registrados', href: '/marketing-ops/dashboard?tab=campaigns', tone: 'attention' });
  }
  if (scope === 'organic') {
    if (organic && (!organic.totals || limited(organic))) add({ id: 'organic-coverage', title: 'Confira a cobertura do orgânico', evidence: `${organic.stale ? 'Leitura desatualizada' : !organic.totals ? 'Recorte ainda não medido' : 'Leitura parcial'} · ${range(organic)}.`, action: 'Atualize o GA4 e confira as limitações antes de interpretar engajamento ou resultados.', source: 'GA4 · canais orgânicos', tone: 'attention' });
    if (search && (!search.totals || search.truncated || search.stale)) add({ id: 'search-coverage', title: 'Revise a leitura da busca', evidence: `${search.stale ? 'Leitura desatualizada' : search.truncated ? 'Detalhes parciais' : 'Sem leitura salva'} · ${range(search)}.`, action: 'Atualize o Search Console. Distribuições parciais não identificam todas as páginas e pesquisas.', source: 'Search Console', tone: 'attention' });
    if (search?.totals && !search.truncated && !search.stale) {
      // Compare CTR only with the same property's aggregate, with a visible exposure floor.
      const candidate = [...search.pages].filter(p => p.impressions >= 100 && p.ctr < search.totals!.ctr).sort((a, b) => b.impressions - a.impressions)[0];
      if (candidate) add({ id: 'search-page-opportunity', title: 'Uma página merece revisão na busca', evidence: `${candidate.page}: ${number(candidate.impressions)} impressões e ${number(candidate.clicks)} cliques. CTR ${number(candidate.ctr * 100)}%, frente a ${number(search.totals.ctr * 100)}% da propriedade · ${range(search)}.`, action: 'Revise o título, a descrição e as pesquisas que levam à página; posição e intenção também influenciam os cliques.', source: 'Search Console', tone: 'neutral' });
    }
    if (organic?.totals && !limited(organic)) {
      const total = organic.totals;
      const engagement = total.sessions > 0 && total.engagedSessions !== null ? ` · ${number(total.engagedSessions / total.sessions * 100)}% de sessões engajadas` : '';
      add({ id: 'organic-engagement', title: total.sessions > 0 ? 'O orgânico já traz visitas' : 'Nenhuma sessão orgânica nesta leitura', evidence: `${number(total.sessions)} sessões${engagement} · ${range(organic)}.`, action: total.sessions > 0 ? 'Confira as páginas e os formulários de destino. Eventos do site precisam de vínculo para acompanhar leads identificados.' : 'Confira as tags e a descoberta na busca antes de concluir que suas ações não tiveram alcance.', source: 'GA4 · canais orgânicos', tone: 'neutral' });
    }
    if (leads && leads.contactsCold > 0) add({ id: 'cold-prospecting', title: 'Prospecção separada da captação', evidence: `${number(leads.contactsCold)} contatos frios registrados${period}. Eles não entram como leads identificados.`, action: 'Qualifique os contatos e registre a evolução antes de atribuir resultados à prospecção.', source: 'Contatos registrados', href: '/marketing-ops/dashboard?tab=campaigns', tone: 'neutral' });
  }
  if (scope === 'campaigns') {
    if (input.campaignSelected && input.attributionChecked !== false && (!ga4?.totals || limited(ga4))) add({ id: 'campaign-attribution', title: 'Revise a atribuição da navegação', evidence: ga4 ? `Sem leitura completa vinculada · ${range(ga4)}.` : 'Ainda não há leitura de navegação vinculada a esta campanha.', action: 'Confira o parâmetro UTM exato na página da campanha e atualize a leitura do site.', source: 'GA4 · vínculos UTM', tone: 'attention' });
    if (!input.campaignSelected && leads?.campaigns.length) {
      const campaign = [...leads.campaigns].sort((a, b) => b.capturedLeads - a.capturedLeads)[0];
      if (campaign.capturedLeads > 0) add({ id: 'campaign-capture', title: 'Aprofunde a campanha com mais captação', evidence: `${campaign.name}: ${number(campaign.capturedLeads)} leads identificados${period}.`, action: 'Compare qualificação, investimento e vendas nos detalhes antes de decidir onde ampliar as ações.', source: 'Leads identificados', href: `/marketing-ops/campaigns/${campaign.id}`, tone: 'neutral' });
    }
  }
  if (scope === 'overview' && ga4) {
    add(ga4.totals && !limited(ga4) ? { id: 'site-traffic', title: 'Consulte o caminho até o site', evidence: `${number(ga4.totals.sessions)} sessões no site · ${range(ga4)}.`, action: 'Abra a análise do site para investigar as origens. O total inclui tráfego pago e orgânico.', source: 'GA4 · site completo', href: '/marketing-ops/dashboard?tab=overview&detail=site&provider=ga4', tone: 'neutral' } : { id: 'site-coverage', title: 'A leitura do site precisa de atenção', evidence: `${ga4.stale ? 'Leitura desatualizada' : 'Sem leitura completa'} · ${range(ga4)}.`, action: 'Abra a análise do site e confira a cobertura e a última atualização.', source: 'GA4 · site completo', href: '/marketing-ops/dashboard?tab=overview&detail=site&provider=ga4', tone: 'attention' });
  }
  if (scope === 'overview' && clarity?.totals && clarity.window) add({ id: 'clarity-window', title: 'Investigue a experiência recente', evidence: `${number(clarity.totals.sessions)} sessões · ${displayStamp(clarity.window.from)} a ${displayStamp(clarity.window.to)} (UTC)${clarity.stale ? ' · leitura desatualizada' : ''}.`, action: 'Abra o Clarity para investigar mapas de calor e gravações; esta janela é independente do período do GA4.', source: 'Clarity · janela móvel', href: '/marketing-ops/dashboard?tab=overview&detail=site&provider=clarity', tone: clarity.stale ? 'attention' : 'neutral' });
  return insights.slice(0, 3).map(item => {
    if (!item.href || !input.period) return item;
    const [path, query] = item.href.split('?');
    const params = new URLSearchParams(query);
    params.set('from', input.period.from); params.set('to', input.period.to);
    if (input.campaignId && path === '/marketing-ops/dashboard') params.set('campaignId', input.campaignId);
    return { ...item, href: `${path}?${params}` };
  });
}
