import { Link } from 'react-router-dom';
import { ArrowUpRight, Info } from 'lucide-react';
import type { DashboardInsight } from '@/lib/marketingOps/dashboardInsights';

export function DashboardInsights({ items }: { items: DashboardInsight[] }) {
  if (!items.length) return null;
  return <section aria-label="Insights e próximos passos" className="space-y-4">
    <h2 className="text-lg font-medium tracking-tight">O que merece atenção</h2>
    <div className="grid gap-4 lg:grid-cols-3">{items.slice(0, 3).map(item => <article key={item.id} className="min-w-0 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3"><Info aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${item.tone === 'attention' ? 'text-status-warning' : 'text-brand-accent'}`} /><h3 className="text-sm font-medium leading-relaxed">{item.title}</h3></div>
      <p className="mt-3 break-words text-sm leading-relaxed text-text-secondary">{item.evidence}</p>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{item.source}</p>
      {item.href ? <Link to={item.href} className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm text-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.action}<ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0" /></Link> : <p className="mt-4 text-sm leading-relaxed">{item.action}</p>}
    </article>)}</div>
  </section>;
}
