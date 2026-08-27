import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { marketingOpsKeys } from '@/lib/marketingOps/queryKeys';
import { localDateTimeToUtc } from '@/lib/marketingOps/timezone';
import type {
  MarketingOpsItemPriority,
  MarketingOpsProductionBatchAction,
  MarketingOpsProductionBatchResult,
  MarketingOpsProductionScheduleItem
} from '@/lib/marketingOps/types';

interface ProductionBatchDialogProps {
  open: boolean;
  selectedItems: MarketingOpsProductionScheduleItem[];
  timeZone: string;
  client: MarketingOpsClient;
  createIdempotencyKey: () => string;
  onOpenChange: (open: boolean) => void;
  onComplete: (result: MarketingOpsProductionBatchResult) => void;
}

type ActionType = MarketingOpsProductionBatchAction['type'];
const selectClass = 'h-11 w-full rounded-[8px] border border-input bg-white/80 px-3 text-sm text-text-primary outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20';

export function ProductionBatchDialog({
  open,
  selectedItems,
  timeZone,
  client,
  createIdempotencyKey,
  onOpenChange,
  onComplete
}: ProductionBatchDialogProps) {
  const queryClient = useQueryClient();
  const [actionType, setActionType] = useState<ActionType>('priority');
  const [priority, setPriority] = useState<MarketingOpsItemPriority>('normal');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [result, setResult] = useState<MarketingOpsProductionBatchResult | null>(null);

  useEffect(() => {
    if (open) return;
    setActionType('priority');
    setPriority('normal');
    setAssigneeUserId('');
    setStartsAt('');
    setDueAt('');
    setValidationMessage(null);
    setResult(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: (action: MarketingOpsProductionBatchAction) =>
      client.executeProductionBatch({
        items: selectedItems.map((item) => ({
          itemId: item.id,
          version: item.version
        })),
        action
      }, createIdempotencyKey()),
    onSuccess: async (response) => {
      setResult(response.data);
      onComplete(response.data);
      await queryClient.invalidateQueries({
        queryKey: marketingOpsKeys.productionSchedule()
      });
    }
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setValidationMessage(null);
    setResult(null);
    try {
      let action: MarketingOpsProductionBatchAction;
      if (actionType === 'priority') {
        action = { type: 'priority', priority };
      } else if (actionType === 'reassign') {
        const normalized = assigneeUserId.trim();
        action = { type: 'reassign', assigneeUserId: normalized || null };
      } else {
        if (!startsAt && !dueAt) {
          setValidationMessage('Informe o novo início ou o novo prazo.');
          return;
        }
        action = {
          type: 'reschedule',
          ...(startsAt ? { startsAt: localDateTimeToUtc(startsAt, timeZone) } : {}),
          ...(dueAt ? { dueAt: localDateTimeToUtc(dueAt, timeZone) } : {})
        };
      }
      mutation.mutate(action);
    } catch {
      setValidationMessage('Revise as datas informadas.');
    }
  };

  const itemTitle = (itemId: string) =>
    selectedItems.find((item) => item.id === itemId)?.title ?? itemId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-surface max-h-[90vh] overflow-y-auto rounded-[8px] border-white/60 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ação em lote</DialogTitle>
          <DialogDescription>
            {selectedItems.length} {selectedItems.length === 1 ? 'item selecionado' : 'itens selecionados'}.
            Cada item mantém sua própria versão e seu resultado será exibido abaixo.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="batch-action">Ação em lote</Label>
            <select
              id="batch-action"
              value={actionType}
              onChange={(event) => {
                setActionType(event.target.value as ActionType);
                setValidationMessage(null);
                setResult(null);
              }}
              className={selectClass}
            >
              <option value="priority">Alterar prioridade</option>
              <option value="reassign">Reatribuir responsável</option>
              <option value="reschedule">Reagendar</option>
            </select>
          </div>

          {actionType === 'priority' ? (
            <div className="space-y-2">
              <Label htmlFor="batch-priority">Nova prioridade</Label>
              <select
                id="batch-priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value as MarketingOpsItemPriority)}
                className={selectClass}
              >
                <option value="low">Baixa</option>
                <option value="normal">Normal</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
          ) : null}

          {actionType === 'reassign' ? (
            <div className="space-y-2">
              <Label htmlFor="batch-assignee">Novo responsável</Label>
              <Input
                id="batch-assignee"
                value={assigneeUserId}
                onChange={(event) => setAssigneeUserId(event.target.value)}
                placeholder="UUID; vazio remove a atribuição"
                className="h-11 rounded-[8px] bg-white/80"
              />
              <p className="text-xs text-text-muted">
                Deixe vazio para remover a atribuição atual.
              </p>
            </div>
          ) : null}

          {actionType === 'reschedule' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="batch-starts-at">Novo início</Label>
                <Input
                  id="batch-starts-at"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  className="h-11 rounded-[8px] bg-white/80"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch-due-at">Novo prazo</Label>
                <Input
                  id="batch-due-at"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                  className="h-11 rounded-[8px] bg-white/80"
                />
              </div>
              <p className="text-xs text-text-muted sm:col-span-2">
                Fuso aplicado: {timeZone}.
              </p>
            </div>
          ) : null}

          {validationMessage ? (
            <p role="alert" className="flex items-center text-sm text-red-800">
              <AlertCircle className="mr-2 h-4 w-4" />
              {validationMessage}
            </p>
          ) : null}

          {mutation.isError ? (
            <p role="alert" className="flex items-center rounded-[8px] bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="mr-2 h-4 w-4" />
              Não foi possível executar o lote. Nenhum resultado foi ocultado.
            </p>
          ) : null}

          {result ? (
            <section aria-live="polite" className="rounded-[8px] border border-slate-200 bg-white/70 p-3">
              <div className="flex flex-wrap gap-2 text-sm font-medium">
                <span className="inline-flex items-center text-emerald-800">
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  {result.succeeded} {result.succeeded === 1 ? 'atualizado' : 'atualizados'}
                </span>
                <span className="inline-flex items-center text-red-800">
                  <XCircle className="mr-1.5 h-4 w-4" />
                  {result.failed} {result.failed === 1 ? 'falhou' : 'falharam'}
                </span>
              </div>
              {result.results.some((itemResult) => !itemResult.ok) ? (
                <ul className="mt-3 space-y-2 text-sm">
                  {result.results.filter((itemResult) => !itemResult.ok).map((itemResult) => (
                    <li key={itemResult.itemId} className="rounded-[6px] bg-red-50 p-2 text-red-900">
                      <span className="font-medium">{itemTitle(itemResult.itemId)}</span>
                      <span className="block text-xs">
                        {itemResult.error.message}
                        {itemResult.error.currentVersion
                          ? ` · versão atual ${itemResult.error.currentVersion}`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-[8px]"
            >
              Fechar
            </Button>
            <Button
              type="submit"
              disabled={selectedItems.length === 0 || mutation.isPending}
              className="h-10 rounded-[8px] text-slate-950"
            >
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Aplicar em {selectedItems.length} {selectedItems.length === 1 ? 'item' : 'itens'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
