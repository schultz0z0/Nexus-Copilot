import { Search, X } from 'lucide-react';
import { KeyboardEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  MarketingOpsCampaignChannel,
  MarketingOpsCampaignFilters,
  MarketingOpsCampaignStatus,
  MarketingOpsReferenceType
} from '@/lib/marketingOps/types';

interface CampaignFiltersProps {
  filters: MarketingOpsCampaignFilters;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onFilterChange: (key: keyof MarketingOpsCampaignFilters, value?: string) => void;
  onReset: () => void;
  hasFilters: boolean;
}

const statuses: Array<{ value: MarketingOpsCampaignStatus; label: string }> = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'planned', label: 'Planejada' },
  { value: 'active', label: 'Ativa' },
  { value: 'completed', label: 'Concluída' },
  { value: 'archived', label: 'Arquivada' }
];

const references: Array<{ value: MarketingOpsReferenceType; label: string }> = [
  { value: 'course', label: 'Curso' },
  { value: 'product', label: 'Produto' },
  { value: 'initiative', label: 'Iniciativa' }
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
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function CampaignFilters({
  filters,
  searchValue,
  onSearchChange,
  onFilterChange,
  onReset,
  hasFilters
}: CampaignFiltersProps) {
  const [responsibleValue, setResponsibleValue] = useState(filters.responsible ?? '');
  const [responsibleInvalid, setResponsibleInvalid] = useState(false);

  useEffect(() => {
    setResponsibleValue(filters.responsible ?? '');
    setResponsibleInvalid(false);
  }, [filters.responsible]);

  const commitResponsible = () => {
    const normalized = responsibleValue.trim();
    const valid = !normalized || uuidPattern.test(normalized);
    setResponsibleInvalid(!valid);
    if (valid) onFilterChange('responsible', normalized || undefined);
  };

  const handleResponsibleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitResponsible();
    }
  };

  return (
    <section aria-label="Filtros de campanhas" className="glass-surface shadow-glass rounded-[8px] border-white/60 px-4 py-4 sm:px-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-12">
        <div className="space-y-1.5 xl:col-span-4">
          <Label htmlFor="campaign-search">Buscar campanhas</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              id="campaign-search"
              type="search"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Nome ou referência"
              maxLength={200}
              className="h-11 rounded-[8px] bg-white/80 pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5 xl:col-span-2">
          <Label htmlFor="campaign-status">Status</Label>
          <select
            id="campaign-status"
            className={selectClass}
            value={filters.status ?? ''}
            onChange={(event) => onFilterChange('status', event.target.value || undefined)}
          >
            <option value="">Todos</option>
            {statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
          </select>
        </div>

        <div className="space-y-1.5 xl:col-span-2">
          <Label htmlFor="campaign-reference">Referência</Label>
          <select
            id="campaign-reference"
            className={selectClass}
            value={filters.referenceType ?? ''}
            onChange={(event) => onFilterChange('referenceType', event.target.value || undefined)}
          >
            <option value="">Todas</option>
            {references.map((reference) => <option key={reference.value} value={reference.value}>{reference.label}</option>)}
          </select>
        </div>

        <div className="space-y-1.5 xl:col-span-2">
          <Label htmlFor="campaign-channel">Canal</Label>
          <select
            id="campaign-channel"
            className={selectClass}
            value={filters.channel ?? ''}
            onChange={(event) => onFilterChange('channel', event.target.value || undefined)}
          >
            <option value="">Todos</option>
            {channels.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}
          </select>
        </div>

        <div className="space-y-1.5 xl:col-span-2">
          <Label htmlFor="campaign-responsible">Responsável</Label>
          <Input
            id="campaign-responsible"
            value={responsibleValue}
            onChange={(event) => {
              setResponsibleValue(event.target.value);
              setResponsibleInvalid(false);
            }}
            onBlur={commitResponsible}
            onKeyDown={handleResponsibleKeyDown}
            placeholder="ID do usuário"
            aria-invalid={responsibleInvalid}
            aria-describedby={responsibleInvalid ? 'campaign-responsible-error' : undefined}
            className="h-11 rounded-[8px] bg-white/80"
          />
          {responsibleInvalid ? (
            <p id="campaign-responsible-error" className="text-xs text-red-700">Informe um ID de usuário válido.</p>
          ) : null}
        </div>

        <div className="space-y-1.5 md:col-span-1 xl:col-span-2">
          <Label htmlFor="campaign-period-from">Período a partir de</Label>
          <Input
            id="campaign-period-from"
            type="date"
            value={filters.periodFrom ?? ''}
            onChange={(event) => onFilterChange('periodFrom', event.target.value || undefined)}
            className="h-11 rounded-[8px] bg-white/80"
          />
        </div>

        <div className="space-y-1.5 md:col-span-1 xl:col-span-2">
          <Label htmlFor="campaign-period-to">Período até</Label>
          <Input
            id="campaign-period-to"
            type="date"
            value={filters.periodTo ?? ''}
            onChange={(event) => onFilterChange('periodTo', event.target.value || undefined)}
            className="h-11 rounded-[8px] bg-white/80"
          />
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
