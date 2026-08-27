import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { MarketingOpsApprovalFilters } from '@/lib/marketingOps/types';

interface ApprovalFiltersProps {
  filters: MarketingOpsApprovalFilters;
  onChange: (key: 'status' | 'kind' | 'riskLevel' | 'campaignId' | 'requestedBy' | 'expiresBefore' | 'expiresAfter', value?: string) => void;
  onReset: () => void;
}

export function ApprovalFilters({ filters, onChange, onReset }: ApprovalFiltersProps) {
  const [campaignId, setCampaignId] = useState(filters.campaignId ?? '');
  const [requestedBy, setRequestedBy] = useState(filters.requestedBy ?? '');
  useEffect(() => setCampaignId(filters.campaignId ?? ''), [filters.campaignId]);
  useEffect(() => setRequestedBy(filters.requestedBy ?? ''), [filters.requestedBy]);
  return (
    <div className="glass-surface shadow-glass grid gap-3 rounded-lg border-white/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm font-medium">Status
        <select aria-label="Status" value={filters.status ?? ''} onChange={(event) => onChange('status', event.target.value || undefined)} className="h-10 rounded-md border bg-white px-3">
          <option value="">Todos</option><option value="pending">Pendente</option>
          <option value="approved">Aprovada</option><option value="rejected">Rejeitada</option>
          <option value="changes_requested">Ajustes solicitados</option><option value="cancelled">Cancelada</option>
          <option value="expired">Expirada</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">Tipo
        <select aria-label="Tipo" value={filters.kind ?? ''} onChange={(event) => onChange('kind', event.target.value || undefined)} className="h-10 rounded-md border bg-white px-3">
          <option value="">Todos</option><option value="editorial">Editorial</option><option value="operational">Operacional</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">Risco
        <select aria-label="Risco" value={filters.riskLevel ?? ''} onChange={(event) => onChange('riskLevel', event.target.value || undefined)} className="h-10 rounded-md border bg-white px-3">
          <option value="">Todos</option><option value="low">Baixo</option><option value="medium">Médio</option>
          <option value="high">Alto</option><option value="critical">Crítico</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">Campanha
        <input aria-label="Campanha" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} onBlur={() => onChange('campaignId', campaignId || undefined)} placeholder="UUID da campanha" className="h-10 rounded-md border bg-white px-3" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Solicitante
        <input aria-label="Solicitante" value={requestedBy} onChange={(event) => setRequestedBy(event.target.value)} onBlur={() => onChange('requestedBy', requestedBy || undefined)} placeholder="UUID do solicitante" className="h-10 rounded-md border bg-white px-3" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Expira a partir de
        <input type="date" aria-label="Expira a partir de" value={filters.expiresAfter?.slice(0, 10) ?? ''} onChange={(event) => onChange('expiresAfter', event.target.value ? `${event.target.value}T00:00:00.000Z` : undefined)} className="h-10 rounded-md border bg-white px-3" />
      </label>
      <label className="grid gap-1 text-sm font-medium">Expira até
        <input type="date" aria-label="Expira até" value={filters.expiresBefore?.slice(0, 10) ?? ''} onChange={(event) => onChange('expiresBefore', event.target.value ? `${event.target.value}T23:59:59.999Z` : undefined)} className="h-10 rounded-md border bg-white px-3" />
      </label>
      <Button type="button" variant="outline" onClick={onReset} className="self-end">Limpar filtros</Button>
    </div>
  );
}
