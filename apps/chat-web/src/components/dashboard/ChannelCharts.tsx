import { useId, useState } from 'react';
import { ArrowUpRight, BarChart3, ChartPie } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildDashboard, money, number, percent, rate, type ChannelId } from '@/lib/dashboard/model';

type Dashboard = ReturnType<typeof buildDashboard>;
type Props = { model: Dashboard; onChannelDetails: (id: ChannelId) => void };

// Stable channel colors taken from the existing brand tokens, never status hues.
const channelColors: Record<ChannelId, string> = {
  google: 'hsl(var(--brand-accent))', meta: 'hsl(var(--brand-secondary))',
  linkedin: 'hsl(var(--prometeus-white))', organic: 'hsl(var(--prometeus-slate))',
  email: 'hsl(var(--prometeus-mist))', whatsapp: 'hsl(var(--primary))',
};
const tooltipStyle = {
  background: 'hsl(var(--popover))', border: '1px solid hsl(var(--input))',
  borderRadius: 10, color: 'hsl(var(--foreground))', fontSize: 12,
};
const panel = 'min-w-0 rounded-xl border border-border bg-card p-5 sm:p-6';

export function ChannelDistribution({ model, onChannelDetails }: Props) {
  const [highlighted, setHighlighted] = useState<ChannelId | null>(null);
  const pattern = useId().replace(/:/g, '');
  const shares = model.channels.filter(channel => channel.available && channel.leads > 0);
  const selected = shares.find(channel => channel.id === highlighted);
  return <section className={panel} aria-label="Distribuição de leads por canal">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold tracking-tight">Origem dos leads</h2><p className="mt-1 text-xs text-muted-foreground">Selecione um canal para ver os resultados</p></div>
        <ChartPie className="mt-1 h-5 w-5 shrink-0 text-brand-accent" aria-hidden="true" />
      </div>
      {shares.length ? <>
        <div className="grid items-center gap-3 sm:grid-cols-[minmax(180px,.9fr)_minmax(0,1.1fr)]">
          <div className="relative mx-auto h-[250px] w-full max-w-[270px]" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <defs><pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill={channelColors.organic} /><line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--brand-accent))" strokeWidth="2" /></pattern></defs>
                <Pie data={shares} dataKey="leads" nameKey="name" cx="50%" cy="50%" innerRadius="65%" outerRadius="88%" paddingAngle={shares.length > 1 ? 3 : 0} startAngle={90} endAngle={-270} stroke="hsl(var(--card))" strokeWidth={2} cornerRadius={3} isAnimationActive={false} rootTabIndex={-1}
                  onMouseEnter={(_, index) => setHighlighted(shares[index].id)} onMouseLeave={() => setHighlighted(null)}>
                  {shares.map(channel => <Cell key={channel.id} fill={channel.id === 'organic' ? `url(#${pattern})` : channelColors[channel.id]} opacity={selected && channel.id !== selected.id ? .35 : 1} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-14 text-center">
              <span className="text-3xl font-medium tracking-tight tabular-nums" data-testid="distribution-total">{number(selected?.leads ?? model.current.leads)}</span>
              <span className="mt-1 text-xs text-muted-foreground">{selected?.name ?? 'leads no recorte'}</span>
              {selected && <span className="mt-2 text-xs text-brand-accent">{percent(rate(selected.leads, model.current.leads))} do total disponível</span>}
            </div>
          </div>
          <ul className="space-y-1 py-3" aria-label="Participação dos canais e acesso aos detalhes">
            {model.channels.map(channel => <li key={channel.id}>
              <button type="button" aria-label={`Ver detalhes de ${channel.name}`} aria-describedby={`${pattern}-${channel.id}-share`} onClick={() => onChannelDetails(channel.id)}
                onMouseEnter={() => setHighlighted(channel.id)} onMouseLeave={() => setHighlighted(null)} onFocus={() => setHighlighted(channel.id)} onBlur={() => setHighlighted(null)}
                className="group flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-secondary/50 focus-visible:bg-secondary/50">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-inset ring-foreground/20" style={{ background: channelColors[channel.id] }} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-xs text-text-secondary">{channel.name}{!channel.complete && <span className="ml-1 text-status-warning">*</span>}</span>
                <span className="text-xs tabular-nums">{channel.available ? number(channel.leads) : '—'}</span>
                <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{channel.available ? percent(rate(channel.leads, model.current.leads)) : '—'}</span>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-brand-accent" aria-hidden="true" />
              </button>
              <span id={`${pattern}-${channel.id}-share`} className="sr-only">{channel.available ? `${number(channel.leads)} leads, ${percent(rate(channel.leads, model.current.leads))} dos registros disponíveis. ${channel.complete ? 'Dados completos.' : 'Dados parciais.'}` : 'Sem dados disponíveis para este canal.'}</span>
            </li>)}
          </ul>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{!model.complete ? 'Participação sobre os dados disponíveis · WhatsApp parcial.' : 'Uma origem principal por lead · percentuais arredondados.'}</p>
      </> : <div className="flex min-h-[285px] flex-col items-center justify-center gap-3 text-center"><ChartPie className="h-9 w-9 text-muted-foreground" /><p className="text-sm text-text-secondary">{model.available ? 'Nenhum lead registrado neste recorte.' : 'Sem registros para distribuir.'}</p><p className="max-w-xs text-xs text-muted-foreground">A participação aparece quando houver leads informados.</p></div>}
    </section>;
}

