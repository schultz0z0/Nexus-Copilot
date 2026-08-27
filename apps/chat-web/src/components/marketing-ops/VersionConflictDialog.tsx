import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import type { MarketingOpsCampaign, MarketingOpsCampaignPatch } from '@/lib/marketingOps/types';

const fieldLabels: Record<string, string> = {
  name: 'Nome',
  objective: 'Objetivo',
  referenceType: 'Tipo de referência',
  referenceKey: 'Identificador da referência',
  referenceTitleSnapshot: 'Título da referência',
  referenceDocumentId: 'Documento oficial',
  audience: 'Público',
  startsOn: 'Início',
  endsOn: 'Término',
  primaryChannel: 'Canal principal',
  secondaryChannels: 'Canais secundários',
  briefing: 'Briefing',
  notes: 'Notas'
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Não definido';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Nenhum';
  return String(value);
}

interface VersionConflictDialogProps {
  open: boolean;
  current: MarketingOpsCampaign | null;
  patch: MarketingOpsCampaignPatch;
  pending: boolean;
  onDiscard: () => void;
  onReapply: () => void;
}

export function VersionConflictDialog({
  open,
  current,
  patch,
  pending,
  onDiscard,
  onReapply
}: VersionConflictDialogProps) {
  const fields = Object.keys(patch);
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto rounded-[8px] border-white/60 bg-white/90 text-text-primary shadow-glass backdrop-blur-xl [&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Conflito de versão</DialogTitle>
          <DialogDescription>
            A campanha mudou desde a última leitura. Revise os campos antes de continuar.
          </DialogDescription>
        </DialogHeader>

        {current ? (
          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {fields.map((field) => (
              <div key={field} className="grid gap-3 py-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-text-muted">Atual · {fieldLabels[field] ?? field}</p>
                  <p className="mt-1 break-words text-sm text-text-secondary">
                    {displayValue((current as unknown as Record<string, unknown>)[field])}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-brand-primary">Sua edição</p>
                  <p className="mt-1 break-words text-sm font-medium text-text-primary">
                    {displayValue((patch as Record<string, unknown>)[field])}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" disabled={pending} onClick={onDiscard} className="rounded-[8px]">
            Descartar minhas alterações
          </Button>
          <Button type="button" disabled={pending || !current} onClick={onReapply} className="rounded-[8px]">
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Reaplicar minhas alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
