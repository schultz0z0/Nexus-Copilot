import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { mapLeadRows, readLeadFile, type LeadMapping, type LeadTable } from '@/lib/marketingOps/leadFiles';
import { leadKeys, type LeadClient, type ImportDecision, type ImportPreview, type ImportReceipt } from '@/lib/marketingOps/leads';
import { LeadError } from './LeadUi';
import { leadDialog, leadSelect, useProposalKey, useDialogReturnFocus } from './leadUiHelpers';

const mappingLabels = { name: 'Nome', email: 'E-mail', phone: 'Telefone', company: 'Empresa', externalId: 'Identificador externo', occurredAt: 'Data de captação' };
const aliases: Record<keyof LeadMapping, string[]> = { name: ['nome', 'name', 'fullname', 'nomecompleto'], email: ['email', 'emailaddress'], phone: ['telefone', 'phone', 'whatsapp', 'celular', 'phonenumber'], company: ['empresa', 'company', 'companyname'], externalId: ['id', 'externalid', 'leadid', 'iddolead', 'identificadorexterno'], occurredAt: ['data', 'datadecaptacao', 'createdtime', 'createdat', 'occurredat', 'datacaptacao'] };
const statuses = { new: 'Novo contato', duplicate: 'Já registrado', possible_duplicate: 'Possível duplicado', invalid: 'Linha inválida' };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function LeadImportDialog({ campaignId, api, onClose, existingPreviewId, initialTable }: { campaignId: string; api: LeadClient; onClose: () => void; existingPreviewId?: string; initialTable?: LeadTable }) {
  const qc = useQueryClient(); const previewKey = useProposalKey(); const confirmKey = useProposalKey();
  const returnFocus = useDialogReturnFocus();
  const sources = useQuery({ queryKey: leadKeys.sources(campaignId), queryFn: () => api.sources(campaignId), enabled: !existingPreviewId });
  const existing = useQuery({ queryKey: ['marketing-leads', 'import-preview', campaignId, existingPreviewId], queryFn: () => api.importPreview(campaignId, existingPreviewId!), enabled: !!existingPreviewId, retry: false });
  const [nativeInvalid, setNativeInvalid] = useState(false);
  const [sourceId, setSourceId] = useState(''); const [table, setTable] = useState<LeadTable | null>(initialTable ?? null);
  const [mapping, setMapping] = useState<LeadMapping>(() => { const next: LeadMapping = {}; if (initialTable) for (const key of Object.keys(mappingLabels) as Array<keyof LeadMapping>) { const index = initialTable.headers.findIndex(header => aliases[key].includes(normalize(header))); if (index >= 0) next[key] = index; } return next; }); const [fallbackDate, setFallbackDate] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null); const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!existingPreviewId || !existing.data || nativeInvalid) return;
    if (existing.data.data.receipt) { setReceipt(existing.data.data.receipt); setPreview(null); setDecisions({}); return; }
    setPreview(existing.data.data);
    setDecisions(Object.fromEntries(existing.data.data.rows.filter(row => row.status === 'new').map(row => [row.rowIndex, 'create'])));
  }, [existingPreviewId, existing.data, nativeInvalid]);
  const load = async (file?: File) => {
    if (!file) return; setBusy(true); setPreview(null); setError(null); setTable(null);
    try { const parsed = await readLeadFile(file); const next: LeadMapping = {}; for (const key of Object.keys(mappingLabels) as Array<keyof LeadMapping>) { const index = parsed.headers.findIndex(header => aliases[key].includes(normalize(header))); if (index >= 0) next[key] = index; } setTable(parsed); setMapping(next); }
    catch (issue) { setError(issue); } finally { setBusy(false); }
  };
  const generate = async () => {
    if (!table || !sourceId || busy) return;
    if (mapping.name === undefined || (mapping.email === undefined && mapping.phone === undefined)) { setError(new Error('Relacione Nome e pelo menos E-mail ou Telefone antes de continuar.')); return; }
    if (mapping.occurredAt === undefined && !fallbackDate) { setError(new Error('Informe a data de captação quando ela não estiver no arquivo. Use a mesma data ao importar novamente.')); return; }
    setBusy(true); setError(null);
    try { const rows = mapLeadRows(table, mapping, fallbackDate); const response = await api.previewImport(campaignId, sourceId, rows, previewKey({ sourceId, rows })); setPreview(response.data); setDecisions(Object.fromEntries(response.data.rows.filter(row => row.status === 'new').map(row => [row.rowIndex, 'create']))); }
    catch (issue) { setError(issue); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || busy || receipt) return;
    const selected: ImportDecision[] = preview.rows.filter(row => row.status === 'new' || row.status === 'possible_duplicate').map(row => {
      const decision = decisions[row.rowIndex]; return decision?.startsWith('link:') ? { rowIndex: row.rowIndex, action: 'link', contactId: decision.slice(5) } : { rowIndex: row.rowIndex, action: decision as 'create' | 'skip' };
    });
    if (selected.some(row => !row.action)) return;
    setBusy(true); setError(null);
    try { const response = await api.confirmImport(campaignId, preview.id, selected, confirmKey({ previewId: preview.id, decisions: selected })); setReceipt(response.data); await qc.invalidateQueries({ queryKey: leadKeys.all }); }
    catch (issue) { setError(issue); const code = (issue as { code?: string }).code ?? ''; if (['review_conflict', 'preview_expired'].includes(code) || (existingPreviewId && code === 'version_conflict')) { previewKey.reset(); setPreview(null); if (existingPreviewId) setNativeInvalid(true); } } finally { setBusy(false); }
  };
  const unresolved = preview?.rows.some(row => (row.status === 'new' || row.status === 'possible_duplicate') && !decisions[row.rowIndex]);
  const issue = error || existing.error || sources.error;
  const issueCode = (issue as { code?: string })?.code;
  const expired = !!preview && Date.parse(preview.expiresAt) <= Date.now();
  const nativeRecovery = !!existingPreviewId && !receipt && (nativeInvalid || expired || ['preview_expired', 'review_conflict', 'version_conflict', 'not_found', 'forbidden'].includes(issueCode ?? ''));
  const readableIssue = existingPreviewId && issue ? { ...(issue as object), message: ['not_found', 'forbidden'].includes(issueCode ?? '') ? 'Esta prévia não está disponível para sua conta. Peça ao responsável pela sincronização para revisar ou sincronize novamente com sua conta.' : ['preview_expired', 'review_conflict', 'version_conflict'].includes(issueCode ?? '') ? 'Esta prévia não pode mais ser confirmada. Ela expirou ou os contatos e a fonte mudaram após a revisão.' : (issue as { message?: string }).message } : issue;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent onCloseAutoFocus={returnFocus} className={leadDialog} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>Importar contatos</DialogTitle><DialogDescription>{receipt ? 'Este lote já foi confirmado. Confira o recibo da importação registrada nesta campanha.' : existingPreviewId ? 'Revise os contatos do formulário do provedor e confirme o que será gravado nesta campanha.' : 'Relacione as colunas, revise a prévia e confirme o que será gravado nesta campanha.'}</DialogDescription></DialogHeader>
    <LeadError error={readableIssue} retry={existingPreviewId && !nativeRecovery ? () => { void existing.refetch(); } : undefined} />
    {existingPreviewId && existing.isLoading && <p role="status">Carregando prévia para revisão…</p>}
    {nativeRecovery && <p className="text-sm text-status-warning">Sincronize novamente os anúncios pelo vínculo para obter uma prévia atual. Nenhum contato desta prévia será importado automaticamente.</p>}
    {receipt ? <section role="status" aria-live="polite" className="space-y-4"><h3 className="text-lg font-medium text-status-success">Importação concluída</h3><p className="text-sm">{receipt.created} criados · {receipt.linked} vinculados · {receipt.duplicate} já registrados · {receipt.skipped} ignorados · {receipt.invalid} inválidos</p><Button className="min-h-11" onClick={onClose}>Concluir</Button></section> : <>
      {!preview ? existingPreviewId ? <Button variant="outline" className="min-h-11 self-end" onClick={onClose}>Voltar aos resultados</Button> : <div className="space-y-5"><div className="space-y-2"><Label htmlFor="import-source">Fonte da importação</Label><select id="import-source" disabled={busy || sources.isLoading} className={leadSelect} value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">Selecione a fonte</option>{sources.data?.data.filter(source => source.enabled).map(source => <option key={source.id} value={source.id}>{source.name}{source.classification === 'cold' ? ' · contatos frios' : ''}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="import-file">Arquivo de contatos</Label><Input id="import-file" type="file" accept=".csv,.tsv,.xlsx" disabled={busy} onChange={event => { void load(event.target.files?.[0]); }} /><p className="text-xs text-muted-foreground">CSV, TSV ou Excel (.xlsx), até 500 contatos e 4 MB. A primeira linha deve conter cabeçalhos.</p></div>
      {table && <><p className="text-sm">{table.rows.length} linhas encontradas. Confira as colunas:</p><fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">{Object.entries(mappingLabels).map(([field, label]) => <div key={field} className="space-y-2"><Label htmlFor={`mapping-${field}`}>{label} no arquivo</Label><select id={`mapping-${field}`} className={leadSelect} value={mapping[field as keyof LeadMapping] ?? ''} onChange={event => setMapping(previous => ({ ...previous, [field]: event.target.value === '' ? undefined : Number(event.target.value) }))}><option value="">Não está no arquivo</option>{table.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></div>)}</fieldset><div className="space-y-2"><Label htmlFor="import-fallback">Data de captação quando ausente</Label><Input id="import-fallback" type="date" value={fallbackDate} disabled={busy} onChange={event => setFallbackDate(event.target.value)} /><p className="text-xs text-muted-foreground">Data real de origem dos contatos, no fuso de Brasília. Ao reimportar, preserve essa data para revisar os mesmos registros.</p></div></>}
      <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button className="min-h-11" disabled={busy || !table || !sourceId} aria-busy={busy} onClick={() => { void generate(); }}>{busy ? 'Preparando…' : 'Gerar prévia'}</Button></div></div> : <section className="space-y-5" aria-label="Prévia da importação">
        <p className="text-sm">{preview.summary.new} novos · {preview.summary.possible_duplicate} para revisar · {preview.summary.duplicate} já registrados · {preview.summary.invalid} inválidos</p>
        <p className="text-xs text-muted-foreground">Nada foi importado ainda. Contatos com identidade semelhante exigem uma decisão; linhas inválidas e já registradas não serão recriadas.</p>
        <ol className="max-h-[45dvh] space-y-4 overflow-y-auto pr-2">{preview.rows.map(row => <li key={row.rowIndex} className="space-y-3 border-t border-border pt-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="break-words text-sm font-medium">Linha {row.rowIndex + 1} · {row.input?.name || 'Sem nome válido'}</h3><span className={`text-xs ${row.status === 'possible_duplicate' ? 'text-status-warning' : row.status === 'invalid' ? 'text-status-error' : 'text-muted-foreground'}`}>{statuses[row.status]}</span></div>{row.input && <p className="break-all text-xs text-muted-foreground">{[row.input.email, row.input.phone, row.input.company].filter(Boolean).join(' · ')}</p>}{row.status === 'invalid' && <p className="text-xs text-status-error">Confira nome, e-mail ou telefone com DDI e a data de captação. Esta linha não será importada.</p>}{row.issues.length > 0 && <details className="text-xs"><summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">Detalhes da validação</summary>{row.issues.map((issue, index) => <p key={index} className="break-words py-1 text-status-error">{issue}</p>)}</details>}{(row.status === 'new' || row.status === 'possible_duplicate') && <div className="space-y-2"><Label htmlFor={`decision-${row.rowIndex}`}>Decisão para linha {row.rowIndex + 1}</Label><select id={`decision-${row.rowIndex}`} disabled={busy} className={leadSelect} value={decisions[row.rowIndex] ?? ''} onChange={event => setDecisions(previous => ({ ...previous, [row.rowIndex]: event.target.value }))}><option value="">Escolha uma decisão</option>{row.candidates.map(candidate => <option key={candidate.id} value={`link:${candidate.id}`}>Vincular a {candidate.name} · {candidate.email ?? candidate.phone ?? candidate.company}</option>)}<option value="create">Criar novo contato</option><option value="skip">Ignorar esta linha</option></select></div>}</li>)}</ol>
        <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className={existingPreviewId ? "min-h-11" : undefined} disabled={busy} onClick={() => { if (existingPreviewId) { onClose(); return; } if (expired) previewKey.reset(); setPreview(null); }}>{existingPreviewId ? 'Voltar aos resultados' : 'Voltar ao mapeamento'}</Button><Button className="min-h-11" disabled={busy || unresolved || expired || nativeRecovery} aria-busy={busy} onClick={() => { void confirm(); }}>{busy ? 'Importando…' : 'Confirmar importação'}</Button></div>
      </section>}
    </>}
  </DialogContent></Dialog>;
}
