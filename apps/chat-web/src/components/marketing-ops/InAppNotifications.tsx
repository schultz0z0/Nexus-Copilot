import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Bell, CheckCheck, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import { marketingOpsClient } from '@/lib/marketingOps/runtime';
import type { MarketingOpsInAppNotification } from '@/lib/marketingOps/types';

interface InAppNotificationsProps {
  client?: MarketingOpsClient;
  canMarkRead?: boolean;
  createIdempotencyKey?: () => string;
  onOpenItem?: (itemId: string) => void;
  onOpenApproval?: (requestId: string) => void;
}

const typeLabel: Record<MarketingOpsInAppNotification['notificationType'], string> = {
  assignment: 'Atribuição',
  due_soon: 'Prazo próximo',
  overdue: 'Atraso',
  approval_review: 'Aprovação pendente',
  approval_status: 'Atualização de aprovação'
};

function defaultIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function occurredLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

export function InAppNotifications({
  client = marketingOpsClient,
  canMarkRead = true,
  createIdempotencyKey = defaultIdempotencyKey,
  onOpenItem,
  onOpenApproval
}: InAppNotificationsProps) {
  const queryClient = useQueryClient();
  const filters = { limit: 25 };
  const notificationsQuery = useQuery({
    queryKey: marketingOpsKeys.notifications(filters),
    queryFn: async () => (await client.listInAppNotifications(filters)).data,
    staleTime: 30_000
  });
  const notifications = notificationsQuery.data ?? [];
  const unread = notifications.filter((notification) => notification.readAt === null);
  const markRead = useMutation({
    mutationFn: (ids: string[]) =>
      client.markInAppNotificationsRead(ids, createIdempotencyKey()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['marketing-ops', 'notifications']
      });
    }
  });

  const openNotification = (notification: MarketingOpsInAppNotification) => {
    if (canMarkRead && notification.readAt === null && !markRead.isPending) {
      markRead.mutate([notification.id]);
    }
    if (notification.approvalRequestId) onOpenApproval?.(notification.approvalRequestId);
    else if (notification.itemId) onOpenItem?.(notification.itemId);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="relative h-10 w-10 rounded-[8px] bg-white/80"
          aria-label={`Notificações, ${unread.length} ${unread.length === 1 ? 'não lida' : 'não lidas'}`}
        >
          <Bell className="h-4 w-4" />
          {unread.length > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white"
            >
              {unread.length > 99 ? '99+' : unread.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label="Notificações"
        className="glass-surface w-[min(24rem,calc(100vw-2rem))] rounded-[8px] border-white/60 p-0 shadow-glass"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="font-semibold text-text-primary">Notificações</h2>
            <p aria-live="polite" className="text-xs text-text-muted">
              {unread.length} {unread.length === 1 ? 'não lida' : 'não lidas'}
            </p>
          </div>
          {canMarkRead && unread.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate(unread.map((notification) => notification.id))}
              className="h-9 rounded-[8px]"
            >
              {markRead.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <CheckCheck className="mr-2 h-4 w-4" />}
              Marcar todas como lidas
            </Button>
          ) : null}
        </div>

        {notificationsQuery.isLoading ? (
          <div className="flex min-h-32 items-center justify-center text-sm text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando notificações…
          </div>
        ) : notificationsQuery.isError ? (
          <div className="p-4 text-sm">
            <p className="flex items-center font-medium text-red-800">
              <AlertCircle className="mr-2 h-4 w-4" />
              Não foi possível carregar as notificações
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => notificationsQuery.refetch()}
              className="mt-3 h-9 rounded-[8px]"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        ) : notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">
            Nenhuma notificação.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => openNotification(notification)}
                  className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      notification.readAt === null ? 'bg-brand-primary' : 'bg-slate-300'
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium uppercase tracking-wide text-text-muted">
                      {typeLabel[notification.notificationType]}
                    </span>
                    <span className="mt-0.5 block font-medium text-text-primary">
                      {notification.label}
                    </span>
                    <span className="mt-1 block text-xs text-text-muted">
                      {occurredLabel(notification.occurredAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {markRead.isError ? (
          <p role="alert" className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800">
            Não foi possível atualizar a leitura. Tente novamente.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
