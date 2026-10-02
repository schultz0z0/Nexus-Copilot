import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, Globe, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { analyticsClient, analyticsKeys, analyticsProviders, analyticsMessages, analyticsCallbackMessage, safeGoogleAnalyticsUrl, type AnalyticsClient, type AnalyticsConnection, type AnalyticsProvider } from '@/lib/marketingOps/analytics';
import { LeadError } from './LeadUi';
import { leadDialog, shortDate, useDialogReturnFocus, useProposalKey } from './leadUiHelpers';

const statuses = { unprepared: 'Aguardando configuração', prepared: 'Pronto para conectar', pending_resource: 'Escolha uma propriedade', connected: 'Conectado', partial: 'Leitura parcial', reconnect_required: 'Renovar autorização', disconnected: 'Desconectado', error: 'Leitura indisponível' };
export function WebAnalyticsIntegrations({ api = analyticsClient, canManage, canConfigure, redirect = (url: string) => window.location.assign(url) }: { api?: AnalyticsClient; canManage: boolean; canConfigure: boolean; redirect?: (url: string) => void }) {
  const qc = useQueryClient(); const [params, setParams] = useSearchParams();
  const query = useQuery({ queryKey: analyticsKeys.connections, queryFn: api.connections });
  const [outcome, setOutcome] = useState(() => analyticsCallbackMessage(params.get('provider'), params.get('result')) ?? '');
  const [dialog, setDialog] = useState<'property' | 'clarity' | 'disconnect' | 'authorize' | null>(null);
  const [provider, setProvider] = useState<AnalyticsProvider>('ga4'); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState<unknown>(null); const refresh = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (params.get('provider') !== 'ga4') return;
    setOutcome(analyticsCallbackMessage('ga4', params.get('result')) ?? '');
    const clean = new URLSearchParams(params); clean.delete('provider'); clean.delete('result'); setParams(clean, { replace: true });
    void qc.invalidateQueries({ queryKey: analyticsKeys.all });
  }, [params, setParams, qc]);
  const authorize = async () => {
    if (!canManage || lock.current) return; lock.current = true; setBusy(true); setError(null); setOutcome('');
    try { const result = await api.authorize(); redirect(safeGoogleAnalyticsUrl(result.data.authorizationUrl)); }
    catch (issue) { setError(issue); } finally { lock.current = false; setBusy(false); }
  };
  const selected = query.data?.data.find(row => row.provider === provider);
  const done = async (message: string) => { setDialog(null); setOutcome(message); await qc.invalidateQueries({ queryKey: analyticsKeys.all }); };
  return <section aria-label="Conexões de análise do site" className="space-y-5" aria-busy={query.isLoading || busy}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Análise do site</h2><p className="mt-2 max-w-xl text-sm text-muted-foreground">Entenda como as pessoas chegam ao seu site e onde a experiência pode melhorar.</p></div><Button ref={refresh} variant="outline" className="min-h-11" disabled={query.isFetching || busy} onClick={() => { void query.refetch(); }}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Atualizar análise</Button></div>
    <p role="status" aria-live="polite" className={outcome ? 'rounded-xl border border-border bg-card p-4 text-sm' : 'sr-only'}>{outcome}</p>
    <LeadError error={error || query.error} retry={() => { setError(null); void query.refetch(); }} />
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {(Object.keys(analyticsProviders) as AnalyticsProvider[]).map(key => {
        const row = query.data?.data.find(connection => connection.provider === key);
        const resource = row?.resources.find(item => item.id === row.selectedResourceId);
        const authorized = row && ['pending_resource', 'connected', 'partial', 'reconnect_required', 'error'].includes(row.status);
        const open = (next: typeof dialog) => { setProvider(key); setError(null); setDialog(next); };
        return <article className="space-y-4 p-5 sm:p-6" key={key}>
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-3 text-lg font-medium"><Globe aria-hidden="true" className="h-5 w-5 text-brand-accent" />{analyticsProviders[key]}</h3><span className={`inline-flex items-center gap-2 text-sm ${row?.status === 'connected' ? 'text-status-success' : ['partial', 'error', 'reconnect_required'].includes(row?.status ?? '') ? 'text-status-warning' : 'text-text-secondary'}`}>{row?.status === 'connected' ? <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> : <CircleDashed aria-hidden="true" className="h-4 w-4" />}{row ? statuses[row.status] : query.isLoading ? 'Carregando…' : 'Estado indisponível'}</span></div>
          <p className="text-sm leading-relaxed text-muted-foreground">{resource ? `${resource.name} · ${resource.timeZone}` : key === 'ga4' ? row?.status === 'unprepared' ? 'Um administrador prepara o aplicativo Google uma vez, na área avançada abaixo. Depois, basta autorizar e escolher sua propriedade.' : 'Autorize sua conta Google e escolha a propriedade GA4. Não é necessário ter uma conta de anúncios.' : 'Use o token de exportação do seu projeto para consultar sessões e sinais de experiência.'}</p>
          {row?.safeError && <p className="text-sm text-status-warning">{analyticsMessages[row.safeError] ?? 'A última leitura não foi concluída. Confira sua conexão e tente novamente.'}</p>}
          {row?.lastSyncAt && <p className="text-xs text-muted-foreground">Última leitura: {shortDate(row.lastSyncAt)}</p>}
          {row && <div className="flex flex-wrap gap-3">
            {key === 'ga4' && canManage && row.status !== 'unprepared' && <>
              {['prepared', 'disconnected'].includes(row.status) && <Button className="min-h-11" disabled={busy} onClick={() => { void authorize(); }}>{busy ? 'Abrindo Google…' : 'Conectar Google Analytics'}</Button>}
              {['error', 'partial', 'reconnect_required'].includes(row.status) && <Button className="min-h-11" disabled={busy} onClick={() => open('authorize')}>Renovar Google Analytics</Button>}
              {authorized && <Button variant={row.status === 'pending_resource' ? 'default' : 'outline'} className="min-h-11" disabled={busy} onClick={() => open('property')}>{resource ? 'Trocar propriedade' : 'Escolher propriedade'}</Button>}
              {authorized && <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => open('authorize')}>Trocar conta Google</Button>}
            </>}
            {key === 'clarity' && canConfigure && <Button variant={resource ? 'outline' : 'default'} className="min-h-11" disabled={busy} onClick={() => open('clarity')}>{resource ? 'Trocar projeto ou token' : 'Conectar Microsoft Clarity'}</Button>}
            {authorized && canManage && <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => open('disconnect')}>Desconectar {analyticsProviders[key]}</Button>}
            {resource && <Button asChild variant="link" className="min-h-11"><Link to={`/marketing-ops/dashboard?tab=overview&detail=site&provider=${key}`}>Ver resultados no dashboard</Link></Button>}
          </div>}
          {key === 'clarity' && !canConfigure && <p className="text-xs text-muted-foreground">O administrador cadastra ou troca o token do projeto.</p>}
        </article>;
      })}
    </div>
    {selected && dialog === 'property' && <PropertyDialog connection={selected} api={api} fallback={() => refresh.current} onClose={() => setDialog(null)} onSuccess={() => { void done('Propriedade selecionada. Atualize os resultados para iniciar a leitura.'); }} />}
    {selected && dialog === 'clarity' && canConfigure && <ClarityDialog connection={selected} api={api} fallback={() => refresh.current} onClose={() => setDialog(null)} onSuccess={() => { void done('Clarity conectado. A leitura do projeto foi validada.'); }} />}
    {selected && dialog === 'disconnect' && <AnalyticsDisconnectDialog connection={selected} api={api} fallback={() => refresh.current} onClose={() => setDialog(null)} onSuccess={() => { void done('Conexão encerrada. O histórico foi preservado.'); }} />}
    {dialog === 'authorize' && <GoogleAuthorizationDialog busy={busy} error={error} fallback={() => refresh.current} onClose={() => { if (!lock.current) setDialog(null); }} onConfirm={() => { void authorize(); }} />}
  </section>;
}

