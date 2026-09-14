import React, { useState, useRef } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Hash,
  Loader2,
  Play,
  ShieldAlert,
  XCircle
} from 'lucide-react';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import type {
  MarketingOpsPlanExecutionResult,
  MarketingOpsPreparedPlanSummary,
  MarketingOpsPreparedPlanStatus
} from '@/lib/marketingOps/types';
import {
  formatShortHash,
  formatShortId,
  hasCriticalRisk,
  hasUnsupportedActions,
  planStatusPresentation,
  presentPlanAction
} from './agentPlanPresentation';

export interface AgentPlanCardProps {
  plan: MarketingOpsPreparedPlanSummary;
  client?: MarketingOpsClient;
  canWrite?: boolean;
  canApprove?: boolean;
  onExecuted?: (result: MarketingOpsPlanExecutionResult) => void;
  className?: string;
}

export function AgentPlanCard({
  plan,
  client,
  canWrite = false,
  canApprove = false,
  onExecuted,
  className = ''
}: AgentPlanCardProps) {
  const [localStatus, setLocalStatus] = useState<MarketingOpsPreparedPlanStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<MarketingOpsPlanExecutionResult | null>(null);
  const [showCriticalConfirm, setShowCriticalConfirm] = useState(false);

  const idempotencyKeyRef = useRef<string | null>(null);

  const currentStatus = localStatus ?? plan.status;
  const statusInfo = planStatusPresentation(currentStatus);
  const isUnsupported = hasUnsupportedActions(plan.actions);
  const isCritical = hasCriticalRisk(plan.actions);
  const hasApprovalAction = plan.actions.some((a) => a.type.startsWith('approval.'));
  const isExpired = new Date(plan.expiresAt).getTime() <= Date.now() || currentStatus === 'expired';
  const isTerminal = ['completed', 'partial', 'failed', 'expired', 'invalidated'].includes(currentStatus);

  const isExecutable =
    !isTerminal &&
    !isExpired &&
    !isUnsupported &&
    canWrite &&
    (!hasApprovalAction || canApprove) &&
    !isBusy;

  const executePlan = async () => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    const executionKey = idempotencyKeyRef.current;

    setIsBusy(true);
    setErrorMessage(null);
    setShowCriticalConfirm(false);

    try {
      if (!client) {
        throw new Error('Cliente de Marketing Ops não configurado');
      }

      const response = await client.executeAgentPlan(plan.id, plan.planHash, executionKey);
      setExecutionResult(response.data);
      setLocalStatus(response.data.status);
      onExecuted?.(response.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha na execução do plano';
      setErrorMessage(message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleExecuteClick = () => {
    if (!isExecutable) return;

    if (isCritical && !showCriticalConfirm) {
      setShowCriticalConfirm(true);
      return;
    }

    executePlan();
  };

  const toneBadgeClasses = {
    warning: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800',
    info: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800',
    success: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800',
    destructive: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800',
    muted: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
  }[statusInfo.tone];

  return (
    <article
      className={`rounded-xl border border-border bg-card/90 shadow-sm p-4 text-card-foreground backdrop-blur-sm transition-all ${className}`}
      aria-labelledby={`plan-title-${plan.id}`}
      aria-busy={isBusy}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1.5 text-primary">
            <Hash className="h-4 w-4" />
          </div>
          <div>
            <h3 id={`plan-title-${plan.id}`} className="text-sm font-semibold leading-tight">
              Plano de Marketing Ops
            </h3>
            <div className="flex items-center gap-2 mt-0.5 font-mono text-[11px] text-muted-foreground">
              <span>ID: {formatShortId(plan.id)}</span>
              <span>•</span>
              <span title={plan.planHash}>Hash: {formatShortHash(plan.planHash)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${toneBadgeClasses}`}>
            {statusInfo.label}
          </span>
        </div>
      </div>

      {/* Metadata and Expiry */}
      <div className="flex flex-wrap items-center gap-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          <span>Expira em: {new Date(plan.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
        </div>
        <div>
          <span>{plan.actions.length} {plan.actions.length === 1 ? 'ação' : 'ações'}</span>
        </div>
      </div>

      {/* Action list */}
      <div className="mt-2 space-y-2">
        <ol className="divide-y divide-border/50 rounded-lg border border-border/50 bg-muted/30">
          {plan.actions.map((action, index) => {
            const presented = presentPlanAction(action);
            return (
              <li key={index} className="p-2.5 text-xs">
                <div className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    {index + 1}
                  </span>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-semibold ${presented.supported ? 'text-foreground' : 'text-destructive'}`}>
                        {presented.title}
                      </span>
                      {!presented.supported && (
                        <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          <AlertCircle className="h-3 w-3" />
                          Ação não suportada
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground">{presented.description}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Critical Risk Confirmation */}
      {showCriticalConfirm && (
        <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50/90 p-3 text-xs text-rose-950 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <strong className="font-semibold">Risco Crítico Detectado</strong>
              <p>Este plano contém ações classificadas com nível de risco crítico. Deseja realmente confirmar a execução?</p>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={executePlan}
                  className="rounded bg-rose-600 px-2.5 py-1 font-medium text-white hover:bg-rose-700 transition"
                >
                  Confirmar execução
                </button>
                <button
                  type="button"
                  onClick={() => setShowCriticalConfirm(false)}
                  className="rounded border border-rose-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 dark:border-rose-700 dark:bg-slate-900 dark:text-slate-200 transition"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
          <XCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Success / Result Announcement */}
      {executionResult && (
        <div className="mt-3 space-y-1.5 rounded-lg border border-emerald-300 bg-emerald-50/90 p-3 text-xs text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <strong className="font-semibold">
              Plano executado com sucesso: {executionResult.status}
            </strong>
          </div>
          {hasApprovalAction && (
            <p className="text-emerald-800 dark:text-emerald-300">
              Solicitação de aprovação criada — pendente
            </p>
          )}
          {executionResult.deep_links.length > 0 && (
            <div className="pt-1 flex flex-wrap gap-2">
              {executionResult.deep_links.map((link, idx) => (
                <a
                  key={idx}
                  href={link}
                  className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900 hover:underline dark:bg-emerald-900 dark:text-emerald-100"
                >
                  Ver recurso criado
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* aria-live status container */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isBusy ? 'Executando plano...' : ''}
        {executionResult ? `Plano executado com sucesso: ${executionResult.status}` : ''}
        {errorMessage ? `Falha na execução: ${errorMessage}` : ''}
      </div>

      {/* Execution Action Footer */}
      {!isTerminal && (
        <div className="mt-4 flex items-center justify-end border-t border-border/50 pt-3">
          <button
            type="button"
            onClick={handleExecuteClick}
            disabled={!isExecutable}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              isExecutable
                ? 'bg-primary text-primary-foreground shadow hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
            }`}
          >
            {isBusy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Executando...</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Executar plano</span>
              </>
            )}
          </button>
        </div>
      )}
    </article>
  );
}
