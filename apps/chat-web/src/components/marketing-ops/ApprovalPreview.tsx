import type { MarketingOpsApprovalRequest } from '@/lib/marketingOps/types';

export function ApprovalPreview({ approval }: { approval: MarketingOpsApprovalRequest }) {
  if (approval.kind === 'editorial') {
    const target = approval.editorialTarget;
    return (
      <section aria-labelledby="approval-preview" className="rounded-lg border bg-white/70 p-4">
        <h2 id="approval-preview" className="font-semibold">Versão editorial {approval.contentVersionNumber}</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-text-secondary">Título</dt><dd>{target?.title ?? '—'}</dd></div>
          <div><dt className="text-text-secondary">Tipo</dt><dd>{target?.assetKind ?? '—'}</dd></div>
          <div><dt className="text-text-secondary">Asset</dt><dd className="break-all">{approval.contentAssetId}</dd></div>
          <div><dt className="text-text-secondary">Congelada em</dt><dd>{target?.frozenAt ? new Date(target.frozenAt).toLocaleString('pt-BR') : '—'}</dd></div>
        </dl>
        <h3 className="mt-4 text-sm font-semibold">Conteúdo congelado</h3>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded border bg-slate-50 p-3 text-sm">{target?.body ?? 'Sem conteúdo textual'}</pre>
        <h3 className="mt-4 text-sm font-semibold">Metadados</h3>
        <pre className="mt-2 max-h-64 overflow-auto rounded border bg-slate-50 p-3 text-xs">{JSON.stringify(target?.metadata ?? {}, null, 2)}</pre>
        <p className="mt-2 break-all font-mono text-xs">{approval.targetHash}</p>
      </section>
    );
  }
  const action = approval.actionPackage;
  return (
    <section aria-labelledby="approval-preview" className="rounded-lg border bg-white/70 p-4">
      <h2 id="approval-preview" className="font-semibold">Pacote operacional imutável</h2>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-text-secondary">Ação</dt><dd>{action?.actionType ?? '—'}</dd></div>
        <div><dt className="text-text-secondary">Canal</dt><dd>{action?.channel ?? '—'}</dd></div>
        <div><dt className="text-text-secondary">Agendamento</dt><dd>{action?.scheduledFor ?? 'Sem agendamento'}</dd></div>
        <div><dt className="text-text-secondary">Fuso</dt><dd>{action?.timeZone ?? '—'}</dd></div>
        <div><dt className="text-text-secondary">Critério de sucesso</dt><dd>{action?.successCriteria ?? '—'}</dd></div>
        <div><dt className="text-text-secondary">Resumo de risco</dt><dd>{action?.riskSummary ?? '—'}</dd></div>
      </dl>
      <h3 className="mt-4 text-sm font-semibold">Audiência congelada</h3>
      <pre className="mt-2 max-h-64 overflow-auto rounded border bg-slate-50 p-3 text-xs">{JSON.stringify(action?.audienceSnapshot ?? {}, null, 2)}</pre>
      <h3 className="mt-4 text-sm font-semibold">Configuração</h3>
      <pre className="mt-2 max-h-64 overflow-auto rounded border bg-slate-50 p-3 text-xs">{JSON.stringify(action?.configuration ?? {}, null, 2)}</pre>
      <h3 className="mt-4 text-sm font-semibold">Payload imutável</h3>
      <pre className="mt-2 max-h-96 overflow-auto rounded border bg-slate-50 p-3 text-xs">{JSON.stringify(action?.payload ?? {}, null, 2)}</pre>
      {action?.invalidationReason ? <p className="mt-3 text-sm text-destructive">Invalidado: {action.invalidationReason}</p> : null}
      <p className="mt-3 break-all font-mono text-xs">{approval.targetHash}</p>
    </section>
  );
}
