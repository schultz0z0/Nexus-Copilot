import { useInfiniteQuery } from '@tanstack/react-query';
import { AlertCircle, ClipboardCheck, Inbox, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { ApprovalFilters } from '@/components/marketing-ops/ApprovalFilters';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import { marketingOpsClient } from '@/lib/marketingOps/runtime';
import type { MarketingOpsApprovalFilters, MarketingOpsApprovalRequest } from '@/lib/marketingOps/types';

const statuses = new Set(['pending', 'approved', 'rejected', 'changes_requested', 'cancelled', 'expired']);
const kinds = new Set(['editorial', 'operational']);
const risks = new Set(['low', 'medium', 'high', 'critical']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusLabel = { pending: 'Pendente', approved: 'Aprovada', rejected: 'Rejeitada', changes_requested: 'Ajustes solicitados', cancelled: 'Cancelada', expired: 'Expirada' };
const riskLabel = { low: 'baixo', medium: 'médio', high: 'alto', critical: 'crítico' };

function filtersFrom(params: URLSearchParams): MarketingOpsApprovalFilters {
  const result: MarketingOpsApprovalFilters = { limit: 25 };
  const status = params.get('status'); const kind = params.get('kind'); const risk = params.get('riskLevel');
  if (status && statuses.has(status)) result.status = status as MarketingOpsApprovalFilters['status'];
  if (kind && kinds.has(kind)) result.kind = kind as MarketingOpsApprovalFilters['kind'];
  if (risk && risks.has(risk)) result.riskLevel = risk as MarketingOpsApprovalFilters['riskLevel'];
  const campaignId = params.get('campaignId'); const requestedBy = params.get('requestedBy');
  const expiresBefore = params.get('expiresBefore'); const expiresAfter = params.get('expiresAfter');
  if (campaignId && uuid.test(campaignId)) result.campaignId = campaignId;
  if (requestedBy && uuid.test(requestedBy)) result.requestedBy = requestedBy;
  if (expiresBefore && !Number.isNaN(Date.parse(expiresBefore))) result.expiresBefore = expiresBefore;
  if (expiresAfter && !Number.isNaN(Date.parse(expiresAfter))) result.expiresAfter = expiresAfter;
  return result;
}

function ApprovalCard({ approval }: { approval: MarketingOpsApprovalRequest }) {
  return (
    <li className="rounded-lg border border-white/60 bg-white/80 p-4 shadow-sm">
      <Link to={`/marketing-ops/approvals/${approval.id}`} className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{statusLabel[approval.status]}</Badge>
          <Badge variant="secondary">{approval.kind === 'editorial' ? 'Editorial' : 'Operacional'}</Badge>
          <span className="text-sm font-semibold">Risco {riskLabel[approval.riskLevel]}</span>
        </div>
        <h2 className="mt-3 font-semibold">{approval.reason}</h2>
        <p className="mt-1 text-sm text-text-secondary">Expira em {new Date(approval.expiresAt).toLocaleString('pt-BR')}</p>
      </Link>
    </li>
  );
}

export default function ApprovalQueuePage({ client = marketingOpsClient }: { client?: MarketingOpsClient }) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFrom(params), [params]);
  const query = useInfiniteQuery({
    queryKey: marketingOpsKeys.approvals(filters), initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.listApprovalRequests({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last) => last.page?.nextCursor ?? null
  });
  const approvals = query.data?.pages.flatMap((page) => page.data) ?? [];
  const change = (key: 'status' | 'kind' | 'riskLevel' | 'campaignId' | 'requestedBy' | 'expiresBefore' | 'expiresAfter', value?: string) => setParams((current) => {
    const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next;
  }, { replace: true });
  return <div className="min-h-screen text-text-primary"><Sidebar />
    <MarketingOpsMobileBar label="Aprovações" icon={<ClipboardCheck className="h-4 w-4 text-brand-primary" />} />
    <main className="min-h-screen md:ml-20"><div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:py-8">
      <header className="mb-5"><h1 className="text-3xl font-bold">Aprovações de negócio</h1>
        <p className="mt-1 text-sm text-text-secondary">Decisões humanas sobre versões e pacotes congelados.</p></header>
      <ApprovalFilters filters={filters} onChange={change} onReset={() => setParams({}, { replace: true })} />
      <section aria-live="polite" aria-busy={query.isLoading} className="py-5">
        {query.isLoading ? <p className="flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando aprovações</p>
          : query.isError ? <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Não foi possível carregar as aprovações</AlertTitle><AlertDescription><Button variant="outline" onClick={() => query.refetch()}>Tentar novamente</Button></AlertDescription></Alert>
            : approvals.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border bg-white/70"><Inbox className="h-8 w-8" /><h2 className="mt-3 font-semibold">Nenhuma aprovação encontrada</h2></div>
              : <><ul className="grid gap-3">{approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} />)}</ul>
                {query.hasNextPage ? <div className="mt-5 text-center"><Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>Carregar mais</Button></div> : null}</>}
      </section>
    </div></main>
  </div>;
}