type DialogProps = { connection: AnalyticsConnection; api: AnalyticsClient; onClose: () => void; onSuccess: () => void; fallback: () => HTMLElement | null };
function GoogleAuthorizationDialog({ busy, error, fallback, onClose, onConfirm }: { busy: boolean; error: unknown; fallback: () => HTMLElement | null; onClose: () => void; onConfirm: () => void }) {
  const returnFocus = useDialogReturnFocus(fallback);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className={`${leadDialog} sm:max-w-lg`} onCloseAutoFocus={returnFocus} onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>Trocar conta Google?</DialogTitle><DialogDescription>A autorização atual do Analytics será encerrada. Autorize a nova conta, escolha uma propriedade e revise os vínculos das campanhas. O histórico será preservado.</DialogDescription></DialogHeader><LeadError error={error} /><div className="flex flex-wrap justify-end gap-3"><Button className="min-h-11" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button className="min-h-11" disabled={busy} onClick={onConfirm}>{busy ? 'Abrindo Google…' : 'Confirmar nova autorização'}</Button></div></DialogContent></Dialog>;
}
function PropertyDialog({ connection, api, onClose, onSuccess, fallback }: DialogProps) {
  const qc = useQueryClient(); const returnFocus = useDialogReturnFocus(fallback);
  const resources = useQuery({ queryKey: analyticsKeys.resources, queryFn: api.resources, staleTime: 0, retry: false });
  const [id, setId] = useState(connection.selectedResourceId ?? ''); const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const replacement = !!connection.selectedResourceId && id !== connection.selectedResourceId;
  const save = async () => {
    if (lock.current || !resources.data?.data.some(row => row.id === id) || (replacement && !confirmed)) return;
    lock.current = true; setBusy(true); setError(null);
    try { await api.selectResource(id, connection.version, replacement); onSuccess(); }
    catch (issue) { setError(issue); if ((issue as { status?: number }).status === 409) { setConfirmed(false); await qc.invalidateQueries({ queryKey: analyticsKeys.connections }); } }
    finally { lock.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}><DialogContent className={`${leadDialog} sm:max-w-xl`} onCloseAutoFocus={returnFocus} onInteractOutside={event => { if (lock.current) event.preventDefault(); }} onEscapeKeyDown={event => { if (lock.current) event.preventDefault(); }}><DialogHeader><DialogTitle>Escolher propriedade GA4</DialogTitle><DialogDescription>Escolha o site que deseja acompanhar. Somente propriedades acessíveis pela conta autorizada aparecem aqui.</DialogDescription></DialogHeader><LeadError error={error || resources.error} retry={() => { void resources.refetch(); }} />{resources.isLoading && <p role="status">Carregando propriedades…</p>}
    {resources.data?.data.length === 0 && <div className="space-y-3 text-sm"><p>Nenhuma propriedade acessível. Crie uma propriedade GA4 ou peça acesso ao administrador do seu Analytics.</p><a className="inline-flex min-h-11 items-center text-brand-accent underline" href="https://analytics.google.com/" target="_blank" rel="noopener noreferrer">Criar propriedade GA4</a><p className="text-muted-foreground">Depois, instale a tag no site e atualize esta lista. Uma propriedade sem visitas pode ser conectada, mas ainda não terá resultados.</p></div>}
    <fieldset disabled={busy} className="space-y-3"><legend className="sr-only">Propriedades disponíveis</legend>{resources.data?.data.map(row => <label key={row.id} className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-border p-4 hover:bg-accent"><input className="mt-1 h-4 w-4 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" type="radio" name="ga4-resource" checked={id === row.id} onChange={() => { setId(row.id); setConfirmed(false); }} /><span className="min-w-0 break-words"><span className="block font-medium">{row.name}</span><span className="mt-1 block text-xs text-muted-foreground">{row.id} · {row.timeZone}</span></span></label>)}</fieldset>
    {replacement && <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmo a troca da propriedade. Vou revisar os vínculos das campanhas; o histórico anterior será preservado.</span></label>}
    <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Cancelar</Button><Button className="min-h-11" disabled={busy || resources.isFetching || !resources.data?.data.some(row => row.id === id) || (replacement && !confirmed)} onClick={() => { void save(); }}>{busy ? 'Salvando…' : 'Confirmar propriedade'}</Button></div>
  </DialogContent></Dialog>;
}

function ClarityDialog({ connection, api, onClose, onSuccess, fallback }: DialogProps) {
  const returnFocus = useDialogReturnFocus(fallback); const qc = useQueryClient(); const proposal = useProposalKey();
  const [token, setToken] = useState(''); const [id, setId] = useState(''); const [name, setName] = useState('');
  const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const replacement = connection.version > 0;
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (lock.current || !token.trim() || !id.trim() || !name.trim() || (replacement && !confirmed)) return;
    const input = { token: token.trim(), projectId: id.trim(), projectName: name.trim(), ...(replacement ? { confirmReplacement: true } : {}) };
    lock.current = true; setBusy(true); setError(null);
    try { await api.connectClarity(input, connection.version, proposal({ version: connection.version, input })); setToken(''); proposal.reset(); onSuccess(); }
    catch (issue) { setError(issue); if ((issue as { status?: number }).status === 409) { proposal.reset(); setConfirmed(false); await qc.invalidateQueries({ queryKey: analyticsKeys.connections }); } }
    finally { lock.current = false; setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) { setToken(''); onClose(); } }}><DialogContent className={`${leadDialog} sm:max-w-xl`} onCloseAutoFocus={returnFocus} onInteractOutside={event => { if (lock.current) event.preventDefault(); }} onEscapeKeyDown={event => { if (lock.current) event.preventDefault(); }}><DialogHeader><DialogTitle>{replacement ? 'Trocar projeto Clarity' : 'Conectar Microsoft Clarity'}</DialogTitle><DialogDescription>No Clarity, abra Settings → Data Export e gere um token de API como administrador do projeto.</DialogDescription></DialogHeader><LeadError error={error} /><form onSubmit={event => { void save(event); }} className="space-y-5">
    <div className="space-y-2"><Label htmlFor="clarity-project-id">ID do projeto</Label><Input id="clarity-project-id" className="min-h-11" value={id} onChange={event => setId(event.target.value)} disabled={busy} required maxLength={100} pattern="[A-Za-z0-9_-]+" aria-describedby="clarity-id-help" /><p id="clarity-id-help" className="text-xs text-muted-foreground">Copie o ID da URL do seu projeto. Ele será usado para abrir o Clarity.</p></div>
    <div className="space-y-2"><Label htmlFor="clarity-project-name">Nome do projeto</Label><Input id="clarity-project-name" className="min-h-11" value={name} onChange={event => setName(event.target.value)} disabled={busy} required maxLength={150} /></div>
    <div className="space-y-2"><Label htmlFor="clarity-token">Token de exportação</Label><Input id="clarity-token" className="min-h-11" type="password" autoComplete="new-password" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} disabled={busy} required maxLength={8192} aria-describedby="clarity-token-help" /><p id="clarity-token-help" className="text-xs leading-relaxed text-muted-foreground">O token será validado e guardado de forma cifrada no servidor. O nome e o ID são informados por você; a API não confirma esses rótulos.</p></div>
    <p className="text-xs leading-relaxed text-muted-foreground">A API consulta até os últimos três dias, com dez requisições por projeto/dia. Aqui usamos a janela de 24 horas. Mapas de calor e gravações permanecem no Clarity.</p>
    {replacement && <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmo a troca do projeto ou token. Os vínculos precisarão ser revisados; o histórico será preservado.</span></label>}
    <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Cancelar</Button><Button className="min-h-11" type="submit" disabled={busy || !token.trim() || !id.trim() || !name.trim() || (replacement && !confirmed)}>{busy ? 'Validando leitura…' : 'Validar e conectar'}</Button></div>
  </form></DialogContent></Dialog>;
}

