import { AlertTriangle, ArrowRight, CalendarDays, Radio, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  MarketingOpsCampaignAttention,
  MarketingOpsCampaignChannel,
  MarketingOpsCampaignStatus,
  MarketingOpsCampaignSummary
} from '@/lib/marketingOps/types';
import { cn } from '@/lib/utils';

interface CampaignTableProps {
  campaigns: MarketingOpsCampaignSummary[];
  onOpen: (campaignId: string) => void;
}

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

const attentionLabels: Record<MarketingOpsCampaignAttention, string> = {
  missing_primary_owner: 'Sem responsável principal',
  planned_start_due: 'Início planejado atingido',
  active_past_end: 'Prazo final ultrapassado'
};

const channelLabels: Record<MarketingOpsCampaignChannel, string> = {
  email: 'E-mail',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  website: 'Site',
  paid_media: 'Mídia paga',
  events: 'Eventos',
  press: 'Imprensa',
  other: 'Outro'
};

function channelLabel(channel: MarketingOpsCampaignChannel | null): string {
  return channel ? channelLabels[channel] : 'Não definido';
}

function formatDate(value: string | null): string {
  if (!value) return 'Sem data';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function StatusBadge({ status }: { status: MarketingOpsCampaignStatus }) {
  return (
    <Badge variant="outline" className={cn('rounded-full font-medium', statusClasses[status])}>
      {statusLabels[status]}
    </Badge>
  );
}

function Attention({ items }: { items: MarketingOpsCampaignAttention[] }) {
  if (items.length === 0) return <span className="text-xs text-text-muted">Sem alertas</span>;
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div key={item} className="flex items-start gap-1.5 text-xs font-medium text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{attentionLabels[item]}</span>
        </div>
      ))}
    </div>
  );
}

function ResponsibleNames({ campaign }: { campaign: MarketingOpsCampaignSummary }) {
  if (campaign.responsibles.length === 0) return <span className="text-text-muted">Não definido</span>;
  return (
    <div className="flex items-start gap-1.5">
      <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
      <span>{campaign.responsibles.map((responsible) => responsible.displayName).join(', ')}</span>
    </div>
  );
}

export function CampaignTable({ campaigns, onOpen }: CampaignTableProps) {
  return (
    <>
      <div className="glass-surface shadow-glass hidden overflow-hidden rounded-[8px] border-white/60 md:block">
        <Table>
          <TableHeader className="bg-white/45">
            <TableRow className="hover:bg-white/45">
              <TableHead className="w-[28%]">Campanha</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Responsáveis</TableHead>
              <TableHead>Atenção</TableHead>
              <TableHead className="w-12"><span className="sr-only">Abrir</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => (
              <TableRow key={campaign.id} className="group bg-white/35 hover:bg-white/55">
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onOpen(campaign.id)}
                    className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
                  >
                    <span className="block font-semibold text-text-primary group-hover:text-brand-primary">{campaign.name}</span>
                    <span className="mt-1 block text-xs text-text-muted">
                      {campaign.referenceTitleSnapshot ?? 'Sem referência'} · Atualizada {formatUpdatedAt(campaign.updatedAt)}
                    </span>
                  </button>
                </TableCell>
                <TableCell><StatusBadge status={campaign.status} /></TableCell>
                <TableCell className="text-xs text-text-secondary">
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="h-4 w-4 text-text-muted" />
                    <span>{formatDate(campaign.startsOn)} — {formatDate(campaign.endsOn)}</span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-text-secondary">
                  <div className="flex items-center gap-1.5">
                    <Radio className="h-4 w-4 text-text-muted" />
                    <span>{channelLabel(campaign.primaryChannel)}</span>
                  </div>
                </TableCell>
                <TableCell className="max-w-52 text-sm text-text-secondary"><ResponsibleNames campaign={campaign} /></TableCell>
                <TableCell className="max-w-52"><Attention items={campaign.attention} /></TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onOpen(campaign.id)}
                    aria-label={`Abrir campanha ${campaign.name}`}
                    className="h-10 w-10 rounded-[8px]"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-1 gap-3 md:hidden">
        {campaigns.map((campaign) => (
          <article key={campaign.id} className="glass-surface shadow-glass rounded-[8px] border-white/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpen(campaign.id)}
                  className="break-words text-left font-semibold text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                >
                  {campaign.name}
                </button>
                <p className="mt-1 text-xs text-text-muted">{campaign.referenceTitleSnapshot ?? 'Sem referência'}</p>
              </div>
              <StatusBadge status={campaign.status} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-text-muted">Período</dt>
                <dd className="mt-1 text-text-secondary">{formatDate(campaign.startsOn)} — {formatDate(campaign.endsOn)}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Canal</dt>
                <dd className="mt-1 text-text-secondary">{channelLabel(campaign.primaryChannel)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-text-muted">Responsáveis</dt>
                <dd className="mt-1 text-text-secondary"><ResponsibleNames campaign={campaign} /></dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-slate-100 pt-3">
              <Attention items={campaign.attention} />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-text-muted">Atualizada {formatUpdatedAt(campaign.updatedAt)}</span>
                <Button type="button" variant="outline" onClick={() => onOpen(campaign.id)} className="h-10 rounded-[8px]">
                  Abrir <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
