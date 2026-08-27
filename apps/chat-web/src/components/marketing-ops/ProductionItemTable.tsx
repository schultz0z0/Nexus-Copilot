import { AlertTriangle, ArrowRight, CalendarClock, Link2, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  MarketingOpsItemKind,
  MarketingOpsItemPriority,
  MarketingOpsItemStatus,
  MarketingOpsProductionScheduleItem
} from '@/lib/marketingOps/types';
import { cn } from '@/lib/utils';

interface ProductionItemTableProps {
  items: MarketingOpsProductionScheduleItem[];
  timeZone: string;
  onOpen: (itemId: string) => void;
  selectable?: boolean;
  selectedItemIds?: string[];
  onSelectionChange?: (itemId: string, selected: boolean) => void;
}

const statusLabels: Record<MarketingOpsItemStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronto',
  in_review: 'Em revisão',
  completed: 'Concluído',
  cancelled: 'Cancelado'
};
const statusClasses: Record<MarketingOpsItemStatus, string> = {
  draft: 'border-slate-300 bg-slate-100 text-slate-700',
  ready: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  in_review: 'border-violet-200 bg-violet-50 text-violet-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  cancelled: 'border-zinc-300 bg-zinc-100 text-zinc-600'
};
const kindLabels: Record<MarketingOpsItemKind, string> = {
  task: 'Tarefa',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  post: 'Post',
  creative: 'Criativo',
  review: 'Revisão',
  milestone: 'Marco'
};
const priorityLabels: Record<MarketingOpsItemPriority, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente'
};

function formatDate(value: string | null, timeZone: string): string {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone
  }).format(date);
}

function StatusBadge({ status }: { status: MarketingOpsItemStatus }) {
  return (
    <Badge variant="outline" className={cn('rounded-full font-medium', statusClasses[status])}>
      {statusLabels[status]}
    </Badge>
  );
}

function OperationalFlags({ item }: { item: MarketingOpsProductionScheduleItem }) {
  if (!item.isOverdue && !item.isBlocked) {
    return <span className="text-xs text-text-muted">Sem alertas</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {item.isOverdue ? (
        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
          <AlertTriangle className="mr-1 h-3 w-3" /> Em atraso
        </Badge>
      ) : null}
      {item.isBlocked ? (
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
          <Link2 className="mr-1 h-3 w-3" /> Bloqueado
        </Badge>
      ) : null}
    </div>
  );
}

export function ProductionItemTable({
  items,
  timeZone,
  onOpen,
  selectable = false,
  selectedItemIds = [],
  onSelectionChange
}: ProductionItemTableProps) {
  const selected = new Set(selectedItemIds);
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const someSelected = items.some((item) => selected.has(item.id));

  return (
    <>
      <div className="glass-surface shadow-glass hidden overflow-hidden rounded-[8px] border-white/60 md:block">
        <Table>
          <TableHeader className="bg-white/45">
            <TableRow className="hover:bg-white/45">
              {selectable ? (
                <TableHead className="w-12">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      for (const item of items) onSelectionChange?.(item.id, next);
                    }}
                    aria-label="Selecionar todos os itens"
                  />
                </TableHead>
              ) : null}
              <TableHead className="w-[28%]">Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Agenda</TableHead>
              <TableHead>Prioridade</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Atenção</TableHead>
              <TableHead className="w-12"><span className="sr-only">Abrir</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className="group bg-white/35 hover:bg-white/55">
                {selectable ? (
                  <TableCell>
                    <Checkbox
                      checked={selected.has(item.id)}
                      onCheckedChange={(checked) =>
                        onSelectionChange?.(item.id, checked === true)}
                      aria-label={`Selecionar ${item.title}`}
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onOpen(item.id)}
                    className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
                  >
                    <span className="block font-semibold text-text-primary group-hover:text-brand-primary">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-xs text-text-muted">
                      {item.campaignName} · {kindLabels[item.kind]}
                    </span>
                  </button>
                </TableCell>
                <TableCell><StatusBadge status={item.status} /></TableCell>
                <TableCell className="text-xs text-text-secondary">
                  <div className="flex items-start gap-1.5">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                    <div>
                      <span className="block">{formatDate(item.startsAt, timeZone)}</span>
                      {item.dueAt ? <span className="block text-text-muted">até {formatDate(item.dueAt, timeZone)}</span> : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell>{priorityLabels[item.priority]}</TableCell>
                <TableCell className="text-xs text-text-secondary">
                  {item.assigneeUserId ? (
                    <span className="flex items-center gap-1.5">
                      <UserRound className="h-4 w-4 text-text-muted" />
                      <span className="max-w-32 truncate" title={item.assigneeUserId}>{item.assigneeUserId}</span>
                    </span>
                  ) : 'Não definido'}
                </TableCell>
                <TableCell><OperationalFlags item={item} /></TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onOpen(item.id)}
                    aria-label={`Abrir item ${item.title}`}
                    className="h-10 w-10 rounded-[8px]"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-1 gap-3 md:hidden">
        {items.map((item) => (
          <article key={item.id} className="glass-surface shadow-glass rounded-[8px] border-white/60 p-4">
            {selectable ? (
              <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-3">
                <Checkbox
                  checked={selected.has(item.id)}
                  onCheckedChange={(checked) =>
                    onSelectionChange?.(item.id, checked === true)}
                  aria-label={`Selecionar ${item.title}`}
                />
                <span className="text-xs font-medium text-text-muted">Selecionar item</span>
              </div>
            ) : null}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="break-words text-left font-semibold text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                >
                  {item.title}
                </button>
                <p className="mt-1 text-xs text-text-muted">{item.campaignName} · {kindLabels[item.kind]}</p>
              </div>
              <StatusBadge status={item.status} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-text-muted">Início</dt>
                <dd className="mt-1 text-text-secondary">{formatDate(item.startsAt, timeZone)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Prazo</dt>
                <dd className="mt-1 text-text-secondary">{formatDate(item.dueAt, timeZone)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Prioridade</dt>
                <dd className="mt-1 text-text-secondary">{priorityLabels[item.priority]}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Responsável</dt>
                <dd className="mt-1 truncate text-text-secondary">
                  {item.assigneeUserId ?? 'Não definido'}
                </dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-slate-100 pt-3">
              <OperationalFlags item={item} />
              <div className="mt-3 flex justify-end">
                <Button type="button" variant="outline" onClick={() => onOpen(item.id)} className="h-10 rounded-[8px]">
                  Abrir <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
