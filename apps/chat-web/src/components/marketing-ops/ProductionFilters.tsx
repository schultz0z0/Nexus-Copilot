import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  MarketingOpsCampaignChannel,
  MarketingOpsCampaignSummary,
  MarketingOpsItemKind,
  MarketingOpsItemPriority,
  MarketingOpsItemStatus,
  MarketingOpsProductionScheduleFilters
} from '@/lib/marketingOps/types';
import type { ProductionScheduleUrlFilter } from '@/lib/marketingOps/scheduleUrl';

interface ProductionFiltersProps {
  filters: MarketingOpsProductionScheduleFilters;
  campaigns: MarketingOpsCampaignSummary[];
  assigneeValue: string;
  assigneeInvalid: boolean;
  onAssigneeChange: (value: string) => void;
  onAssigneeCommit: () => void;
  onFilterChange: (key: ProductionScheduleUrlFilter, value?: string) => void;
  onReset: () => void;
  hasFilters: boolean;
}

const kinds: Array<{ value: MarketingOpsItemKind; label: string }> = [
  { value: 'task', label: 'Tarefa' },
  { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'post', label: 'Post' },
  { value: 'creative', label: 'Criativo' },
  { value: 'review', label: 'Revisão' },
  { value: 'milestone', label: 'Marco' }
];
const statuses: Array<{ value: MarketingOpsItemStatus; label: string }> = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'ready', label: 'Pronto' },
  { value: 'in_review', label: 'Em revisão' },
  { value: 'completed', label: 'Concluído' },
  { value: 'cancelled', label: 'Cancelado' }
];
const priorities: Array<{ value: MarketingOpsItemPriority; label: string }> = [
  { value: 'low', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' }
];
const channels: Array<{ value: MarketingOpsCampaignChannel; label: string }> = [
  { value: 'email', label: 'E-mail' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'website', label: 'Site' },
  { value: 'paid_media', label: 'Mídia paga' },
  { value: 'events', label: 'Eventos' },
  { value: 'press', label: 'Imprensa' },
  { value: 'other', label: 'Outro' }
];
const selectClass = 'h-11 w-full rounded-[8px] border border-input bg-white/80 px-3 text-sm text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20';

export function ProductionFilters({
  filters,
  campaigns,
  assigneeValue,
  assigneeInvalid,
  onAssigneeChange,
  onAssigneeCommit,
  onFilterChange,
  onReset,
  hasFilters
}: ProductionFiltersProps) {
  return (
    <section
      aria-label="Filtros de produção"
      className="glass-surface shadow-glass rounded-[8px] border-white/60 px-4 py-4 sm:px-5"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
        <div className="space-y-1.5 xl:col-span-3">
          <Label htmlFor="production-campaign">Campanha</Label>
          <select
            id="production-campaign"
            className={selectClass}
            value={filters.campaignId ?? ''}
            onChange={(event) => onFilterChange('campaignId', event.target.value || undefined)}
          >
            <option value="">Todas</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
            ))}
          </select>
        </div>

        <FilterSelect id="production-status" label="Status" value={filters.status} options={statuses}
          onChange={(value) => onFilterChange('status', value)} />
        <FilterSelect id="production-kind" label="Tipo" value={filters.kind} options={kinds}
          onChange={(value) => onFilterChange('kind', value)} />
        <FilterSelect id="production-priority" label="Prioridade" value={filters.priority} options={priorities}
          onChange={(value) => onFilterChange('priority', value)} />
        <FilterSelect id="production-channel" label="Canal" value={filters.channel} options={channels}
          onChange={(value) => onFilterChange('channel', value)} />

        <div className="space-y-1.5 xl:col-span-2">
          <Label htmlFor="production-assignee">Responsável</Label>
          <Input
            id="production-assignee"
            value={assigneeValue}
            onChange={(event) => onAssigneeChange(event.target.value)}
            onBlur={onAssigneeCommit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onAssigneeCommit();
              }
            }}
            placeholder="ID do usuário"
            aria-invalid={assigneeInvalid}
            aria-describedby={assigneeInvalid ? 'production-assignee-error' : undefined}
            className="h-11 rounded-[8px] bg-white/80"
          />
          {assigneeInvalid ? (
            <p id="production-assignee-error" className="text-xs text-red-700">
              Informe um ID de usuário válido.
            </p>
          ) : null}
        </div>

        <div className="flex items-end xl:col-span-2">
          <Button
            type="button"
            variant="outline"
            onClick={onReset}
            disabled={!hasFilters}
            className="h-11 w-full rounded-[8px]"
          >
            <X className="mr-2 h-4 w-4" />
            Limpar filtros
          </Button>
        </div>
      </div>
    </section>
  );
}

interface FilterSelectProps {
  id: string;
  label: string;
  value?: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value?: string) => void;
}

function FilterSelect({ id, label, value, options, onChange }: FilterSelectProps) {
  return (
    <div className="space-y-1.5 xl:col-span-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={selectClass}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}
