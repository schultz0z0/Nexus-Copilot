import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { MarketingOpsApprovalDecisionInput } from '@/lib/marketingOps/types';

interface ApprovalDecisionDialogProps {
  decision: MarketingOpsApprovalDecisionInput['decision'] | null;
  pending: boolean;
  criticalRisk?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: MarketingOpsApprovalDecisionInput) => Promise<void>;
}

const labels = { approved: 'Aprovar', rejected: 'Rejeitar', changes_requested: 'Solicitar ajustes' };

export function ApprovalDecisionDialog({ decision, pending, criticalRisk = false, onOpenChange, onConfirm }: ApprovalDecisionDialogProps) {
  const [comment, setComment] = useState('');
  const [criticalConfirmed, setCriticalConfirmed] = useState(false);
  useEffect(() => { if (decision) { setComment(''); setCriticalConfirmed(false); } }, [decision]);
  const required = decision === 'rejected' || decision === 'changes_requested';
  return (
    <Dialog open={decision !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{decision ? labels[decision] : 'Decisão'}</DialogTitle>
          <DialogDescription>A decisão é única, auditável e não executa ações externas.</DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm font-medium">Comentário
          <Textarea aria-label="Comentário" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={4000} />
        </label>
        {criticalRisk ? <label className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium">
          <input type="checkbox" aria-label="Confirmar risco crítico" checked={criticalConfirmed} onChange={(event) => setCriticalConfirmed(event.target.checked)} />
          Confirmo que revisei o risco crítico e o alvo imutável desta decisão.
        </label> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!decision || pending || (required && !comment.trim()) || (criticalRisk && !criticalConfirmed)} onClick={() => {
            if (!decision) return;
            void onConfirm({ decision, ...(comment.trim() ? { comment: comment.trim() } : {}) });
          }}>Confirmar decisão</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
