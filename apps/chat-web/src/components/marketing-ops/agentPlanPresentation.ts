import type { MarketingOpsPlanAction, MarketingOpsPreparedPlanStatus } from '@/lib/marketingOps/types';

export interface PresentedAction {
  supported: boolean;
  title: string;
  description: string;
}

export function formatShortHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return hash.slice(0, 12);
}

export function formatShortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-12)}`;
}

export function planStatusPresentation(status: MarketingOpsPreparedPlanStatus): {
  label: string;
  tone: 'warning' | 'info' | 'success' | 'destructive' | 'muted';
} {
  switch (status) {
    case 'pending':
      return { label: 'Pendente', tone: 'warning' };
    case 'executing':
      return { label: 'Executando...', tone: 'info' };
    case 'completed':
      return { label: 'Concluído', tone: 'success' };
    case 'partial':
      return { label: 'Parcial', tone: 'warning' };
    case 'failed':
      return { label: 'Falhou', tone: 'destructive' };
    case 'expired':
      return { label: 'Expirado', tone: 'muted' };
    case 'invalidated':
      return { label: 'Invalidado', tone: 'muted' };
    default:
      return { label: status, tone: 'muted' };
  }
}

export function presentPlanAction(action: MarketingOpsPlanAction): PresentedAction {
  switch (action.type) {
    case 'campaign.create_draft': {
      const parts = [`Nome: "${action.name}"`];
      if (action.course_slug) parts.push(`Curso: ${action.course_slug}`);
      if (action.ref) parts.push(`Ref: ${action.ref}`);
      return {
        supported: true,
        title: 'Criar rascunho de campanha',
        description: parts.join(' | ')
      };
    }

    case 'campaign.update': {
      const patchKeys = Object.keys(action.patch ?? {}).join(', ');
      return {
        supported: true,
        title: 'Atualizar campanha',
        description: `Campanha: ${formatShortId(action.campaign_id)} | versão ${action.expected_version} | Campos: ${patchKeys || '—'}`
      };
    }

    case 'campaign_item.create': {
      const parts = [`Título: "${action.title}"`];
      if (action.priority) parts.push(`Prioridade: ${action.priority}`);
      if (action.channel) parts.push(`Canal: ${action.channel}`);
      if (action.description) parts.push(`Descrição: ${action.description}`);
      return {
        supported: true,
        title: `Criar item de campanha (${action.kind})`,
        description: parts.join(' | ')
      };
    }

    case 'campaign_item.patch': {
      const patchKeys = Object.keys(action.patch ?? {}).join(', ');
      return {
        supported: true,
        title: 'Atualizar item de campanha',
        description: `Item: ${formatShortId(action.item_id)} | versão ${action.expected_version} | Campos: ${patchKeys || '—'}`
      };
    }

    case 'campaign_item.transition': {
      return {
        supported: true,
        title: `Transicionar item para ${action.to}`,
        description: `Item: ${formatShortId(action.item_id)} | versão esperada ${action.expected_version}`
      };
    }

    case 'content.create_draft': {
      return {
        supported: true,
        title: `Criar rascunho de conteúdo (${action.kind})`,
        description: `Título: "${action.title}" | Item: ${formatShortId(action.item_id)} | Ref: ${action.ref}`
      };
    }

    case 'content.version_create': {
      const preview = action.body ? (action.body.length > 80 ? `${action.body.slice(0, 80)}...` : action.body) : '—';
      const ref = action.asset_id ? `Asset: ${formatShortId(action.asset_id)}` : `Ref: ${action.asset_ref ?? '—'}`;
      return {
        supported: true,
        title: 'Criar versão de conteúdo',
        description: `${ref} | Conteúdo: "${preview}"`
      };
    }

    case 'approval.submit_editorial': {
      const parts = [
        `Campanha: ${formatShortId(action.campaign_id)}`,
        `Asset: ${formatShortId(action.asset_id)}`,
        `Motivo: "${action.reason}"`
      ];
      return {
        supported: true,
        title: `Solicitar aprovação editorial (versão ${action.version_number})`,
        description: parts.join(' | ')
      };
    }

    case 'approval.submit_operational': {
      const pkg = action.action_package as Record<string, unknown> | undefined;
      const actionType = pkg?.actionType ? String(pkg.actionType) : 'pacote operacional';
      return {
        supported: true,
        title: 'Solicitar aprovação operacional',
        description: `Ação: ${actionType} | Motivo: "${action.reason}"`
      };
    }

    default: {
      const typeStr = typeof action?.type === 'string' ? action.type : 'desconhecido';
      return {
        supported: false,
        title: 'Ação não suportada',
        description: `Tipo de ação não reconhecido: ${typeStr}`
      };
    }
  }
}

export function hasUnsupportedActions(actions: MarketingOpsPlanAction[]): boolean {
  return actions.some((action) => !presentPlanAction(action).supported);
}

export function hasCriticalRisk(actions: MarketingOpsPlanAction[]): boolean {
  return actions.some((action) => {
    const raw = action as Record<string, unknown>;
    return raw.risk_level === 'critical' || (raw.action_package as Record<string, unknown> | undefined)?.riskLevel === 'critical';
  });
}
