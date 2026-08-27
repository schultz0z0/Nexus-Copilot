import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Inbox, Loader2, Megaphone, Plus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { CampaignFilters } from '@/components/marketing-ops/CampaignFilters';
import { CampaignTable } from '@/components/marketing-ops/CampaignTable';
import { CreateCampaignDialog } from '@/components/marketing-ops/CreateCampaignDialog';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { campaignDeepLink } from '@/lib/marketingOps/deepLinks';
import { marketingOpsFlags } from '@/lib/marketingOps/flags';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import { marketingOpsClient } from '@/lib/marketingOps/runtime';
import type { MarketingOpsCampaignFilters } from '@/lib/marketingOps/types';

interface CampaignListPageProps {
  client?: MarketingOpsClient;
  canWrite?: boolean;
  searchDebounceMs?: number;
  createIdempotencyKey?: () => string;
}

const URL_FILTER_KEYS: Array<keyof MarketingOpsCampaignFilters> = [
  'q',
  'status',
  'referenceType',
  'referenceKey',
  'channel',
  'responsible',
  'periodFrom',
  'periodTo'
];

const campaignStatuses = new Set(['draft', 'planned', 'active', 'completed', 'archived']);
const referenceTypes = new Set(['course', 'product', 'initiative']);
const campaignChannels = new Set([
  'email', 'instagram', 'linkedin', 'facebook', 'whatsapp',
  'website', 'paid_media', 'events', 'press', 'other'
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function filtersFrom(searchParams: URLSearchParams): MarketingOpsCampaignFilters {
  const filters: MarketingOpsCampaignFilters = { limit: 25 };
  const q = searchParams.get('q')?.trim();
  const status = searchParams.get('status');
  const referenceType = searchParams.get('referenceType');
  const referenceKey = searchParams.get('referenceKey')?.trim();
  const channel = searchParams.get('channel');
  const responsible = searchParams.get('responsible');
  const periodFrom = searchParams.get('periodFrom');
  const periodTo = searchParams.get('periodTo');
  if (q && q.length <= 200) filters.q = q;
  if (status && campaignStatuses.has(status)) filters.status = status as MarketingOpsCampaignFilters['status'];
  if (referenceType && referenceTypes.has(referenceType)) filters.referenceType = referenceType as MarketingOpsCampaignFilters['referenceType'];
  if (referenceKey && referenceKey.length <= 200) filters.referenceKey = referenceKey;
  if (channel && campaignChannels.has(channel)) filters.channel = channel as MarketingOpsCampaignFilters['channel'];
  if (responsible && uuidPattern.test(responsible)) filters.responsible = responsible;
  if (periodFrom && datePattern.test(periodFrom)) filters.periodFrom = periodFrom;
  if (periodTo && datePattern.test(periodTo)) filters.periodTo = periodTo;
  return filters;
}

function correlationId(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { correlationId?: unknown }).correlationId;
  return typeof value === 'string' ? value : null;
}

function defaultIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export default function CampaignListPage({
  client = marketingOpsClient,
  canWrite = marketingOpsFlags(import.meta.env).write,
  searchDebounceMs = 300,
  createIdempotencyKey = defaultIdempotencyKey
}: CampaignListPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchValue, setSearchValue] = useState(searchParams.get('q') ?? '');
  const committedSearch = useRef(searchParams.get('q') ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const filters = useMemo(() => filtersFrom(searchParams), [searchParams]);
  const hasFilters = URL_FILTER_KEYS.some((key) => searchParams.has(key));

  const setFilter = useCallback((key: keyof MarketingOpsCampaignFilters, value?: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (key !== 'q') {
        const pendingSearch = searchValue.trim();
        if (pendingSearch) next.set('q', pendingSearch);
        else next.delete('q');
      }
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }, [searchValue, setSearchParams]);

  useEffect(() => {
    const urlSearch = searchParams.get('q') ?? '';
    if (urlSearch !== committedSearch.current) {
      committedSearch.current = urlSearch;
      setSearchValue(urlSearch);
    }
  }, [searchParams]);

  useEffect(() => {
    const normalized = searchValue.trim();
    if (normalized === (searchParams.get('q') ?? '')) return;
    const timeout = window.setTimeout(() => {
      committedSearch.current = normalized;
      setFilter('q', normalized || undefined);
    }, searchDebounceMs);
    return () => window.clearTimeout(timeout);
  }, [searchDebounceMs, searchParams, searchValue, setFilter]);

  const campaignsQuery = useInfiniteQuery({
    queryKey: marketingOpsKeys.campaigns(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.listCampaigns({
      ...filters,
      ...(pageParam ? { cursor: pageParam } : {})
    }),
    getNextPageParam: (lastPage) => lastPage.page?.nextCursor ?? null
  });

  const createCampaign = useMutation({
    mutationFn: (name: string) => client.createCampaign({ name }, createIdempotencyKey()),
    onSuccess: async (response) => {
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: marketingOpsKeys.campaigns() });
      navigate(campaignDeepLink(response.data.id));
    }
  });

  const campaigns = campaignsQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const totalLoaded = campaigns.length;
  const queryCorrelationId = correlationId(campaignsQuery.error);
  const accessDenied = (campaignsQuery.error as { status?: number } | null)?.status === 403;

  const resetFilters = () => {
    setSearchValue('');
    setSearchParams({}, { replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden text-text-primary">
      <Sidebar />

      <MarketingOpsMobileBar
        label="Campanhas"
        icon={<Megaphone className="h-4 w-4 text-brand-primary" />}
        action={canWrite ? (
          <Button
            size="icon"
            onClick={() => setCreateOpen(true)}
            aria-label="Nova campanha"
            className="shadow-glass h-10 w-10 rounded-full"
          >
            <Plus className="h-5 w-5" />
          </Button>
        ) : undefined}
      />

      <main className="min-h-screen md:ml-20">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 md:px-8 md:py-8">
          <header className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-text-primary">Campanhas</h1>
              <p className="mt-1 text-sm text-text-secondary">
                {campaignsQuery.isLoading ? 'Carregando workspace…' : `${totalLoaded} campanha${totalLoaded === 1 ? '' : 's'} carregada${totalLoaded === 1 ? '' : 's'}`}
              </p>
            </div>
            {canWrite ? (
              <Button onClick={() => setCreateOpen(true)} className="hidden h-11 rounded-[8px] sm:inline-flex">
                <Plus className="mr-2 h-4 w-4" />
                Nova campanha
              </Button>
            ) : null}
          </header>

          <CampaignFilters
            filters={filters}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onFilterChange={setFilter}
            onReset={resetFilters}
            hasFilters={hasFilters}
          />

          <section aria-live="polite" aria-busy={campaignsQuery.isLoading} className="py-5">
            {campaignsQuery.isLoading ? (
              <div aria-label="Carregando campanhas" className="glass-surface shadow-glass overflow-hidden rounded-[8px] border-white/60">
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
            ) : campaignsQuery.isError ? (
              <Alert variant="destructive" className="rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{accessDenied ? 'Acesso não autorizado' : 'Não foi possível carregar as campanhas'}</AlertTitle>
                <AlertDescription>
                  <p>{accessDenied ? 'Seu perfil não possui acesso a este workspace.' : 'Tente novamente. Se o erro persistir, informe o código de correlação.'}</p>
                  {queryCorrelationId ? <p className="mt-1 text-xs">Correlação: {queryCorrelationId}</p> : null}
                  <Button type="button" variant="outline" onClick={() => campaignsQuery.refetch()} className="mt-3 h-10 rounded-[8px]">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Tentar novamente
                  </Button>
                </AlertDescription>
              </Alert>
            ) : campaigns.length === 0 ? (
              <div className="glass-surface shadow-glass flex min-h-64 flex-col items-center justify-center rounded-[8px] border-white/60 px-4 py-10 text-center">
                <Inbox className="h-9 w-9 text-text-muted" />
                <h2 className="mt-4 text-lg font-semibold text-text-primary">
                  {hasFilters ? 'Nenhuma campanha encontrada' : 'Nenhuma campanha ainda'}
                </h2>
                <p className="mt-1 max-w-md text-sm text-text-secondary">
                  {hasFilters ? 'Revise ou limpe os filtros para ampliar a busca.' : 'Crie o primeiro rascunho para iniciar o workspace operacional.'}
                </p>
                {hasFilters ? (
                  <Button type="button" variant="outline" onClick={resetFilters} className="mt-4 h-10 rounded-[8px]">
                    Limpar filtros
                  </Button>
                ) : canWrite ? (
                  <Button type="button" onClick={() => setCreateOpen(true)} className="mt-4 h-10 rounded-[8px]">
                    <Plus className="mr-2 h-4 w-4" />
                    Nova campanha
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <CampaignTable campaigns={campaigns} onOpen={(campaignId) => navigate(campaignDeepLink(campaignId))} />
                {campaignsQuery.hasNextPage ? (
                  <div className="flex justify-center pt-5">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => campaignsQuery.fetchNextPage()}
                      disabled={campaignsQuery.isFetchingNextPage}
                      className="h-11 rounded-[8px] bg-white/80"
                    >
                      {campaignsQuery.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Carregar mais
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </main>

      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (open) createCampaign.reset();
        }}
        onCreate={async (name) => {
          await createCampaign.mutateAsync(name).catch(() => undefined);
        }}
        pending={createCampaign.isPending}
        error={createCampaign.error}
      />
    </div>
  );
}
