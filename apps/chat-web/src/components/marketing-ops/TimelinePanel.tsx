import { useInfiniteQuery } from '@tanstack/react-query';
import { Circle, Loader2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import type { MarketingOpsTimelineChange } from '@/lib/marketingOps/types';
import { cn } from '@/lib/utils';

const actionLabels: Record<string, string> = {
  'campaign.created': 'Campanha criada',
  'campaign.updated': 'Campanha atualizada',
  'campaign.status_changed': 'Status da campanha alterado',
  'campaign.archived': 'Campanha arquivada',
  'participant.added': 'Participante adicionado',
  'participant.updated': 'Participante atualizado',
  'participant.removed': 'Participante removido',
  'material.linked': 'Material vinculado',
  'material.unlinked': 'Material desvinculado',
  'campaign.changed': 'Campanha atualizada'
};

const fieldLabels: Record<string, string> = {
  name: 'Nome',
  courseSlug: 'Curso legado',
  objective: 'Objetivo',
  referenceType: 'Tipo de referência',
  referenceKey: 'Referência',
  referenceTitleSnapshot: 'Título da referência',
  referenceDocumentId: 'Documento oficial',
  referenceVerifiedAt: 'Verificação da referência',
  audience: 'Público',
  startsOn: 'Início',
  endsOn: 'Término',
  primaryChannel: 'Canal principal',
  secondaryChannels: 'Canais secundários',
  briefing: 'Briefing',
  notes: 'Notas',
  status: 'Status',
  archivedAt: 'Arquivamento',
  participant: 'Participante',
  userId: 'Pessoa',
  memberRole: 'Papel',
  isPrimary: 'Responsável principal',
  material: 'Material',
  materialId: 'Material',
  artifactId: 'Artefato'
};

const changeLabels: Record<MarketingOpsTimelineChange['kind'], string> = {
  added: 'adicionado',
  removed: 'removido',
  changed: 'alterado'
};

function describeChange(change: MarketingOpsTimelineChange): string {
  return `${fieldLabels[change.field] ?? 'Campo'} ${changeLabels[change.kind]}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

const originLabels = { rest: 'Workspace', mcp: 'Hermes', internal: 'Sistema' } as const;

interface TimelinePanelProps {
  campaignId: string;
  client: MarketingOpsClient;
  pageSize?: number;
  reserveFooterSpace?: boolean;
}

export function TimelinePanel({
  campaignId,
  client,
  pageSize = 25,
  reserveFooterSpace = false
}: TimelinePanelProps) {
  const timelineQuery = useInfiniteQuery({
    queryKey: marketingOpsKeys.timeline(campaignId, { limit: pageSize }),
    queryFn: ({ pageParam }) => client.listTimeline(campaignId, {
      limit: pageSize,
      ...(pageParam ? { cursor: pageParam } : {})
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page?.nextCursor ?? undefined
  });
  const events = timelineQuery.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <section
      aria-labelledby="campaign-activity"
      className={cn('bg-white/25 px-4 py-6 backdrop-blur-lg sm:px-6 md:px-8', reserveFooterSpace && 'pb-28')}
    >
      <div className="mx-auto max-w-5xl">
        <div>
          <h2 id="campaign-activity" className="text-lg font-semibold text-text-primary">Atividade</h2>
          <p className="mt-1 text-sm text-text-muted">Histórico operacional da campanha</p>
        </div>

        {timelineQuery.isLoading ? (
          <div aria-label="Carregando atividade" className="mt-5 space-y-4">
            <div className="h-20 animate-pulse rounded-[8px] bg-slate-200" />
            <div className="h-20 animate-pulse rounded-[8px] bg-slate-200" />
          </div>
        ) : timelineQuery.isError ? (
          <Alert variant="destructive" className="mt-5 rounded-[8px] border-white/60 bg-white/80 shadow-glass backdrop-blur-xl">
            <AlertTitle>Não foi possível carregar a atividade</AlertTitle>
            <AlertDescription>
              <Button type="button" variant="outline" onClick={() => timelineQuery.refetch()} className="mt-2 h-10 rounded-[8px]">
                <RefreshCw className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        ) : events.length === 0 ? (
          <p className="mt-5 border-l-2 border-slate-300 px-4 py-3 text-sm text-text-muted">Nenhuma atividade registrada.</p>
        ) : (
          <ol className="relative mt-5 space-y-0 border-l border-slate-300 pl-6">
            {events.map((event) => (
              <li key={event.id} className="relative border-b border-slate-200 py-4 first:pt-0 last:border-b-0">
                <Circle className="absolute -left-[30px] top-1 h-3 w-3 fill-brand-primary text-brand-primary" aria-hidden="true" />
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{actionLabels[event.action] ?? 'Campanha atualizada'}</p>
                    <p className="mt-1 text-sm text-text-secondary">{event.actor.displayName} · {originLabels[event.origin]}</p>
                    {event.changes.length ? (
                      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Campos alterados">
                        {event.changes.map((change, index) => (
                          <li key={`${change.field}:${change.kind}:${index}`} className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-700">
                            {describeChange(change)}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <time dateTime={event.occurredAt} className="shrink-0 text-xs text-text-muted">{formatDate(event.occurredAt)}</time>
                </div>
              </li>
            ))}
          </ol>
        )}

        {timelineQuery.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            disabled={timelineQuery.isFetchingNextPage}
            onClick={() => timelineQuery.fetchNextPage()}
            className="mt-5 h-11 rounded-[8px] bg-white/80"
          >
            {timelineQuery.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Carregar mais atividades
          </Button>
        ) : null}
      </div>
    </section>
  );
}
