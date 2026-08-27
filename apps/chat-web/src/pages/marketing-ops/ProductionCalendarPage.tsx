import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CalendarDays as CalendarDaysIcon,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LayoutList,
  Loader2,
  Plus,
  RefreshCw
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { ProductionCalendar } from '@/components/marketing-ops/ProductionCalendar';
import { ProductionFilters } from '@/components/marketing-ops/ProductionFilters';
import { ProductionItemDialog } from '@/components/marketing-ops/ProductionItemDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { marketingOpsFlags } from '@/lib/marketingOps/flags';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import { marketingOpsClient } from '@/lib/marketingOps/runtime';
import {
  hasProductionScheduleFilters,
  productionScheduleFiltersFrom,
  setProductionScheduleFilter,
  type ProductionScheduleUrlFilter
} from '@/lib/marketingOps/scheduleUrl';
import {
  calendarDays,
  calendarRange,
  shiftCalendarAnchor,
  todayInTimeZone,
  type ProductionCalendarView
} from '@/lib/marketingOps/timezone';

export interface ProductionCalendarPageProps {
  view: ProductionCalendarView;
  client?: MarketingOpsClient;
  canWrite?: boolean;
  createIdempotencyKey?: () => string;
}

const fallbackTimeZone = 'America/Sao_Paulo';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function correlationId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { correlationId?: unknown }).correlationId;
  return typeof value === 'string' ? value : null;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function periodLabel(view: ProductionCalendarView, days: string[]): string {
  const format = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('pt-BR', { ...options, timeZone: 'UTC' })
      .format(new Date(`${day}T12:00:00.000Z`));
  if (view === 'month') {
    return format(days[10], { month: 'long', year: 'numeric' });
  }
  return `${format(days[0], { day: '2-digit', month: 'short' })} – ${format(days[6], {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })}`;
}