function AnalyticsDisconnectDialog({ connection, api, onClose, onSuccess, fallback }: DialogProps) {
  const returnFocus = useDialogReturnFocus(fallback); const qc = useQueryClient(); const lock = useRef(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const confirm = async () => { if (lock.current) return; lock.current = true; setBusy(true); setError(null); try { await api.disconnect(connection.provider, connection.version); onSuccess(); } catch (issue) { setError(issue); if ((issue as { status?: number }).status === 409) await qc.invalidateQueries({ queryKey: analyticsKeys.connections }); } finally { lock.current = false; setBusy(false); } };
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}><DialogContent className={`${leadDialog} sm:max-w-lg`} onCloseAutoFocus={returnFocus} onInteractOutside={event => { if (lock.current) event.preventDefault(); }} onEscapeKeyDown={event => { if (lock.current) event.preventDefault(); }}><DialogHeader><DialogTitle>Desconectar {analyticsProviders[connection.provider]}?</DialogTitle><DialogDescription>Novas leituras serão interrompidas. Vínculos e resultados anteriores permanecerão no histórico.</DialogDescription></DialogHeader><LeadError error={error} /><div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Cancelar</Button><Button className="min-h-11" disabled={busy} onClick={() => { void confirm(); }}>{busy ? 'Desconectando…' : 'Confirmar desconexão'}</Button></div></DialogContent></Dialog>;
}
