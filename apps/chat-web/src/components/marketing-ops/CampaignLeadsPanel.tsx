import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileInput } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { leadChannels, leadKeys, type LeadClient, type LeadClassification, type CaptureReview } from '@/lib/marketingOps/leads';
import { LeadImportDialog } from './LeadImportDialog';
import { LeadError } from './LeadUi';
import { leadContainer, leadSelect, shortDate, useProposalKey } from './leadUiHelpers';

export function CampaignLeadsPanel({ campaignId, api, readOnly }: { campaignId: string; api: LeadClient; readOnly: boolean }) {
  const [classification, setClassification] = useState<LeadClassification | ''>(''); const [cursors, setCursors] = useState<string[]>([]); const [importOpen, setImportOpen] = useState(false);
  const query = useQuery({ queryKey: [...leadKeys.contacts(campaignId), classification, cursors.at(-1)], queryFn: () => api.contacts(campaignId, { limit: 25, ...(classification ? { classification } : {}), ...(cursors.length ? { cursor: cursors.at(-1) } : {}) }) });
  const reviews = useQuery({ queryKey: leadKeys.reviews(campaignId), queryFn: () => api.captureReviews(campaignId) });
  return <div className={leadContainer}>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-medium">Leads e contatos</h2><p className="mt-2 text-sm text-muted-foreground">Pessoas identificadas nesta campanha, com a origem preservada.</p></div>{!readOnly && <Button className="h-11" onClick={() => setImportOpen(true)}><FileInput />Importar contatos</Button>}</header>
    <div className="max-w-sm space-y-2"><Label htmlFor="contacts-kind">Classificação dos contatos</Label><select id="contacts-kind" className={leadSelect} value={classification} onChange={event => { setClassification(event.target.value as LeadClassification | ''); setCursors([]); }}><option value="">Todos</option><option value="lead">Leads identificados</option><option value="cold">Contatos frios</option></select></div>
    <LeadError error={query.error} retry={() => { void query.refetch(); }} />
    {query.isLoading && <p role="status">Carregando contatos…</p>}
    {!query.isLoading && !query.isError && !query.data?.data.length && <p className="rounded-xl border border-border p-6 text-sm text-muted-foreground">Nenhum contato neste recorte.</p>}
    <ul className="divide-y divide-border">{query.data?.data.map(contact => <li key={`${contact.id}-${contact.sourceId}`} className="py-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-base font-medium">{contact.name}</h3><p className="mt-2 break-all text-sm text-text-secondary">{[contact.email, contact.phone, contact.company].filter(Boolean).join(' · ')}</p></div><span className={`text-xs ${contact.classification === 'cold' ? 'text-muted-foreground' : 'text-brand-accent'}`}>{contact.classification === 'cold' ? 'Contato frio' : 'Lead identificado'}</span></div><dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 text-xs text-muted-foreground"><div><dt>Fonte nesta campanha</dt><dd className="mt-1 text-text-secondary">{contact.sourceName}</dd></div><div><dt>Primeira origem</dt><dd className="mt-1 text-text-secondary">{contact.origin ? leadChannels[contact.origin.channel] : 'Origem protegida por permissão'}</dd></div><div><dt>Primeiro registro na campanha</dt><dd className="mt-1 text-text-secondary">{shortDate(contact.firstOccurredAt)}</dd></div></dl></li>)}</ul>
    {(cursors.length > 0 || query.data?.page?.nextCursor) && <div className="flex justify-between gap-3"><Button variant="outline" className="min-h-11" disabled={!cursors.length || query.isFetching} onClick={() => setCursors(previous => previous.slice(0, -1))}>Anterior</Button><span className="self-center text-xs text-muted-foreground">Página {cursors.length + 1}</span><Button variant="outline" className="min-h-11" disabled={!query.data?.page?.nextCursor || query.isFetching} onClick={() => setCursors(previous => [...previous, query.data!.page!.nextCursor!])}>Próxima</Button></div>}
    <LeadError error={reviews.error} retry={() => { void reviews.refetch(); }} />
    {!!reviews.data?.data.length && <section className="space-y-4 border-t border-border pt-6" aria-label="Capturas para revisar"><h2 className="text-lg font-medium">Capturas para revisar</h2><p className="text-sm text-muted-foreground">Um formulário encontrou identidades semelhantes. Revise antes de unir ou criar contatos.</p>{reviews.data.data.map(review => <CaptureRow key={review.id} review={review} campaignId={campaignId} api={api} readOnly={readOnly} />)}</section>}
    <p className="text-xs leading-relaxed text-muted-foreground">Contatos frios ficam separados dos leads captados. Um clique no WhatsApp não cria uma pessoa. O acompanhamento comercial completo será feito no futuro CRM.</p>
    {importOpen && <LeadImportDialog campaignId={campaignId} api={api} onClose={() => setImportOpen(false)} />}
  </div>;
}
function CaptureRow({ review, campaignId, api, readOnly }: { review: CaptureReview; campaignId: string; api: LeadClient; readOnly: boolean }) {
  const qc = useQueryClient(); const key = useProposalKey(); const [choice, setChoice] = useState(''); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const resolve = async () => {
    if (readOnly || !choice || busy) return; setBusy(true); setError(null);
    const decision = choice.startsWith('link:') ? { action: 'link' as const, contactId: choice.slice(5) } : { action: choice as 'create' | 'skip' };
    try { await api.resolveCapture(campaignId, review.id, decision, key({ id: review.id, decision })); await qc.invalidateQueries({ queryKey: leadKeys.all }); }
    catch (issue) { setError(issue); } finally { setBusy(false); }
  };
  return <article className="space-y-3 rounded-xl border border-border p-4"><h3 className="break-words text-sm font-medium">{review.input.name}</h3><p className="break-all text-xs text-muted-foreground">{[review.input.email, review.input.phone, review.input.company].filter(Boolean).join(' · ')} · {shortDate(review.createdAt)}</p><LeadError error={error} />{!readOnly && <><Label htmlFor={`capture-${review.id}`}>Decisão para {review.input.name}</Label><select id={`capture-${review.id}`} className={leadSelect} disabled={busy} value={choice} onChange={event => setChoice(event.target.value)}><option value="">Escolha uma decisão</option>{review.candidates.map(candidate => <option key={candidate.id} value={`link:${candidate.id}`}>Vincular a {candidate.name} · {candidate.email ?? candidate.phone}</option>)}<option value="create">Criar novo contato</option><option value="skip">Ignorar captura</option></select><Button disabled={busy || !choice} aria-busy={busy} className="min-h-11" onClick={() => { void resolve(); }}>{busy ? 'Confirmando…' : 'Confirmar decisão'}</Button></>}</article>;
}