export function PaidInvestment({ model }: { model: Dashboard }) {
  const paid = model.channels.filter(channel => channel.paid && channel.available);
  const hasPaidChannels = model.channels.some(channel => channel.paid);
  const maxSpend = Math.max(1, ...paid.map(channel => channel.spend));
  return <section className={panel} aria-label="Investimento por plataforma">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold tracking-tight">Como a mídia está distribuída</h2><p className="mt-1 text-xs text-muted-foreground">Google Ads, Meta Ads e LinkedIn Ads</p></div>
        <div className="text-right"><p className="text-xl font-medium tabular-nums">{paid.length ? money(model.current.spend) : '—'}</p><p className="text-[11px] text-muted-foreground">investimento no recorte</p></div>
      </div>
      {paid.length ? <>
        <div className="mt-6 h-[210px] w-full min-w-0" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={paid} layout="vertical" margin={{ top: 0, right: 76, left: 0, bottom: 0 }} barSize={24}>
              <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 5" />
              <XAxis type="number" domain={[0, maxSpend]} tickCount={3} axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--text-muted))', fontSize: 10 }} tickFormatter={value => money(Number(value))} />
              <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={80} tick={{ fill: 'hsl(var(--text-secondary))', fontSize: 11 }} />
              <Tooltip cursor={{ fill: 'hsl(var(--secondary))', fillOpacity: .4 }} contentStyle={tooltipStyle} itemStyle={{ color: 'hsl(var(--foreground))' }} formatter={(value: number) => [money(value), 'Investimento']} />
              <Bar dataKey="spend" name="Investimento" fill="hsl(var(--brand-secondary))" stroke="hsl(var(--brand-accent))" strokeWidth={1} radius={[0, 5, 5, 0]} isAnimationActive={false}>
                <LabelList dataKey="spend" position="right" fill="hsl(var(--foreground))" fontSize={11} offset={8} formatter={(value: number) => money(value)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-2 border-t border-border pt-3 text-xs">
          <summary className="cursor-pointer py-1 text-brand-accent">Ver valores de investimento</summary>
          <table className="mt-3 w-full text-left"><caption className="sr-only">Investimento em mídia por plataforma</caption><thead><tr className="text-muted-foreground"><th className="py-2 font-medium">Plataforma</th><th className="text-right font-medium">Investimento</th></tr></thead><tbody>{paid.map(channel => <tr key={channel.id} className="border-t border-border"><th scope="row" className="py-2 font-normal">{channel.name}</th><td className="text-right tabular-nums">{money(channel.spend)}</td></tr>)}</tbody></table>
        </details>
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-background px-4 py-3"><span className="text-xs text-muted-foreground">Custo por lead qualificado pago</span><strong className="text-sm font-medium tabular-nums text-brand-accent">{model.costPerQualified === null ? '—' : money(model.costPerQualified, 2)}</strong></div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">Base: {number(model.paidQualified)} qualificados dos canais pagos. Custos de produção, e-mail e WhatsApp não entram nesta comparação.</p>
      </> : <div className="flex min-h-[285px] flex-col items-center justify-center gap-3 text-center"><BarChart3 className="h-9 w-9 text-muted-foreground" /><p className="text-sm text-text-secondary">{hasPaidChannels ? 'Investimento ainda não informado.' : 'Sem mídia paga neste recorte.'}</p><p className="max-w-xs text-xs text-muted-foreground">{hasPaidChannels ? 'A ausência de dados não representa gasto zero.' : 'Selecione um canal de anúncios ou todos os canais para comparar o investimento.'}</p></div>}
    </section>;
}

export function ChannelCharts(props: Props) {
  return <div className="grid gap-6 xl:grid-cols-2"><ChannelDistribution {...props} /><PaidInvestment model={props.model} /></div>;
}
