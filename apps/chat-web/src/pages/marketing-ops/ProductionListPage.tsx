import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AlertCircle, CalendarRange, Inbox, LayoutList, ListChecks, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { InAppNotifications } from '@/components/marketing-ops/InAppNotifications';
import { ProductionBatchDialog } from '@/components/marketing-ops/ProductionBatchDialog';
import { ProductionFilters } from '@/components/marketing-ops/ProductionFilters';
import { ProductionItemDialog } from '@/components/marketing-ops/ProductionItemDialog';
import { ProductionItemTable } from '@/components/marketing-ops/ProductionItemTable';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { marketingOpsFlags } from '@/lib/marketingOps/flags';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import { marketingOpsClient } from '@/lib/marketingOps/runtime';
import { parseMarketingOpsDeepLink } from '@/lib/marketingOps/deepLinks';
import { useAuth } from '@/contexts/AuthContext';
import {
  hasProductionScheduleFilters,
  productionScheduleFiltersFrom,
  setProductionScheduleFilter,
  type ProductionScheduleUrlFilter
} from '@/lib/marketingOps/scheduleUrl';

interface ProductionListPageProps {
  client?: MarketingOpsClient;
  canWrite?: boolean;
  canBatch?: boolean;
  createIdempotencyKey?: () => string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function correlationId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { correlationId?: unknown }).correlationId;
  return typeof value === 'string' ? value : null;
}

