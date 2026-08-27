import { AlertTriangle, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  dateKeyInTimeZone,
  type ProductionCalendarView
} from '@/lib/marketingOps/timezone';
import type {
  MarketingOpsItemPriority,
  MarketingOpsItemStatus,
  MarketingOpsProductionScheduleItem
} from '@/lib/marketingOps/types';
import { cn } from '@/lib/utils';

interface ProductionCalendarProps {
  view: ProductionCalendarView;
  anchorDate: string;
  days: string[];
  items: MarketingOpsProductionScheduleItem[];
  timeZone: string;
  onOpen: (itemId: string) => void;
}

const statusLabels: Record<MarketingOpsItemStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronto',
  in_review: 'Em revisão',
  completed: 'Concluído',
  cancelled: 'Cancelado'
};

const priorityLabels: Record<MarketingOpsItemPriority, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente'
};

const itemClasses: Record<MarketingOpsItemStatus, string> = {
  draft: 'border-slate-300 bg-slate-50 text-slate-800',
  ready: 'border-cyan-300 bg-cyan-50 text-cyan-950',
  in_review: 'border-violet-300 bg-violet-50 text-violet-950',
  completed: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  cancelled: 'border-zinc-300 bg-zinc-100 text-zinc-700'
};

function itemDate(item: MarketingOpsProductionScheduleItem, timeZone: string): string | null {
  if (!item.effectiveAt) return null;
  try {
    return dateKeyInTimeZone(item.effectiveAt, timeZone);
  } catch {
    return null;
  }
}

function formatDay(day: string, timeZone: string, weekday: 'short' | 'long'): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday,
    day: '2-digit',
    month: weekday === 'long' ? 'long' : 'short'
  }).format(new Date(`${day}T12:00:00.000Z`));
}

function formatDateTime(value: string | null, timeZone: string): string {
  if (!value) return 'Sem horário definido';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function CalendarItem({
  item,
  compact,
  onOpen
}: {
  item: MarketingOpsProductionScheduleItem;
  compact: boolean;
  onOpen: (itemId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className={cn(
        'w-full rounded-[6px] border px-2 py-1.5 text-left text-xs shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-1',
        itemClasses[item.status]
      )}
    >
      <span className="block truncate font-semibold">{item.title}</span>
      {!compact ? (
        <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px]">
          <span>{statusLabels[item.status]}</span>
          <span>{priorityLabels[item.priority]}</span>
          {item.isBlocked ? <span>Bloqueado</span> : null}
          {item.isOverdue ? <span>Em atraso</span> : null}
        </span>
      ) : null}
    </button>
  );
}

export function ProductionCalendar({
  view,
  anchorDate,
  days,
  items,
  timeZone,
  onOpen
}: ProductionCalendarProps) {
  const currentMonth = anchorDate.slice(0, 7);
  const itemsByDay = new Map<string, MarketingOpsProductionScheduleItem[]>();
  for (const item of items) {
    const day = itemDate(item, timeZone);
    if (!day) continue;
    const dayItems = itemsByDay.get(day) ?? [];
    dayItems.push(item);
    itemsByDay.set(day, dayItems);
  }
  const rows = Array.from(
    { length: Math.ceil(days.length / 7) },
    (_, index) => days.slice(index * 7, index * 7 + 7)
  );

  return (
    <div className="space-y-5">
      <div
        data-testid="production-calendar-scroll"
        className="glass-surface shadow-glass overflow-x-auto rounded-[8px] border-white/60"
      >
        <div
          role="grid"
          aria-label={view === 'week' ? 'Calendário semanal' : 'Calendário mensal'}
          className={cn(
            'grid min-w-[760px] grid-cols-7 bg-white/40',
            view === 'week' ? 'min-h-[420px]' : 'auto-rows-[150px]'
          )}
        >
          {rows.map((row, rowIndex) => (
            <div key={row[0]} role="row" aria-rowindex={rowIndex + 1} className="contents">
              {row.map((day) => {
                const dayItems = itemsByDay.get(day) ?? [];
                const visibleItems = view === 'month' ? dayItems.slice(0, 3) : dayItems;
                return (
                  <section
                    key={day}
                    role="gridcell"
                    aria-label={formatDay(day, timeZone, 'long')}
                    className={cn(
                      'min-w-0 border-b border-r border-slate-200 p-2',
                      view === 'week' && 'min-h-[420px]',
                      view === 'month' && !day.startsWith(currentMonth) && 'bg-slate-50/70 text-text-muted'
                    )}
                  >
                    <time dateTime={day} className="block text-xs font-semibold capitalize text-text-secondary">
                      {formatDay(day, timeZone, 'short')}
                    </time>
                    <div className="mt-2 space-y-1.5">
                      {visibleItems.map((item) => (
                        <CalendarItem
                          key={item.id}
                          item={item}
                          compact={view === 'month'}
                          onOpen={onOpen}
                        />
                      ))}
                      {dayItems.length > visibleItems.length ? (
                        <p className="px-1 text-[11px] font-medium text-text-secondary">
                          +{dayItems.length - visibleItems.length} itens na lista abaixo
                        </p>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <section
        aria-label="Lista acessível do período"
        className="glass-surface shadow-glass rounded-[8px] border-white/60 bg-white/55 p-4"
      >
        <h2 className="text-lg font-semibold text-text-primary">Lista acessível do período</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Mesmos {items.length} {items.length === 1 ? 'item' : 'itens'} do calendário, em ordem da agenda.
        </p>
        <div className="mt-4 divide-y divide-slate-200">
          {items.length === 0 ? (
            <p className="py-4 text-sm text-text-secondary">
              Nenhum item datado neste período. Itens sem data permanecem na visualização em lista.
            </p>
          ) : items.map((item) => (
            <article key={item.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-text-primary">{item.title}</p>
                <p className="mt-1 text-xs text-text-secondary">
                  {item.campaignName} · {formatDateTime(item.effectiveAt, timeZone)} · {statusLabels[item.status]} · prioridade {priorityLabels[item.priority].toLowerCase()}
                </p>
                {item.isBlocked || item.isOverdue ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.isBlocked ? (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                        <Link2 className="mr-1 h-3 w-3" /> Bloqueado
                      </Badge>
                    ) : null}
                    {item.isOverdue ? (
                      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
                        <AlertTriangle className="mr-1 h-3 w-3" /> Em atraso
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpen(item.id)}
                aria-label={`Abrir item ${item.title}`}
                className="h-10 shrink-0 rounded-[8px]"
              >
                Abrir detalhes
              </Button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
