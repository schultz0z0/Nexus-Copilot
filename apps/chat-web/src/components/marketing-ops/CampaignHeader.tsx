import { Archive, ArrowLeft, LockKeyhole } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  MarketingOpsCampaign,
  MarketingOpsCampaignStatus,
  MarketingOpsTransitionTarget
} from '@/lib/marketingOps/types';
import { cn } from '@/lib/utils';
import { StatusTransitionMenu } from './StatusTransitionMenu';

const statusLabels: Record<MarketingOpsCampaignStatus, string> = {
  draft: 'Rascunho',
  planned: 'Planejada',
  active: 'Ativa',
  completed: 'Concluída',
  archived: 'Arquivada'
};

const statusClasses: Record<MarketingOpsCampaignStatus, string> = {
  draft: 'border-slate-300 bg-slate-100 text-slate-700',
  planned: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  completed: 'border-blue-200 bg-blue-50 text-blue-800',
  archived: 'border-zinc-300 bg-zinc-100 text-zinc-600'
};

interface CampaignHeaderProps {
  campaign: MarketingOpsCampaign;
  canWrite: boolean;
  canTransition: boolean;
  canArchive: boolean;
  dirty: boolean;
  busy: boolean;
  onBack: () => void;
  onTransition: (to: MarketingOpsTransitionTarget) => void;
  onArchive: () => void;
}

export function CampaignHeader({
  campaign,
  canWrite,
  canTransition,
  canArchive,
  dirty,
  busy,
  onBack,
  onTransition,
  onArchive
}: CampaignHeaderProps) {
  const readOnly = campaign.status === 'archived' || !canWrite;
  return (
    <header className="glass-surface border-b border-white/50 px-4 py-5 shadow-sm sm:px-6 md:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Voltar para campanhas"
            className="mb-3 h-10 w-10 rounded-[8px]"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('rounded-full font-medium', statusClasses[campaign.status])}>
              {statusLabels[campaign.status]}
            </Badge>
            <span className="text-xs text-text-muted">Versão {campaign.version}</span>
            {readOnly ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                <LockKeyhole className="h-3.5 w-3.5" />
                Somente leitura
              </span>
            ) : null}
          </div>
          <h1 className="mt-2 break-words text-2xl font-bold text-text-primary sm:text-3xl">{campaign.name}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusTransitionMenu
            status={campaign.status}
            canWrite={canTransition}
            canReopen={canArchive}
            disabled={busy || dirty}
            onTransition={onTransition}
          />
          {canArchive && campaign.status !== 'archived' ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy || dirty}
              onClick={onArchive}
              className="h-11 rounded-[8px] bg-white/80"
            >
              <Archive className="mr-2 h-4 w-4" />
              Arquivar campanha
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
