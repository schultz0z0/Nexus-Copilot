import { describe, expect, it } from 'vitest';
import {
  presentPlanAction,
  planStatusPresentation,
  hasUnsupportedActions,
  hasCriticalRisk,
  formatShortHash,
  formatShortId
} from './agentPlanPresentation';
import type { MarketingOpsPlanAction } from '@/lib/marketingOps/types';

describe('agentPlanPresentation', () => {
  it('formats short hash and short ID safely', () => {
    expect(formatShortHash('abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')).toBe('abcdef123456');
    expect(formatShortHash('short')).toBe('short');
    expect(formatShortId('11111111-2222-3333-4444-555555555555')).toBe('11111111...555555555555');
    expect(formatShortId('abc')).toBe('abc');
  });

  it('presents plan statuses with human-readable labels and tones', () => {
    expect(planStatusPresentation('pending')).toEqual({ label: 'Pendente', tone: 'warning' });
    expect(planStatusPresentation('executing')).toEqual({ label: 'Executando...', tone: 'info' });
    expect(planStatusPresentation('completed')).toEqual({ label: 'Concluído', tone: 'success' });
    expect(planStatusPresentation('partial')).toEqual({ label: 'Parcial', tone: 'warning' });
    expect(planStatusPresentation('failed')).toEqual({ label: 'Falhou', tone: 'destructive' });
    expect(planStatusPresentation('expired')).toEqual({ label: 'Expirado', tone: 'muted' });
    expect(planStatusPresentation('invalidated')).toEqual({ label: 'Invalidado', tone: 'muted' });
  });

  it('presents campaign.create_draft action', () => {
    const action: MarketingOpsPlanAction = {
      type: 'campaign.create_draft',
      ref: 'camp-1',
      name: 'Campanha de Primavera',
      course_slug: 'curso-design'
    };
    const presented = presentPlanAction(action);
    expect(presented.supported).toBe(true);
    expect(presented.title).toBe('Criar rascunho de campanha');
    expect(presented.description).toContain('Campanha de Primavera');
    expect(presented.description).toContain('curso-design');
  });

  it('presents campaign.update action', () => {
    const action: MarketingOpsPlanAction = {
      type: 'campaign.update',
      campaign_id: '11111111-1111-1111-1111-111111111111',
      expected_version: 2,
      patch: { objective: 'Aumentar conversão' }
    };
    const presented = presentPlanAction(action);
    expect(presented.supported).toBe(true);
    expect(presented.title).toBe('Atualizar campanha');
    expect(presented.description).toContain('versão 2');
  });

  it('presents campaign_item.create action', () => {
    const action: MarketingOpsPlanAction = {
      type: 'campaign_item.create',
      kind: 'email',
      title: 'E-mail de boas-vindas',
      priority: 'high',
      channel: 'email'
    };
    const presented = presentPlanAction(action);
    expect(presented.supported).toBe(true);
    expect(presented.title).toBe('Criar item de campanha (email)');
    expect(presented.description).toContain('E-mail de boas-vindas');
  });

  it('presents campaign_item.patch action', () => {
    const action: MarketingOpsPlanAction = {
      type: 'campaign_item.patch',
      item_id: '22222222-2222-2222-2222-222222222222',
      expected_version: 1,
      patch: { priority: 'urgent' }
    };
    const presented = presentPlanAction(action);
    expect(presented.supported).toBe(true);
    expect(presented.title).toBe('Atualizar item de campanha');
  });

  it('presents campaign_item.transition action', () => {
    const action: MarketingOpsPlanAction = {
      type: 'campaign_item.transition',
      item_id: '22222222-2222-2222-2222-222222222222',
      expected_version: 2,
      to: 'ready'
    };
    const presented = presentPlanAction(action);
    expect(presented.supported).toBe(true);
    expect(presented.title).toBe('Transicionar item para ready');
  });

  it('presents content.create_draft action', () => {
    const action: MarketingOpsPlanAction = {
      type: 'content.create_draft',
      ref: 'content-1',
      item_id: '22222222-2222-2222-2222-222222222222',
      kind: 'copy',
      title: 'Texto do e-mail'
    };
    const presented = presentPlanAction(action);
    expect(presented.supported).toBe(true);
    expect(presented.title).toBe('Criar rascunho de conteúdo (copy)');
    expect(presented.description).toContain('Texto do e-mail');
  });

  it('presents content.version_create action', () => {
    const action: MarketingOpsPlanAction = {
      type: 'content.version_create',
      asset_ref: 'content-1',
      body: 'Texto da nova versão de conteúdo'
    };
    const presented = presentPlanAction(action);
    expect(presented.supported).toBe(true);
    expect(presented.title).toBe('Criar versão de conteúdo');
  });

  it('presents approval.submit_editorial action with pending notice', () => {
    const action: MarketingOpsPlanAction = {
      type: 'approval.submit_editorial',
      campaign_id: '11111111-1111-1111-1111-111111111111',
      asset_id: '33333333-3333-3333-3333-333333333333',
      version_number: 1,
      reason: 'Revisão textual necessária'
    };
    const presented = presentPlanAction(action);
    expect(presented.supported).toBe(true);
    expect(presented.title).toBe('Solicitar aprovação editorial (versão 1)');
    expect(presented.description).toContain('Revisão textual necessária');
  });

  it('presents approval.submit_operational action', () => {
    const action: MarketingOpsPlanAction = {
      type: 'approval.submit_operational',
      campaign_id: '11111111-1111-1111-1111-111111111111',
      action_package: { actionType: 'send_broadcast_email' },
      reason: 'Envio em lote'
    };
    const presented = presentPlanAction(action);
    expect(presented.supported).toBe(true);
    expect(presented.title).toBe('Solicitar aprovação operacional');
    expect(presented.description).toContain('Envio em lote');
  });

  it('handles unknown actions gracefully with supported=false', () => {
    const action: MarketingOpsPlanAction = {
      type: 'malicious.or_unknown_action',
      foo: 'bar'
    };
    const presented = presentPlanAction(action);
    expect(presented.supported).toBe(false);
    expect(presented.title).toBe('Ação não suportada');
    expect(presented.description).toContain('malicious.or_unknown_action');
  });

  it('detects unsupported actions in a list', () => {
    const valid: MarketingOpsPlanAction[] = [{ type: 'campaign.create_draft', ref: 'c1', name: 'Valid' }];
    const invalid: MarketingOpsPlanAction[] = [...valid, { type: 'unknown.action' }];
    expect(hasUnsupportedActions(valid)).toBe(false);
    expect(hasUnsupportedActions(invalid)).toBe(true);
  });

  it('detects critical risk actions in a list', () => {
    const lowRisk: MarketingOpsPlanAction[] = [{
      type: 'approval.submit_editorial',
      campaign_id: '11111111-1111-1111-1111-111111111111',
      asset_id: '22222222-2222-2222-2222-222222222222',
      version_number: 1,
      reason: 'Standard review',
      risk_level: 'low'
    } as unknown as MarketingOpsPlanAction];
    expect(hasCriticalRisk(lowRisk)).toBe(false);

    const criticalRisk: MarketingOpsPlanAction[] = [{
      type: 'approval.submit_operational',
      campaign_id: '11111111-1111-1111-1111-111111111111',
      action_package: {},
      reason: 'Dangerous action',
      risk_level: 'critical'
    } as unknown as MarketingOpsPlanAction];
    expect(hasCriticalRisk(criticalRisk)).toBe(true);
  });
});
