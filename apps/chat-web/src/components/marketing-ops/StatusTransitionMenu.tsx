import { ChevronDown, CircleArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type {
  MarketingOpsCampaignStatus,
  MarketingOpsTransitionTarget
} from '@/lib/marketingOps/types';

interface TransitionOption {
  to: MarketingOpsTransitionTarget;
  label: string;
}

const forwardTransitions: Partial<Record<MarketingOpsCampaignStatus, TransitionOption>> = {
  draft: { to: 'planned', label: 'Planejar' },
  planned: { to: 'active', label: 'Ativar' },
  active: { to: 'completed', label: 'Concluir' }
};

const reopenTransitions: Partial<Record<MarketingOpsCampaignStatus, TransitionOption>> = {
  planned: { to: 'draft', label: 'Reabrir como rascunho' },
  active: { to: 'planned', label: 'Retornar para planejada' },
  completed: { to: 'active', label: 'Reabrir como ativa' }
};

interface StatusTransitionMenuProps {
  status: MarketingOpsCampaignStatus;
  canWrite: boolean;
  canReopen: boolean;
  disabled: boolean;
  onTransition: (to: MarketingOpsTransitionTarget) => void;
}

export function StatusTransitionMenu({
  status,
  canWrite,
  canReopen,
  disabled,
  onTransition
}: StatusTransitionMenuProps) {
  if (!canWrite || status === 'archived') return null;
  const forward = forwardTransitions[status];
  const reopen = canReopen ? reopenTransitions[status] : undefined;
  if (!forward && !reopen) return null;

  return (
    <div className="flex items-center gap-2">
      {forward ? (
        <Button
          type="button"
          disabled={disabled}
          onClick={() => onTransition(forward.to)}
          className="h-11 rounded-[8px]"
        >
          {forward.label}
          <CircleArrowRight className="ml-2 h-4 w-4" />
        </Button>
      ) : null}

      {reopen ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label="Outras transições"
              className="h-11 w-11 rounded-[8px] bg-white/80"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-[8px] border-white/60 bg-white/90 shadow-glass backdrop-blur-xl">
            <DropdownMenuItem onSelect={() => onTransition(reopen.to)} className="min-h-10">
              {reopen.label}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
