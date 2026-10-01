import { useId } from 'react';
import { ArrowDownRight, ArrowUpRight, BarChart3 } from 'lucide-react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildDashboard, compare, money, number, percent, rate } from '@/lib/dashboard/model';
import { cn } from '@/lib/utils';

export type DashboardModel = ReturnType<typeof buildDashboard>;
export const resultPanel = 'min-w-0 rounded-xl border border-border bg-card p-5 sm:p-6';

export function ResultIndicators({ model, expanded = false }: { model: DashboardModel; expanded?: boolean }) {
  const { current, previous, available, complete } = model;
  const items = [
    { title: 'Novos leads', key: 'leads', currency: false },
    { title: 'Vendas no período', key: 'sales', currency: false },
    { title: 'Receita no período', key: 'revenue', currency: true },
    { title: 'Investimento em mídia', key: 'spend', currency: true },
    ...(expanded ? [
      { title: 'Leads qualificados', key: 'qualified', currency: false },
      { title: 'Oportunidades', key: 'opportunities', currency: false },
    ] : []),
  ] as const;
  return <section aria-label="Indicadores principais" aria-live="polite" className={cn('grid grid-cols-2 gap-x-5 gap-y-7 border-y border-border py-7 sm:gap-x-8', expanded ? 'lg:grid-cols-3' : 'lg:grid-cols-4')}>
    {items.map(item => {
      const value = current[item.key];
      const change = compare(value, previous[item.key]);
      const Icon = change !== null && change < 0 ? ArrowDownRight : ArrowUpRight;
      return <article key={item.key} className="min-w-0">
        <h2 className="text-xs text-text-secondary sm:text-sm">{item.title}</h2>
        <p data-testid={`kpi-${item.title}`} className="mt-3 break-words text-2xl font-medium leading-tight tracking-tight tabular-nums sm:text-3xl">{!available ? '—' : item.currency ? money(value) : number(value)}</p>
        <p className="mt-2 flex min-h-4 items-center gap-1 text-[11px] text-muted-foreground sm:text-xs">
          {!available ? 'Aguardando dados' : !complete ? 'Comparação parcial' : change === null ? 'Sem base anterior' : <><Icon className="h-3.5 w-3.5 shrink-0 text-brand-accent" aria-hidden="true" />{change >= 0 ? '+' : ''}{percent(change)} vs. anterior</>}
        </p>
      </article>;
    })}
  </section>;
}

export function LeadsTrend({ model }: { model: DashboardModel }) {
  const gradient = `leads-${useId().replace(/:/g, '')}`;
  return <section className={resultPanel} aria-label="Evolução dos leads">
    <h2 className="text-lg font-semibold tracking-tight">Evolução dos leads</h2>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-accent" />Atual{!model.complete && model.available ? ' · parcial' : ''}</span>
      <span className="flex items-center gap-2"><span aria-hidden="true" className="w-4 border-t border-dashed border-text-muted" />Anterior</span>
    </div>
    {model.available ? <div className="mt-5 h-[260px] min-w-0" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%"><ComposedChart data={model.trend} margin={{ top: 12, left: -16, right: 10, bottom: 0 }}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={.25} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 6" />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--text-muted))', fontSize: 11 }} dy={8} />
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--text-muted))', fontSize: 11 }} />
        <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--input))', borderRadius: 10, color: 'hsl(var(--foreground))', fontSize: 12 }} itemStyle={{ color: 'hsl(var(--foreground))' }} labelFormatter={label => `Semana de ${label}`} />
        <Area type="monotone" name="Leads do período" dataKey="leads" stroke="hsl(var(--brand-accent))" fill={`url(#${gradient})`} strokeWidth={2.5} isAnimationActive={false} dot={{ r: 3, fill: 'hsl(var(--brand-accent))' }} />
        <Line type="monotone" name="Leads anteriores" dataKey="previousLeads" stroke="hsl(var(--text-muted))" strokeWidth={1.5} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
      </ComposedChart></ResponsiveContainer>
    </div> : <div className="flex h-[280px] flex-col items-center justify-center gap-3 text-center"><BarChart3 className="h-8 w-8 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-text-secondary">Sem resultados disponíveis neste recorte.</p></div>}
    <details className="mt-4 text-xs">
      <summary className="flex min-h-11 cursor-pointer items-center text-brand-accent">Valores e comparação</summary>
      <p className="my-3 leading-relaxed text-muted-foreground">Janelas de igual duração, alinhadas pela posição da semana. {model.available && !model.complete ? 'O atual está incompleto; a diferença não indica necessariamente uma queda real.' : ''}</p>
      {model.available && <table className="w-full text-left"><caption className="sr-only">Leads por semana e período anterior equivalente</caption><thead><tr className="text-muted-foreground"><th className="py-2 font-medium">Semana</th><th className="text-right font-medium">Atual</th><th className="text-right font-medium">Anterior</th></tr></thead><tbody>{model.trend.map(row => <tr key={row.label} className="border-t border-border"><th scope="row" className="py-3 font-normal">{row.label}{!row.complete ? ' · parcial' : ''}</th><td className="text-right tabular-nums">{row.leads === null ? '—' : number(row.leads)}</td><td className="text-right tabular-nums">{row.previousLeads === null ? '—' : number(row.previousLeads)}</td></tr>)}</tbody></table>}
    </details>
  </section>;
}

export function SalesFunnel({ model }: { model: DashboardModel }) {
  const stages = [
    { name: 'Leads', value: model.current.leads },
    { name: 'Qualificados', value: model.current.qualified },
    { name: 'Oportunidades', value: model.current.opportunities },
    { name: 'Propostas', value: model.current.proposals },
    { name: 'Vendas da coorte', value: model.current.won },
  ];
  return <section aria-label="Funil comercial" className={resultPanel}>
    <h2 className="text-lg font-semibold tracking-tight">Funil comercial</h2>
    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Leads captados no período, acompanhados até o corte.</p>
    <ol className="mt-6 space-y-4">{stages.map((stage, index) => <li key={stage.name}>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="text-text-secondary">{stage.name}</span><span className="tabular-nums">{model.available ? number(stage.value) : '—'}</span></div>
      <div className="h-2 rounded-full bg-secondary" aria-hidden="true"><div className="h-full rounded-full bg-brand-secondary" style={{ width: `${model.available ? rate(stage.value, model.current.leads) ?? 0 : 0}%`, opacity: 1 - index * .12 }} /></div>
      {index > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{model.available ? percent(rate(stage.value, stages[index - 1].value)) : '—'} da etapa anterior</p>}
    </li>)}</ol>
    <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">As vendas do topo são fechamentos no período, de todas as coortes. Aqui aparecem apenas as vendas dos leads captados neste recorte. {model.available && !model.complete ? 'Base parcial.' : ''}</p>
  </section>;
}
