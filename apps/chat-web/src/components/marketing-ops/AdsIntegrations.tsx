import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adsClient, adsKeys, adsProviders, adsMessages, callbackMessage, safeAuthorizationUrl, type AdsClient, type AdsConnection, type AdsProvider, type AdsStatus } from '@/lib/marketingOps/ads';
import { LeadError } from './LeadUi';
import { leadDialog, shortDate, useDialogReturnFocus } from './leadUiHelpers';
import { AdsConnectionSteps, AdsSetupDialog } from './AdsSetupDialog';

const statuses: Record<AdsStatus, string> = { unprepared: 'Aguardando configuração', prepared: 'Pronto para conectar', pending_account: 'Escolha uma conta', connected: 'Conta conectada', partial: 'Permissões parciais', reconnect_required: 'Renovar autorização', disconnected: 'Desconectado', error: 'Conexão indisponível' };
export function AdsIntegrations({ api = adsClient, canManage, canConfigure = false, redirect = (url: string) => window.location.assign(url) }: { api?: AdsClient; canManage: boolean; canConfigure?: boolean; redirect?: (url: string) => void }) {
  const qc = useQueryClient(); const [params, setParams] = useSearchParams();
  const refreshButton = useRef<HTMLButtonElement>(null);
  const [outcome, setOutcome] = useState(() => callbackMessage(params.get('provider'), params.get('result')) ?? '');
  const connections = useQuery({ queryKey: adsKeys.connections, queryFn: () => api.connections() });
  const [accountProvider, setAccountProvider] = useState<AdsProvider | null>(null); const [disconnectProvider, setDisconnectProvider] = useState<AdsProvider | null>(null);
  const [busy, setBusy] = useState<AdsProvider | null>(null); const [error, setError] = useState<unknown>(null);
  const [setupProvider, setSetupProvider] = useState<AdsProvider | null>(null);
  const authorizationLock = useRef(false);
  useEffect(() => {
    if (params.get('provider') === 'ga4') return;
    if (!params.has('provider') && !params.has('result')) return;
    const message = callbackMessage(params.get('provider'), params.get('result'));
    if (message) setOutcome(message);
    const cleaned = new URLSearchParams(params); cleaned.delete('provider'); cleaned.delete('result');
    setParams(cleaned, { replace: true });
    void qc.invalidateQueries({ queryKey: adsKeys.connections });
  }, [params, setParams, qc]);
  const authorize = async (provider: AdsProvider) => {
    if (!canManage || authorizationLock.current) return; authorizationLock.current = true; setBusy(provider); setError(null); setOutcome('');
    try { const response = await api.authorize(provider); redirect(safeAuthorizationUrl(provider, response.data.authorizationUrl)); return true; }
    catch (issue) { setError(issue); return false; } finally { authorizationLock.current = false; setBusy(null); }
  };
  const selected = (provider: AdsProvider | null) => connections.data?.data.find(row => row.provider === provider);
  const disconnected = selected(disconnectProvider); const picking = selected(accountProvider);
  return <section className="space-y-6" aria-label="Conexões de anúncios" aria-busy={connections.isLoading || !!busy}>
    <div className="flex flex-wrap items-start justify-between gap-4"><p className="max-w-xl text-sm leading-relaxed text-text-secondary">Conecte as contas de anúncios da sua empresa para acompanhar resultados e revisar contatos nas campanhas.</p><Button ref={refreshButton} variant="outline" className="min-h-11" disabled={connections.isFetching || !!busy} onClick={() => { void connections.refetch(); }}><RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />Atualizar conexões</Button></div>
    <p role="status" aria-live="polite" aria-atomic="true" className={outcome ? 'rounded-xl border border-border bg-card p-4 text-sm text-text-secondary' : 'sr-only'}>{outcome}</p>
    <LeadError error={error || connections.error} retry={() => { setError(null); void connections.refetch(); }} />
    {!canManage && <p className="text-sm text-muted-foreground">Um administrador ou gestor pode conectar e gerenciar as contas. Você pode consultar o estado e os resultados disponíveis.</p>}
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {(Object.keys(adsProviders) as AdsProvider[]).map(provider => {
        const connection = selected(provider); const account = connection?.accounts.find(row => row.id === connection.selectedAccountId);
        const hasAuthorization = connection && ['pending_account', 'connected', 'partial', 'error'].includes(connection.status);
        return <article key={provider} aria-labelledby={`provider-${provider}`} className="space-y-4 border-b border-border p-5 last:border-b-0 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-brand-accent"><Link2 aria-hidden="true" className="h-5 w-5" /></div><h2 id={`provider-${provider}`} className="text-lg font-semibold tracking-tight">{adsProviders[provider]}</h2></div><span className={`inline-flex items-center gap-2 text-sm ${connection?.status === 'connected' ? 'text-status-success' : ['partial', 'reconnect_required', 'error'].includes(connection?.status ?? '') ? 'text-status-warning' : 'text-text-secondary'}`}>{connection?.status === 'connected' ? <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> : <CircleDashed aria-hidden="true" className="h-4 w-4" />}{connection ? statuses[connection.status] : connections.isLoading ? 'Carregando…' : 'Estado indisponível'}</span></div>
          {canConfigure && connection && <Button variant="outline" className="min-h-11 max-w-full whitespace-normal" disabled={!!busy} onClick={() => { setError(null); setSetupProvider(provider); }}>{connection.status === 'unprepared' ? 'Configurar aplicativo' : 'Editar / trocar aplicativo'} {adsProviders[provider]}</Button>}
          {connection?.status === 'unprepared' ? <><p className="text-sm text-muted-foreground">Um administrador pode preparar o aplicativo da empresa aqui. O responsável pela instalação prepara o endereço de retorno e o armazenamento privado do servidor.</p>{canManage && <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3 text-brand-accent">Orientações para o responsável</summary><p className="max-w-xl pb-3 leading-relaxed text-muted-foreground">Prepare o endereço público de retorno e o armazenamento privado conforme o guia de instalação. Depois, um administrador cadastra o aplicativo nesta tela e autoriza o acesso no provedor.</p></details>}</> : connection && <>
            {account ? <div className="space-y-1"><p className="break-words font-medium">{account.name}</p><p className="break-words text-sm text-muted-foreground">Moeda: {account.currency} · Fuso: {account.timeZone ?? 'Não informado'}</p></div> : <p className="text-sm text-muted-foreground">{connection.status === 'pending_account' ? 'Autorização recebida. Selecione a conta de anúncios que será usada nesta instalação.' : connection.status === 'disconnected' ? 'Novas consultas estão interrompidas. Os resultados anteriores continuam no histórico.' : 'Autorize o acesso pelo site do provedor e escolha sua conta de anúncios.'}</p>}
            {hasAuthorization && <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-secondary"><li>Métricas: {connection.capabilities.metrics ? 'Permitidas' : 'Sem permissão'}</li><li>Formulários: {connection.capabilities.nativeLeads ? 'Permitidos' : 'Sem permissão'}</li></ul>}
            {connection.lastSyncAt && <p className="text-xs text-muted-foreground">Última sincronização: {shortDate(connection.lastSyncAt)}</p>}
            {connection.safeError && <p className="text-sm text-status-warning">{adsMessages[connection.safeError] ?? 'A última consulta não foi concluída. Atualize ou renove a autorização.'}</p>}
            {canManage && <div className="flex flex-wrap gap-3">{['prepared', 'disconnected', 'reconnect_required', 'partial', 'error'].includes(connection.status) && <Button className="min-h-11" disabled={!!busy} aria-busy={busy === provider} onClick={() => { void authorize(provider); }}>{busy === provider ? 'Abrindo provedor…' : ['partial', 'reconnect_required', 'error'].includes(connection.status) ? `Renovar ${adsProviders[provider]}` : `Conectar ${adsProviders[provider]}`}</Button>}{hasAuthorization && <Button variant="outline" className="min-h-11" disabled={!!busy} onClick={() => { setError(null); setAccountProvider(provider); }}>{account ? `Trocar conta ${adsProviders[provider]}` : `Escolher conta ${adsProviders[provider]}`}</Button>}{['pending_account', 'connected', 'partial', 'reconnect_required', 'error'].includes(connection.status) && <Button variant="ghost" className="min-h-11" disabled={!!busy} onClick={() => { setError(null); setDisconnectProvider(provider); }}>Desconectar {adsProviders[provider]}</Button>}</div>}
          </>}
        </article>;
      })}
    </div>
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />Você autoriza no site do provedor. As contas e as permissões permanecem vinculadas à instalação da sua empresa.</p>
    {picking && <AdsAccountDialog key={picking.provider} connection={picking} api={api} onClose={() => setAccountProvider(null)} onSuccess={() => { setAccountProvider(null); setOutcome('Conta selecionada.'); }} />}
    {setupProvider && canConfigure && <AdsSetupDialog key={setupProvider} provider={setupProvider} api={api} focusFallback={() => refreshButton.current} onClose={() => setSetupProvider(null)} onSaved={() => setOutcome('Aplicativo preparado. Falta autorizar e escolher a conta.')} onAuthorize={async () => { if (!await authorize(setupProvider)) throw new Error('authorization_failed'); }} />}
    {disconnected && <DisconnectDialog connection={disconnected} api={api} focusFallback={() => refreshButton.current} onClose={() => setDisconnectProvider(null)} onSuccess={() => { setDisconnectProvider(null); setOutcome('Conexão encerrada. O histórico foi preservado.'); }} />}
  </section>;
}
function AdsAccountDialog({ connection, api, onClose, onSuccess }: { connection: AdsConnection; api: AdsClient; onClose: () => void; onSuccess: () => void }) {
  const qc = useQueryClient(); const returnFocus = useDialogReturnFocus();
  const accounts = useQuery({ queryKey: adsKeys.accounts(connection.provider), queryFn: () => api.accounts(connection.provider), staleTime: 0 });
  const [accountId, setAccountId] = useState(connection.selectedAccountId ?? ''); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const choose = async () => {
    if (busy || !accounts.data?.data.some(row => row.id === accountId && !row.manager)) return;
    setBusy(true); setError(null);
    try { await api.selectAccount(connection.provider, accountId, connection.version); await qc.invalidateQueries({ queryKey: adsKeys.all }); onSuccess(); }
    catch (issue) { setError(issue); if ((issue as { status?: number }).status === 409) await qc.invalidateQueries({ queryKey: adsKeys.connections }); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className={`${leadDialog} sm:max-w-xl`} onCloseAutoFocus={returnFocus} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>Escolher conta {adsProviders[connection.provider]}</DialogTitle><DialogDescription>Selecione uma conta de anúncios. Contas gerenciadoras não recebem vínculos de campanha.</DialogDescription></DialogHeader><AdsConnectionSteps current={2} /><LeadError error={error || accounts.error} retry={() => { void accounts.refetch(); }} />{accounts.isLoading && <p role="status">Carregando contas…</p>}{accounts.data && !accounts.data.data.length && <p className="text-sm text-muted-foreground">Nenhuma conta acessível. Confira seu acesso no provedor ou renove a autorização.</p>}<fieldset disabled={busy} className="space-y-3"><legend className="sr-only">Contas disponíveis</legend>{accounts.data?.data.map(account => <label key={account.id} className={`flex min-h-14 items-start gap-3 rounded-xl border border-border p-4 ${account.manager ? 'text-muted-foreground' : 'cursor-pointer hover:bg-accent'}`}><input className="mt-1 h-4 w-4 shrink-0 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" type="radio" name="ads-account" value={account.id} checked={accountId === account.id} disabled={account.manager} onChange={() => setAccountId(account.id)} /><span className="min-w-0"><span className="block break-words text-sm font-medium">{account.name}</span><span className="block break-words text-xs text-muted-foreground">{account.currency} · {account.timeZone ?? 'Fuso não informado'}{account.manager ? ' · Conta gerenciadora' : ''}</span></span></label>)}</fieldset>{connection.selectedAccountId && accountId !== connection.selectedAccountId && <p className="text-sm text-status-warning">Ao trocar a conta, os vínculos atuais precisarão corresponder à nova conta para voltar a sincronizar. O histórico permanece disponível.</p>}<div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Cancelar</Button><Button className="min-h-11" aria-busy={busy} disabled={busy || accounts.isFetching || !accounts.data?.data.some(row => row.id === accountId && !row.manager)} onClick={() => { void choose(); }}>{busy ? 'Salvando…' : 'Confirmar conta'}</Button></div></DialogContent></Dialog>;
}
function DisconnectDialog({ connection, api, onClose, onSuccess, focusFallback }: { connection: AdsConnection; api: AdsClient; onClose: () => void; onSuccess: () => void; focusFallback: () => HTMLElement | null }) {
  const qc = useQueryClient(); const returnFocus = useDialogReturnFocus(focusFallback); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const disconnect = async () => { if (busy) return; setBusy(true); setError(null); try { await api.disconnect(connection.provider, connection.version); await qc.invalidateQueries({ queryKey: adsKeys.all }); onSuccess(); } catch (issue) { setError(issue); if ((issue as { status?: number }).status === 409) await qc.invalidateQueries({ queryKey: adsKeys.connections }); } finally { setBusy(false); } };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className={`${leadDialog} sm:max-w-lg`} onCloseAutoFocus={returnFocus} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>Desconectar {adsProviders[connection.provider]}?</DialogTitle><DialogDescription>Novas consultas serão interrompidas. Vínculos, contatos importados e resultados anteriores permanecerão no histórico.</DialogDescription></DialogHeader><LeadError error={error} /><div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Cancelar</Button><Button className="min-h-11" disabled={busy} aria-busy={busy} onClick={() => { void disconnect(); }}>{busy ? 'Desconectando…' : 'Confirmar desconexão'}</Button></div></DialogContent></Dialog>;
}