export default function ProductionCalendarPage({
  view,
  client = marketingOpsClient,
  canWrite = marketingOpsFlags(import.meta.env).write,
  createIdempotencyKey = defaultIdempotencyKey
}: ProductionCalendarPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [timeZone, setTimeZone] = useState(fallbackTimeZone);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [assigneeValue, setAssigneeValue] = useState(searchParams.get('assigneeId') ?? '');
  const [assigneeInvalid, setAssigneeInvalid] = useState(false);
  const requestedDate = searchParams.get('date') ?? todayInTimeZone(timeZone);
  const range = useMemo(() => {
    try {
      return calendarRange(view, requestedDate, timeZone);
    } catch {
      return calendarRange(view, todayInTimeZone(timeZone), timeZone);
    }
  }, [requestedDate, timeZone, view]);
  const days = useMemo(() => calendarDays(view, range.anchorDate), [range.anchorDate, view]);
  const filters = useMemo(() => ({
    ...productionScheduleFiltersFrom(searchParams),
    from: range.from,
    to: range.to,
    limit: 100
  }), [range.from, range.to, searchParams]);
  const hasFilters = hasProductionScheduleFilters(searchParams);

  useEffect(() => {
    setAssigneeValue(searchParams.get('assigneeId') ?? '');
    setAssigneeInvalid(false);
  }, [searchParams]);

  const campaignsQuery = useQuery({
    queryKey: marketingOpsKeys.campaigns({ limit: 100 }),
    queryFn: () => client.listCampaigns({ limit: 100 })
  });
  const scheduleQuery = useInfiniteQuery({
    queryKey: marketingOpsKeys.productionSchedule(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.listProductionSchedule({
      view,
      ...filters,
      ...(pageParam ? { cursor: pageParam } : {})
    }),
    getNextPageParam: (lastPage) => lastPage.page?.nextCursor ?? null
  });
  const responseTimeZone = scheduleQuery.data?.pages[0]?.meta?.timeZone;

  useEffect(() => {
    if (responseTimeZone && responseTimeZone !== timeZone && isValidTimeZone(responseTimeZone)) {
      setTimeZone(responseTimeZone);
    }
  }, [responseTimeZone, timeZone]);

  const campaigns = campaignsQuery.data?.data ?? [];
  const items = scheduleQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const scheduleError = scheduleQuery.error as { status?: number } | null;
  const accessDenied = scheduleError?.status === 403;
  const queryCorrelationId = correlationId(scheduleQuery.error);

  const setFilter = (key: ProductionScheduleUrlFilter, value?: string) => {
    setSearchParams(setProductionScheduleFilter(searchParams, key, value), { replace: true });
  };
  const commitAssignee = () => {
    const normalized = assigneeValue.trim();
    const valid = !normalized || uuidPattern.test(normalized);
    setAssigneeInvalid(!valid);
    if (valid) setFilter('assigneeId', normalized || undefined);
  };
  const resetFilters = () => {
    setAssigneeValue('');
    setAssigneeInvalid(false);
    setSearchParams({ date: requestedDate }, { replace: true });
  };
  const navigatePeriod = (amount: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('date', shiftCalendarAnchor(view, requestedDate, amount));
    setSearchParams(next);
  };
  const goToday = () => {
    const next = new URLSearchParams(searchParams);
    next.set('date', todayInTimeZone(timeZone));
    setSearchParams(next);
  };
  const closeDialog = () => {
    setSelectedItemId(null);
    setCreateOpen(false);
  };
  const search = location.search;
  const viewLabel = view === 'week' ? 'Semana' : 'Mês';
  const previousLabel = view === 'week' ? 'Semana anterior' : 'Mês anterior';
  const nextLabel = view === 'week' ? 'Próxima semana' : 'Próximo mês';

  return (
    <div className="relative min-h-screen overflow-x-hidden text-text-primary">
      <Sidebar />
      <MarketingOpsMobileBar
        label={`Produção · ${viewLabel}`}
        icon={<CalendarDaysIcon className="h-4 w-4 text-brand-primary" />}
        action={canWrite ? (
          <Button
            size="icon"
            onClick={() => setCreateOpen(true)}
            aria-label="Novo item"
            className="shadow-glass h-10 w-10 rounded-full text-slate-950"
          >
            <Plus className="h-5 w-5" />
          </Button>
        ) : undefined}
      />

      <main className="min-h-screen md:ml-20">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 md:px-8 md:py-8">
          <header className="flex flex-col gap-4 pb-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-text-primary">Produção por {viewLabel.toLowerCase()}</h1>
              <p className="mt-1 text-sm capitalize text-text-secondary">
                {periodLabel(view, days)} · {timeZone}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <nav aria-label="Visualizações da produção" className="flex rounded-[8px] border border-slate-200 bg-white/70 p-1">
                <Link
                  to={{ pathname: '/marketing-ops/production', search }}
                  className="flex h-9 items-center rounded-[6px] px-3 text-sm font-medium text-text-secondary hover:bg-white"
                >
                  <LayoutList className="mr-2 h-4 w-4" /> Lista
                </Link>
                <Link
                  to={{ pathname: '/marketing-ops/production/week', search }}
                  aria-current={view === 'week' ? 'page' : undefined}
                  className={view === 'week'
                    ? 'flex h-9 items-center rounded-[6px] bg-brand-primary px-3 text-sm font-medium text-slate-950'
                    : 'flex h-9 items-center rounded-[6px] px-3 text-sm font-medium text-text-secondary hover:bg-white'}
                >
                  Semana
                </Link>
                <Link
                  to={{ pathname: '/marketing-ops/production/month', search }}
                  aria-current={view === 'month' ? 'page' : undefined}
                  className={view === 'month'
                    ? 'flex h-9 items-center rounded-[6px] bg-brand-primary px-3 text-sm font-medium text-slate-950'
                    : 'flex h-9 items-center rounded-[6px] px-3 text-sm font-medium text-text-secondary hover:bg-white'}
                >
                  Mês
                </Link>
              </nav>
              {canWrite ? (
                <Button onClick={() => setCreateOpen(true)} className="hidden h-11 rounded-[8px] text-slate-950 sm:inline-flex">
                  <Plus className="mr-2 h-4 w-4" /> Novo item
                </Button>
              ) : null}
            </div>
          </header>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => navigatePeriod(-1)} aria-label={previousLabel} className="h-10 rounded-[8px]">
              <ChevronLeft className="mr-1 h-4 w-4" /> {previousLabel}
            </Button>
            <Button type="button" variant="outline" onClick={goToday} className="h-10 rounded-[8px]">
              Hoje
            </Button>
            <Button type="button" variant="outline" onClick={() => navigatePeriod(1)} aria-label={nextLabel} className="h-10 rounded-[8px]">
              {nextLabel} <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>

          <ProductionFilters
            filters={filters}
            campaigns={campaigns}
            assigneeValue={assigneeValue}
            assigneeInvalid={assigneeInvalid}
            onAssigneeChange={(value) => {
              setAssigneeValue(value);
              setAssigneeInvalid(false);
            }}
            onAssigneeCommit={commitAssignee}
            onFilterChange={setFilter}
            onReset={resetFilters}
            hasFilters={hasFilters}
          />

          <section aria-live="polite" aria-busy={scheduleQuery.isLoading} className="py-5">
            {scheduleQuery.isLoading ? (
              <div className="glass-surface shadow-glass flex min-h-80 items-center justify-center rounded-[8px] border-white/60">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-brand-primary" />
                Carregando calendário
              </div>
            ) : scheduleQuery.isError ? (
              <Alert variant="destructive" className="rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{accessDenied ? 'Acesso não autorizado' : 'Não foi possível carregar o calendário'}</AlertTitle>
                <AlertDescription>
                  <p>{accessDenied ? 'Seu perfil não possui acesso a esta agenda.' : 'Tente novamente. Se o erro persistir, informe o código de correlação.'}</p>
                  {queryCorrelationId ? <p className="mt-1 text-xs">Correlação: {queryCorrelationId}</p> : null}
                  <Button type="button" variant="outline" onClick={() => scheduleQuery.refetch()} className="mt-3 h-10 rounded-[8px]">
                    <RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {items.length === 0 ? (
                  <div className="glass-surface shadow-glass mb-4 flex items-center gap-3 rounded-[8px] border-white/60 px-4 py-3">
                    <Inbox className="h-5 w-5 shrink-0 text-text-muted" />
                    <div>
                      <h2 className="font-semibold text-text-primary">
                        {hasFilters ? 'Nenhum item encontrado' : `Nenhum item neste ${view === 'week' ? 'período semanal' : 'mês'}`}
                      </h2>
                      <p className="text-sm text-text-secondary">
                        {hasFilters ? 'Revise ou limpe os filtros para ampliar a agenda.' : 'O calendário continua disponível para navegação.'}
                      </p>
                    </div>
                    {hasFilters ? (
                      <Button type="button" variant="outline" onClick={resetFilters} className="ml-auto h-10 shrink-0 rounded-[8px]">
                        Limpar filtros
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                <ProductionCalendar
                  view={view}
                  anchorDate={range.anchorDate}
                  days={days}
                  items={items}
                  timeZone={timeZone}
                  onOpen={setSelectedItemId}
                />
                {scheduleQuery.hasNextPage ? (
                  <div className="flex justify-center pt-5">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => scheduleQuery.fetchNextPage()}
                      disabled={scheduleQuery.isFetchingNextPage}
                      className="h-11 rounded-[8px] bg-white/80"
                    >
                      {scheduleQuery.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Carregar mais
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </main>

      <ProductionItemDialog
        open={createOpen || Boolean(selectedItemId)}
        itemId={selectedItemId}
        campaigns={campaigns}
        timeZone={timeZone}
        canWrite={canWrite}
        client={client}
        createIdempotencyKey={createIdempotencyKey}
        onOpenChange={(next) => {
          if (!next) closeDialog();
          else if (!selectedItemId) setCreateOpen(true);
        }}
        onCreated={(itemId) => {
          setCreateOpen(false);
          setSelectedItemId(itemId);
        }}
      />
    </div>
  );
}
