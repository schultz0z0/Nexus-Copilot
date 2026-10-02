import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { leadKeys, reportMetricLabels, type LeadClient, type ResultReport, type ResultReportInput, type ReportMetrics } from '@/lib/marketingOps/leads';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { LeadError } from './LeadUi';
import { count, leadDialog, leadSelect, shortDate, useCampaignActions, useProposalKey, useDialogReturnFocus } from './leadUiHelpers';

export function CampaignReportsDialog({ campaignId, api, ops, readOnly, onClose, initialReport }: { campaignId: string; api: LeadClient; ops: MarketingOpsClient; readOnly: boolean; onClose: () => void; initialReport?: Partial<ResultReportInput> }) {
  const qc = useQueryClient(); const key = useProposalKey();
  const returnFocus = useDialogReturnFocus();
  const reports = useQuery({ queryKey: leadKeys.reports(campaignId), queryFn: () => api.reports(campaignId) });
  const sources = useQuery({ queryKey: leadKeys.sources(campaignId), queryFn: () => api.sources(campaignId) });
  const actions = useCampaignActions(campaignId, ops, !readOnly);
  const [target, setTarget] = useState<ResultReport | 'new' | null>(initialReport ? 'new' : null);
  const [form, setForm] = useState<ResultReportInput>({ sourceId: '', periodFrom: '', periodTo: '', timeZone: 'America/Sao_Paulo', metrics: {}, notes: '', actionId: null, ...initialReport });
  const [values, setValues] = useState<Partial<Record<keyof ReportMetrics, string>>>(() => Object.fromEntries(Object.entries(initialReport?.metrics ?? {}).map(([id, value]) => [id, String(value)])));
  const [proposal, setProposal] = useState<ResultReportInput | null>(null); const [historyId, setHistoryId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [receipt, setReceipt] = useState('');
  const [currentConflict, setCurrentConflict] = useState<ResultReport | null>(null);
  const history = useQuery({ queryKey: [...leadKeys.reports(campaignId), 'history', historyId], enabled: !!historyId, queryFn: () => api.reportRevisions(campaignId, historyId!) });
  const edit = (report?: ResultReport) => {
    if (report?.adsLinkId) return;
    setTarget(report ?? 'new'); setHistoryId(null); setProposal(null); setError(null); setReceipt(''); setCurrentConflict(null);
    setForm(report ? { sourceId: report.sourceId, actionId: report.actionId ?? null, periodFrom: report.periodFrom, periodTo: report.periodTo, timeZone: report.timeZone, metrics: report.metrics, notes: report.notes ?? '' } : { sourceId: '', actionId: null, periodFrom: '', periodTo: '', timeZone: 'America/Sao_Paulo', metrics: {}, notes: '' });
    setValues(report ? Object.fromEntries(Object.entries(report.metrics).map(([id, value]) => [id, String(value)])) : {});
  };
  const review = (event: React.FormEvent) => {
    event.preventDefault(); setError(null);
    try {
      if (!form.sourceId || !form.periodFrom || !form.periodTo || form.periodFrom > form.periodTo) throw new Error('Escolha uma fonte e um período válido.');
      new Intl.DateTimeFormat('pt-BR', { timeZone: form.timeZone }).format(new Date());
      const metrics: ReportMetrics = {};
      for (const [id, input] of Object.entries(values) as Array<[keyof ReportMetrics, string]>) {
        if (!input.trim()) continue;
        const numeric = Number(input);
        if (!Number.isFinite(numeric) || numeric < 0 || (!['spend', 'revenue'].includes(id) && !Number.isSafeInteger(numeric))) throw new Error(`Confira o valor de ${reportMetricLabels[id].toLowerCase()}.`);
        metrics[id] = numeric;
      }
      if (!Object.keys(metrics).length) throw new Error('Informe pelo menos uma métrica medida. Campos sem medição devem ficar em branco.');
      setProposal({ ...form, notes: form.notes?.trim() || null, metrics });
    } catch (issue) { setError(issue); }
  };
  const confirm = async () => {
    if (!proposal || busy || readOnly || !target) return; setBusy(true); setError(null);
    try {
      if (target === 'new') await api.createReport(campaignId, proposal, key({ proposal }));
      else await api.updateReport(campaignId, target.id, target.version, proposal, key({ id: target.id, version: target.version, proposal }));
      setReceipt(target === 'new' ? 'Relatório registrado' : 'Relatório revisado'); setTarget(null); setProposal(null);
      await qc.invalidateQueries({ queryKey: leadKeys.all });
    } catch (issue) { setError(issue); } finally { setBusy(false); }
  };
  const loadCurrent = async () => {
    if (!target || target === 'new' || busy) return; setBusy(true);
    try { const response = await reports.refetch(); if (response.error) throw response.error; const fresh = response.data?.data.find(report => report.id === target.id); if (!fresh) throw new Error('O relatório não está mais disponível. Suas alterações foram preservadas.'); setCurrentConflict(fresh); }
    catch (issue) { setError(issue); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent onCloseAutoFocus={returnFocus} className={leadDialog} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>Relatórios de resultados</DialogTitle><DialogDescription>Registre os números medidos por fonte e período. Relatórios agregados não criam pessoas nem completam o funil individual.</DialogDescription></DialogHeader>
    <LeadError error={error || reports.error || sources.error} />
    {(error as { code?: string })?.code === 'version_conflict' && !currentConflict && <div className="space-y-3"><p className="text-sm text-muted-foreground">Suas alterações continuam aqui. Compare a versão atual antes de revisar e confirmar novamente.</p><Button variant="outline" disabled={busy} className="min-h-11" onClick={() => { void loadCurrent(); }}>Carregar versão atual</Button></div>}
    {currentConflict && <section className="space-y-4 rounded-xl border border-border p-4" aria-label="Conflito de versão"><h3 className="text-base font-medium">Versão atual: {currentConflict.version}</h3><p className="text-xs text-muted-foreground">{shortDate(currentConflict.periodFrom)} a {shortDate(currentConflict.periodTo)} · {currentConflict.timeZone}</p><MetricValues metrics={currentConflict.metrics} /><Button variant="outline" className="min-h-11" onClick={() => { setTarget(currentConflict); setCurrentConflict(null); setProposal(null); setError(null); }}>Revisar minhas alterações</Button></section>}
    {receipt && <p role="status" aria-live="polite" className="text-sm text-status-success">{receipt}</p>}
    {proposal ? <section className="space-y-5" aria-label="Revisão dos valores"><h3 className="text-base font-medium">Confira antes de confirmar</h3><p className="text-sm text-text-secondary">{sources.data?.data.find(source => source.id === proposal.sourceId)?.name ?? 'Fonte selecionada'} · {shortDate(proposal.periodFrom)} a {shortDate(proposal.periodTo)} · {proposal.timeZone}</p><dl className="space-y-3 text-sm"><div><dt className="text-xs text-muted-foreground">Ação no calendário</dt><dd className="mt-1 break-words">{proposal.actionId ? actions.data?.find(action => action.id === proposal.actionId)?.title ?? `Ação vinculada: ${proposal.actionId}` : "Sem vínculo com ação"}</dd></div>{proposal.notes && <div><dt className="text-xs text-muted-foreground">Observações</dt><dd className="mt-1 whitespace-pre-wrap break-words">{proposal.notes}</dd></div>}</dl><MetricValues metrics={proposal.metrics} /><p className="text-xs text-muted-foreground">{target === 'new' ? 'Esta ação registra um relatório medido.' : 'Esta revisão substitui os valores do relatório. A versão anterior permanece no histórico.'} Campos em branco continuam sem medição.</p><div className="flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={busy} onClick={() => setProposal(null)}>Voltar à edição</Button><Button className="min-h-11" disabled={busy} aria-busy={busy} onClick={() => { void confirm(); }}>{busy ? 'Salvando…' : target === 'new' ? 'Confirmar relatório' : 'Confirmar revisão'}</Button></div></section> : target ? <form onSubmit={review} className="space-y-5"><h3 className="text-base font-medium">{target === 'new' ? 'Novo relatório' : `Revisar relatório · versão ${target.version}`}</h3><fieldset className="grid min-w-0 gap-4 sm:grid-cols-2" disabled={busy}>
      <div className="space-y-2"><Label htmlFor="report-source">Fonte do relatório</Label><select id="report-source" required className={leadSelect} value={form.sourceId} onChange={event => setForm(previous => ({ ...previous, sourceId: event.target.value }))}><option value="">Selecione a fonte</option>{sources.data?.data.map(source => <option key={source.id} value={source.id}>{source.name}{!source.enabled ? ' · desabilitada' : ''}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="report-action">Ação no calendário (opcional)</Label><select id="report-action" className={leadSelect} value={form.actionId ?? ''} onChange={event => setForm(previous => ({ ...previous, actionId: event.target.value || null }))}><option value="">Sem vínculo com ação</option>{form.actionId && !actions.data?.some(action => action.id === form.actionId) && <option value={form.actionId}>Ação vinculada ao relatório</option>}{actions.data?.map(action => <option key={action.id} value={action.id}>{action.title}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="report-from">Início do período</Label><Input id="report-from" type="date" required value={form.periodFrom} onChange={event => setForm(previous => ({ ...previous, periodFrom: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="report-to">Fim do período</Label><Input id="report-to" type="date" required value={form.periodTo} onChange={event => setForm(previous => ({ ...previous, periodTo: event.target.value }))} /></div>
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="report-timezone">Fuso do relatório</Label><Input id="report-timezone" required value={form.timeZone} onChange={event => setForm(previous => ({ ...previous, timeZone: event.target.value }))} /></div>
      {Object.entries(reportMetricLabels).map(([id, label]) => <div key={id} className="space-y-2"><Label htmlFor={`metric-${id}`}>{label}</Label><Input id={`metric-${id}`} type="number" min="0" step={['spend', 'revenue'].includes(id) ? '0.01' : '1'} inputMode={['spend', 'revenue'].includes(id) ? 'decimal' : 'numeric'} placeholder="Não medido" value={values[id as keyof ReportMetrics] ?? ''} onChange={event => setValues(previous => ({ ...previous, [id]: event.target.value }))} /></div>)}
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="report-notes">Observações (opcional)</Label><textarea id="report-notes" rows={3} className={`${leadSelect} h-auto py-3`} value={form.notes ?? ''} onChange={event => setForm(previous => ({ ...previous, notes: event.target.value }))} /></div>
    </fieldset><p className="text-xs text-muted-foreground">Zero informa uma medição sem resultado. Deixe em branco o que ainda não foi medido. Janelas sobrepostas da mesma fonte precisam ser reconciliadas pela revisão do relatório existente.</p><div className="flex flex-wrap justify-end gap-3"><Button variant="outline" type="button" onClick={() => setTarget(null)}>Cancelar edição</Button><Button type="submit" className="min-h-11">Revisar valores</Button></div></form> : historyId ? <section className="space-y-4"><div className="flex items-center justify-between gap-3"><h3 className="text-base font-medium">Histórico do relatório</h3><Button variant="ghost" className="min-h-11" onClick={() => setHistoryId(null)}>Voltar aos relatórios</Button></div><LeadError error={history.error} retry={() => { void history.refetch(); }} />{history.isLoading && <p role="status">Carregando versões…</p>}{history.data?.data.map(version => <article key={version.version} className="space-y-3 border-t border-border pt-4"><h4 className="text-sm font-medium">Versão {version.version} · {shortDate(version.createdAt)}</h4><p className="text-xs text-muted-foreground">{shortDate(version.snapshot.periodFrom)} a {shortDate(version.snapshot.periodTo)} · {version.snapshot.timeZone}</p><MetricValues metrics={version.snapshot.metrics} />{version.snapshot.notes && <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">{version.snapshot.notes}</p>}</article>)}</section> : <section className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-medium">Relatórios registrados</h3>{!readOnly && <Button className="min-h-11" onClick={() => edit()}>Registrar relatório</Button>}</div>{reports.isLoading && <p role="status">Carregando relatórios…</p>}{!reports.isLoading && !reports.isError && !reports.data?.data.length && <p className="text-sm text-muted-foreground">Nenhum relatório registrado. Preencha somente valores fornecidos por uma fonte real.</p>}<ul className="divide-y divide-border">{reports.data?.data.map(report => <li key={report.id} className="space-y-4 py-4"><div><h4 className="break-words text-sm font-medium">{sources.data?.data.find(source => source.id === report.sourceId)?.name ?? 'Fonte do relatório'}</h4><p className="mt-1 text-xs text-muted-foreground">{shortDate(report.periodFrom)} a {shortDate(report.periodTo)} · versão {report.version}</p></div><MetricValues metrics={report.metrics} /><div className="flex flex-wrap gap-2">{report.adsLinkId && <p className="self-center text-xs text-muted-foreground">Atualizado pelo provedor{report.adsActive === false ? " · Medição retirada dos totais" : ""}</p>}{!readOnly && !report.adsLinkId && <Button variant="outline" className="min-h-11" onClick={() => edit(report)}>Revisar relatório</Button>}<Button variant="ghost" className="min-h-11" onClick={() => { setHistoryId(report.id); setError(null); }}>Ver histórico</Button></div></li>)}</ul></section>}
  </DialogContent></Dialog>;
}
function MetricValues({ metrics }: { metrics: ReportMetrics }) { return <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">{Object.entries(metrics).map(([id, value]) => <div key={id}><dt className="text-xs text-muted-foreground">{reportMetricLabels[id as keyof ReportMetrics]}</dt><dd className="mt-1 text-sm tabular-nums">{['spend', 'revenue'].includes(id) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value!) : count(value)}</dd></div>)}</dl>; }
