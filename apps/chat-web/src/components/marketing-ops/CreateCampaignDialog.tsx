import { Loader2 } from 'lucide-react';
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

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
  pending: boolean;
  error: unknown;
}

function errorDetails(error: unknown): { message: string; correlationId: string | null } | null {
  if (!error) return null;
  const candidate = error as { message?: unknown; correlationId?: unknown };
  return {
    message: typeof candidate.message === 'string' ? candidate.message : 'Não foi possível criar a campanha.',
    correlationId: typeof candidate.correlationId === 'string' ? candidate.correlationId : null
  };
}

export function CreateCampaignDialog({
  open,
  onOpenChange,
  onCreate,
  pending,
  error
}: CreateCampaignDialogProps) {
  const [name, setName] = useState('');
  const details = errorDetails(error);

  useEffect(() => {
    if (!open) setName('');
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized || pending) return;
    await onCreate(normalized);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[8px] border-white/60 bg-white/90 text-text-primary shadow-glass backdrop-blur-xl sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Nova campanha</DialogTitle>
            <DialogDescription>
              Crie o rascunho agora. Os demais campos serão preenchidos no workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-2">
            <Label htmlFor="campaign-name">Nome</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              maxLength={200}
              aria-invalid={Boolean(details)}
              aria-describedby={details ? 'campaign-create-error' : undefined}
              className="h-11 rounded-[8px] bg-white/80"
            />
            {details ? (
              <div id="campaign-create-error" role="alert" className="rounded-[8px] border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p>{details.message}</p>
                {details.correlationId ? <p className="mt-1 text-xs">Correlação: {details.correlationId}</p> : null}
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-6 gap-2 sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending} className="rounded-[8px]">
              Cancelar
            </Button>
            <Button type="submit" disabled={!name.trim() || pending} className="rounded-[8px]">
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
