import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { leadChannels, leadKeys, type LeadClient, type LeadSource, type LeadSourceInput } from '@/lib/marketingOps/leads';
import type { MarketingOpsClient } from '@/lib/marketingOps/client';
import { LeadError } from './LeadUi';
import { AdsLinksPanel } from './AdsLinksPanel';
import type { AdsClient } from '@/lib/marketingOps/ads';
import { leadContainer, leadDialog, leadSelect, useCampaignActions, useProposalKey, useDialogReturnFocus } from './leadUiHelpers';

const kinds = { landing_page: 'Formulário de landing page', whatsapp: 'Link para WhatsApp', manual: 'Importação manual' };
export function LeadSourcesPanel({ campaignId, api, ops, readOnly, adsApi, adsReadOnly = readOnly }: { campaignId: string; api: LeadClient; ops: MarketingOpsClient; readOnly: boolean; adsApi?: AdsClient; adsReadOnly?: boolean }) {
  const query = useQuery({ queryKey: leadKeys.sources(campaignId), queryFn: () => api.sources(campaignId) });
  const [target, setTarget] = useState<LeadSource | 'new' | null>(null);
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState<unknown>(null);
  const copy = async (source: LeadSource) => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/api/capture/${encodeURIComponent(source.publicId)}${source.kind === 'whatsapp' ? '/whatsapp' : ''}`); setCopied(source.id); setCopyError(null); }
    catch { setCopyError(new Error('Não foi possível copiar. Selecione o endereço da fonte abaixo e copie manualmente.')); }
  };
  return <div className={leadContainer}>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-medium">Fontes de captação</h2><p className="mt-2 max-w-xl text-sm text-muted-foreground">Defina de onde chegam os contatos e como cada conversão entra nesta campanha.</p></div>{!readOnly && <Button className="h-11" onClick={() => setTarget('new')}><Plus />Nova fonte</Button>}</header>
    <LeadError error={query.error} retry={() => { void query.refetch(); }} /><LeadError error={copyError} />
    {query.isLoading && <p role="status">Carregando fontes…</p>}
    {!query.isLoading && !query.isError && !query.data?.data.length && <p className="rounded-xl border border-border p-6 text-sm text-muted-foreground">Nenhuma fonte cadastrada. Crie uma para configurar formulários, links ou importações.</p>}
    <ul className="divide-y divide-border">{query.data?.data.map(source => <li key={source.id} className="min-w-0 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-base font-medium">{source.name}</h3><p className="mt-1 text-sm text-muted-foreground">{leadChannels[source.channel]} · {kinds[source.kind]} · {source.classification === 'cold' ? 'Contato frio' : 'Lead identificado'}</p>{!source.enabled && <p className="mt-2 text-xs text-status-warning">Fonte desabilitada</p>}</div>{!readOnly && <Button variant="outline" className="min-h-11" onClick={() => setTarget(source)}>Editar fonte</Button>}</div>
      {source.kind !== 'manual' && <div className="mt-4 flex min-w-0 flex-wrap items-center gap-3"><Link2 className="h-4 w-4 shrink-0 text-brand-accent" aria-hidden="true" /><code className="min-w-0 flex-1 break-all text-xs text-text-secondary">{window.location.origin}/api/capture/{source.publicId}{source.kind === 'whatsapp' ? '/whatsapp' : ''}</code><Button variant="ghost" className="min-h-11" onClick={() => { void copy(source); }}><Copy />{copied === source.id ? 'Copiado' : 'Copiar endereço'}</Button></div>}
      {source.kind === 'whatsapp' && <p className="mt-2 text-xs text-muted-foreground">O link registra o clique. A conversa vira lead apenas quando um contato é identificado e importado.</p>}
      {source.kind === 'landing_page' && <p className="mt-2 text-xs text-muted-foreground">Envie o formulário para este endereço. Domínios autorizados: {source.allowedOrigins.join(', ') || 'nenhum'}.</p>}
    </li>)}</ul>
    <p className="text-xs leading-relaxed text-muted-foreground">As fontes organizam a captação. O cadastro não conecta contas nem busca métricas automaticamente nas plataformas de anúncios.</p>
    {adsApi && <AdsLinksPanel campaignId={campaignId} api={adsApi} leads={api} readOnly={adsReadOnly} onNewSource={() => setTarget('new')} />}
    <div role="status" aria-live="polite" className="sr-only">{copied ? 'Endereço copiado' : ''}</div>
    {target && <SourceDialog campaignId={campaignId} api={api} ops={ops} source={target === 'new' ? undefined : target} onClose={() => setTarget(null)} />}
  </div>;
}
function SourceDialog({ campaignId, api, ops, source, onClose }: { campaignId: string; api: LeadClient; ops: MarketingOpsClient; source?: LeadSource; onClose: () => void }) {
  const qc = useQueryClient(); const key = useProposalKey();
  const returnFocus = useDialogReturnFocus();
  const [form, setForm] = useState<LeadSourceInput>(source ?? { name: '', channel: 'meta_ads', kind: 'manual', classification: 'lead', enabled: true, actionId: null });
  const [origins, setOrigins] = useState(source?.allowedOrigins.join('\n') ?? '');
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const actions = useCampaignActions(campaignId, ops, !source);
  const edit = <K extends keyof LeadSourceInput>(field: K, value: LeadSourceInput[K]) => setForm(previous => ({ ...previous, [field]: value }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    const allowedOrigins = origins.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
    try {
      for (const item of allowedOrigins) { const url = new URL(item); if (url.origin !== item || !['http:', 'https:'].includes(url.protocol)) throw new Error('Informe domínios completos sem caminho, por exemplo https://seusite.com.br.'); }
      if (form.kind === 'landing_page' && !allowedOrigins.length) throw new Error('Informe ao menos um domínio autorizado para o formulário.');
      if (form.kind === 'whatsapp' && !/^\d{10,15}$/.test(form.whatsappPhone ?? '')) throw new Error('Informe o telefone com DDI e DDD, somente números.');
      setBusy(true); setError(null);
      const body = source ? { name: form.name.trim(), allowedOrigins, whatsappPhone: form.whatsappPhone ?? null, enabled: form.enabled } : { ...form, name: form.name.trim(), allowedOrigins, externalAccountId: form.externalAccountId || null, externalCampaignId: form.externalCampaignId || null, whatsappPhone: form.whatsappPhone || null };
      if (source) await api.updateSource(campaignId, source.id, source.version, body, key(body)); else await api.createSource(campaignId, body as LeadSourceInput, key(body));
      await qc.invalidateQueries({ queryKey: leadKeys.all }); onClose();
    } catch (issue) { setError(issue); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent onCloseAutoFocus={returnFocus} className={leadDialog} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{source ? 'Editar fonte de captação' : 'Nova fonte de captação'}</DialogTitle><DialogDescription>{source ? 'Canal, caminho e classificação preservam a origem dos contatos.' : 'Esta configuração vincula contatos à campanha. Conexões com anúncios são configuradas separadamente.'}</DialogDescription></DialogHeader>
    <form onSubmit={save} className="space-y-5"><fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="source-name">Nome da fonte</Label><Input id="source-name" required maxLength={160} value={form.name} onChange={event => edit('name', event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="source-channel">Canal da fonte</Label><select id="source-channel" className={leadSelect} disabled={!!source} value={form.channel} onChange={event => { const channel = event.target.value as LeadSourceInput['channel']; setForm(previous => ({ ...previous, channel, classification: channel === 'google_maps' ? 'cold' : 'lead' })); }}>{Object.entries(leadChannels).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="source-kind">Caminho da conversão</Label><select id="source-kind" className={leadSelect} disabled={!!source} value={form.kind} onChange={event => edit('kind', event.target.value as LeadSourceInput['kind'])}>{Object.entries(kinds).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="source-classification">Classificação inicial</Label><select id="source-classification" className={leadSelect} disabled={!!source} value={form.classification} onChange={event => edit('classification', event.target.value as 'cold' | 'lead')}><option value="lead">Lead identificado</option><option value="cold">Contato frio</option></select></div>
      {!source && <div className="space-y-2"><Label htmlFor="source-action">Ação no calendário (opcional)</Label><select id="source-action" className={leadSelect} value={form.actionId ?? ''} onChange={event => edit('actionId', event.target.value || null)}><option value="">Sem vínculo com ação</option>{actions.data?.map(action => <option key={action.id} value={action.id}>{action.title}</option>)}</select>{actions.isError && <p className="text-xs text-status-warning">Calendário indisponível. Você pode criar a fonte sem uma ação.</p>}</div>}
      {form.kind === 'landing_page' && <div className="space-y-2 sm:col-span-2"><Label htmlFor="source-origins">Domínios autorizados</Label><textarea id="source-origins" required rows={3} className={`${leadSelect} h-auto py-3`} value={origins} onChange={event => setOrigins(event.target.value)} placeholder="https://seusite.com.br" /><p className="text-xs text-muted-foreground">Um domínio completo por linha, com https:// e sem caminhos.</p></div>}
      {form.kind === 'whatsapp' && <div className="space-y-2 sm:col-span-2"><Label htmlFor="source-phone">WhatsApp com DDI e DDD</Label><Input id="source-phone" required inputMode="tel" placeholder="5511999999999" value={form.whatsappPhone ?? ''} onChange={event => edit('whatsappPhone', event.target.value)} /></div>}
      {source && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={form.enabled} onChange={event => edit('enabled', event.target.checked)} />Fonte habilitada</label>}
    </fieldset>
    {!source && <details><summary className="flex min-h-11 cursor-pointer items-center text-sm text-brand-accent">Detalhes avançados (opcionais)</summary><div className="grid gap-4 py-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="source-external-account">Identificador da conta de anúncios</Label><Input id="source-external-account" disabled={busy} value={form.externalAccountId ?? ''} onChange={event => edit('externalAccountId', event.target.value)} /></div><div className="space-y-2"><Label htmlFor="source-external-campaign">Identificador da campanha na plataforma</Label><Input id="source-external-campaign" disabled={busy} value={form.externalCampaignId ?? ''} onChange={event => edit('externalCampaignId', event.target.value)} /></div></div><p className="text-xs text-muted-foreground">Use apenas para relacionar arquivos exportados. Esses valores não autorizam acesso à plataforma.</p></details>}
    <LeadError error={error} /><div className="flex flex-wrap justify-end gap-3"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy}>{busy ? 'Salvando…' : 'Salvar fonte'}</Button></div></form>
  </DialogContent></Dialog>;
}