export default function ProductionListPage({
  client = marketingOpsClient,
  canWrite = marketingOpsFlags(import.meta.env).write,
  canBatch: canBatchOverride,
  createIdempotencyKey = defaultIdempotencyKey
}: ProductionListPageProps) {
  const { normalizedRole } = useAuth();
  const canBatch = canBatchOverride ??
    (normalizedRole === 'manager' || normalizedRole === 'admin');
  const [searchParams, setSearchParams] = useSearchParams();
  const { itemId = null } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [assigneeValue, setAssigneeValue] = useState(searchParams.get('assigneeId') ?? '');
  const [assigneeInvalid, setAssigneeInvalid] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const filters = useMemo(() => productionScheduleFiltersFrom(searchParams), [searchParams]);
  const hasFilters = hasProductionScheduleFilters(searchParams);
  const parsedDeepLink = itemId
    ? parseMarketingOpsDeepLink(`${location.pathname}${location.search}`)
    : null;
  const linkedItemId = parsedDeepLink?.resource === 'campaign_item'
    ? parsedDeepLink.id
    : parsedDeepLink?.resource === 'content_asset'
      ? parsedDeepLink.itemId
      : null;
  const selectedContentAssetId = parsedDeepLink?.resource === 'content_asset'
    ? parsedDeepLink.id
    : null;
  const invalidItemLink = Boolean(itemId && !linkedItemId);

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
      view: 'list',
      ...filters,
      ...(pageParam ? { cursor: pageParam } : {})
    }),
    getNextPageParam: (lastPage) => lastPage.page?.nextCursor ?? null
  });

  const campaigns = campaignsQuery.data?.data ?? [];
  const items = scheduleQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
  const timeZone = scheduleQuery.data?.pages[0]?.meta?.timeZone ?? 'America/Sao_Paulo';
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
    setSearchParams({}, { replace: true });
  };
  const search = location.search;
  const scheduleSearch = (() => {
    const next = new URLSearchParams(searchParams);
    next.delete('contentAssetId');
    const value = next.toString();
    return value ? `?${value}` : '';
  })();
  const openItem = (nextItemId: string) => {
    navigate({ pathname: `/marketing-ops/production/items/${nextItemId}`, search: scheduleSearch });
  };
  const closeDialog = () => {
    setCreateOpen(false);
    if (itemId) navigate({ pathname: '/marketing-ops/production', search: scheduleSearch }, { replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden text-text-primary">
      <Sidebar />
      <MarketingOpsMobileBar
        label="Produção"
        icon={<CalendarRange className="h-4 w-4 text-brand-primary" />}
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
          <header className="flex flex-col gap-4 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-text-primary">Esteira de produção</h1>
              <p className="mt-1 text-sm text-text-secondary">
                {scheduleQuery.isLoading
                  ? 'Carregando agenda…'
                  : `${items.length} ${items.length === 1 ? 'item carregado' : 'itens carregados'} · ${timeZone}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <nav aria-label="Visualizações da produção" className="flex rounded-[8px] border border-slate-200 bg-white/70 p-1">
                <Link
                  to={{ pathname: '/marketing-ops/production', search }}
                  aria-current="page"
                  className="flex h-9 items-center rounded-[6px] bg-brand-primary px-3 text-sm font-medium text-slate-950"
                >
                  <LayoutList className="mr-2 h-4 w-4" /> Lista
                </Link>
                <Link
                  to={{ pathname: '/marketing-ops/production/week', search }}
                  className="flex h-9 items-center rounded-[6px] px-3 text-sm font-medium text-text-secondary hover:bg-white"
                >
                  Semana
                </Link>
                <Link
                  to={{ pathname: '/marketing-ops/production/month', search }}
                  className="flex h-9 items-center rounded-[6px] px-3 text-sm font-medium text-text-secondary hover:bg-white"
                >
                  Mês
                </Link>
              </nav>
              <InAppNotifications
                client={client}
                canMarkRead={canWrite}
                createIdempotencyKey={createIdempotencyKey}
                onOpenItem={openItem}
                onOpenApproval={(requestId) => navigate(`/marketing-ops/approvals/${requestId}`)}
              />
              {canBatch ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={selectedItems.length === 0}
                  onClick={() => setBatchOpen(true)}
                  className="h-10 rounded-[8px] bg-white/80"
                >
                  <ListChecks className="mr-2 h-4 w-4" />
                  Lote ({selectedItems.length})
                </Button>
              ) : null}
              {canWrite ? (
                <Button onClick={() => setCreateOpen(true)} className="hidden h-11 rounded-[8px] text-slate-950 sm:inline-flex">
                  <Plus className="mr-2 h-4 w-4" /> Novo item
                </Button>
              ) : null}
            </div>
          </header>

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
              <div aria-label="Carregando produção" className="glass-surface shadow-glass overflow-hidden rounded-[8px] border-white/60">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="grid h-20 grid-cols-6 items-center gap-4 border-b border-slate-100 px-4 last:border-b-0">
                    <div className="col-span-2 h-4 animate-pulse rounded bg-slate-200" />
                    <div className="h-4 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 animate-pulse rounded bg-slate-100" />
                    <div className="h-4 animate-pulse rounded bg-slate-100" />
                  </div>
                ))}
              </div>
            ) : scheduleQuery.isError ? (
              <Alert variant="destructive" className="rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{accessDenied ? 'Acesso não autorizado' : 'Não foi possível carregar a produção'}</AlertTitle>
                <AlertDescription>
                  <p>{accessDenied ? 'Seu perfil não possui acesso a esta agenda.' : 'Tente novamente. Se o erro persistir, informe o código de correlação.'}</p>
                  {queryCorrelationId ? <p className="mt-1 text-xs">Correlação: {queryCorrelationId}</p> : null}
                  <Button type="button" variant="outline" onClick={() => scheduleQuery.refetch()} className="mt-3 h-10 rounded-[8px]">
                    <RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente
                  </Button>
                </AlertDescription>
              </Alert>
            ) : items.length === 0 ? (
              <div className="glass-surface shadow-glass flex min-h-64 flex-col items-center justify-center rounded-[8px] border-white/60 px-4 py-10 text-center">
                <Inbox className="h-9 w-9 text-text-muted" />
                <h2 className="mt-4 text-lg font-semibold text-text-primary">
                  {hasFilters ? 'Nenhum item encontrado' : 'Nenhum item de produção ainda'}
                </h2>
                <p className="mt-1 max-w-md text-sm text-text-secondary">
                  {hasFilters
                    ? 'Revise ou limpe os filtros para ampliar a agenda.'
                    : 'Crie o primeiro rascunho para começar a planejar o trabalho.'}
                </p>
                {hasFilters ? (
                  <Button type="button" variant="outline" onClick={resetFilters} className="mt-4 h-10 rounded-[8px]">
                    Limpar filtros
                  </Button>
                ) : canWrite ? (
                  <Button type="button" onClick={() => setCreateOpen(true)} className="mt-4 h-10 rounded-[8px]">
                    <Plus className="mr-2 h-4 w-4" /> Novo item
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <ProductionItemTable
                  items={items}
                  timeZone={timeZone}
                  onOpen={openItem}
                  selectable={canBatch}
                  selectedItemIds={selectedItemIds}
                  onSelectionChange={(nextItemId, selected) => {
                    setSelectedItemIds((current) => selected
                      ? current.includes(nextItemId) ? current : [...current, nextItemId]
                      : current.filter((currentItemId) => currentItemId !== nextItemId));
                  }}
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

      {invalidItemLink ? (
        <Alert variant="destructive" className="fixed bottom-6 right-6 z-50 max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Deep link inválido</AlertTitle>
          <AlertDescription>A rota não corresponde a um item ou conteúdo do Marketing Ops.</AlertDescription>
        </Alert>
      ) : null}

      <ProductionItemDialog
        open={createOpen || Boolean(linkedItemId)}
        itemId={linkedItemId}
        selectedContentAssetId={selectedContentAssetId}
        campaigns={campaigns}
        timeZone={timeZone}
        canWrite={canWrite}
        client={client}
        createIdempotencyKey={createIdempotencyKey}
        onOpenChange={(next) => {
          if (!next) closeDialog();
          else if (!linkedItemId) setCreateOpen(true);
        }}
        onCreated={openItem}
      />
      {canBatch ? (
        <ProductionBatchDialog
          open={batchOpen}
          selectedItems={selectedItems}
          timeZone={timeZone}
          client={client}
          createIdempotencyKey={createIdempotencyKey}
          onOpenChange={(nextOpen) => {
            setBatchOpen(nextOpen);
            if (!nextOpen) setSelectedItemIds([]);
          }}
          onComplete={() => undefined}
        />
      ) : null}
    </div>
  );
}
