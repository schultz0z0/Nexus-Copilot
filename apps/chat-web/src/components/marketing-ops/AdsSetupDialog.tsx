import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adsKeys, adsMessages, adsProviders, type AdsClient, type AdsProvider, type AdsSetup, type AdsSetupInput } from '@/lib/marketingOps/ads';
import { leadDialog, useDialogReturnFocus, useProposalKey } from './leadUiHelpers';

const providers = {
  meta: { idLabel: 'ID do aplicativo', version: '', versionHelp: 'Confira no painel Meta a versão disponível para o aplicativo (formato vNN.0).', url: 'https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/', help: 'No Meta for Developers, crie o aplicativo da empresa, habilite Facebook Login for Business e copie App ID, App Secret e o ID da configuração de login. Cadastre a URL abaixo nas URLs de redirecionamento OAuth válidas.', scopes: ['ads_read', 'leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'business_management'], defaults: ['ads_read'] },
  google: { idLabel: 'ID do cliente OAuth', version: 'v25', versionHelp: 'Sugestão: v25. Confira a versão disponível na documentação do Google Ads.', url: 'https://developers.google.com/google-ads/api/docs/oauth/overview', help: 'No Google Cloud Console, habilite a Google Ads API e valide o acesso ao projeto da empresa. Configure a tela de consentimento e crie um cliente OAuth do tipo Aplicativo da Web. Copie o ID e o segredo e cadastre a URL abaixo nas URIs de redirecionamento autorizadas.', scopes: ['https://www.googleapis.com/auth/adwords'], defaults: ['https://www.googleapis.com/auth/adwords'] },
  linkedin: { idLabel: 'ID do cliente', version: '202609', versionHelp: 'Sugestão: 202609. Confira a versão disponível na documentação de Marketing APIs.', url: 'https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow', help: 'No LinkedIn Developer Portal, crie o aplicativo da empresa e habilite os produtos de Marketing APIs necessários. Em Auth, copie Client ID e Client Secret e cadastre a URL abaixo nas URLs de redirecionamento OAuth 2.0.', scopes: ['r_ads', 'r_ads_reporting', 'r_marketing_leadgen_automation'], defaults: ['r_ads', 'r_ads_reporting'] },
} as const;
const scopeLabels: Record<string, string> = { ads_read: 'Ler anúncios e métricas', leads_retrieval: 'Ler contatos de formulários', pages_show_list: 'Listar páginas da empresa', pages_read_engagement: 'Ler dados das páginas', business_management: 'Consultar negócios e seus ativos', 'https://www.googleapis.com/auth/adwords': 'Consultar contas e dados do Google Ads', r_ads: 'Ler contas e anúncios', r_ads_reporting: 'Ler relatórios de anúncios', r_marketing_leadgen_automation: 'Ler contatos de formulários' };

export function AdsConnectionSteps({ current }: { current: 0 | 1 | 2 }) {
  return <ol aria-label="Etapas da conexão" className="grid grid-cols-3 gap-2 border-b border-border pb-4 text-sm">{['Aplicativo', 'Autorização', 'Conta'].map((step, index) => <li key={step} aria-current={index === current ? 'step' : undefined} className={index === current ? 'font-medium text-brand-accent' : 'text-muted-foreground'}><span className="block">{index + 1}</span>{step}</li>)}</ol>;
}

export function AdsSetupDialog({ provider, api, onClose, onSaved, onAuthorize, focusFallback, purpose = 'ads' }: { provider: AdsProvider; api: AdsClient; onClose: () => void; onSaved: () => void; onAuthorize: () => Promise<void> | void; focusFallback: () => HTMLElement | null; purpose?: 'ads' | 'analytics' }) {
  const qc = useQueryClient(); const returnFocus = useDialogReturnFocus(focusFallback); const proposalKey = useProposalKey();
  const config = providers[provider]; const initialized = useRef(false); const locked = useRef(false);
  const setup = useQuery({ queryKey: adsKeys.setup(provider), queryFn: () => api.setup(provider), staleTime: 0, retry: false });
  const [clientId, setClientId] = useState(''); const [secret, setSecret] = useState(''); const [apiVersion, setApiVersion] = useState<string>(config.version);
  const [scopes, setScopes] = useState<string[]>([...config.defaults]); const [metaId, setMetaId] = useState(''); const [googleId, setGoogleId] = useState('');
  const [stage, setStage] = useState<'form' | 'review' | 'saved'>('form'); const [replacement, setReplacement] = useState(false); const [takeover, setTakeover] = useState(false);
  const [reviewedSetup, setReviewedSetup] = useState<AdsSetup | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [fields, setFields] = useState<Record<string, string>>({});
  const firstField = useRef<HTMLInputElement>(null); const reviewHeading = useRef<HTMLHeadingElement>(null); const continueButton = useRef<HTMLButtonElement>(null);
  const metadata = setup.data?.data; const requiresReplacement = (stage === 'review' ? reviewedSetup : metadata)?.mode !== 'empty';
  const hasOrigin = !!metadata?.publicOrigin && !!metadata.redirectUri;
  const proposalSetup = stage === 'review' ? reviewedSetup : metadata;
  const canSave = !!proposalSetup?.publicOrigin && !!proposalSetup.redirectUri && (stage === 'review' || !setup.isError) && (proposalSetup.writable || proposalSetup.mode === 'external');
  useEffect(() => {
    if (!metadata || initialized.current) return;
    initialized.current = true; setClientId(metadata.clientId ?? ''); setApiVersion(metadata.apiVersion ?? config.version);
    setScopes(metadata.scopes.length ? metadata.scopes : [...config.defaults]); setMetaId(metadata.metaLoginConfigId ?? ''); setGoogleId(metadata.googleLoginCustomerId ?? '');
    firstField.current?.focus();
  }, [metadata, config]);
  useEffect(() => { if (stage === 'review') reviewHeading.current?.focus(); if (stage === 'saved' && !busy) continueButton.current?.focus(); }, [stage, busy]);
  const safeError = (issue: unknown) => (issue as { code?: string })?.code === 'validation_error' ? 'Confira o ID, a versão da API e as permissões do aplicativo antes de revisar novamente.' : adsMessages[(issue as { code?: string })?.code ?? ''] ?? 'Não foi possível concluir a operação. Confira sua conexão e tente novamente.';
  const review = () => {
    if (!canSave || locked.current || setup.isFetching) return;
    const next: Record<string, string> = {};
    if (!clientId.trim()) next.clientId = 'Informe o ID do aplicativo.';
    else if (clientId.trim().length > 256 || !/^[A-Za-z0-9._:-]+$/.test(clientId.trim())) next.clientId = 'Use até 256 caracteres: letras, números, ponto, sublinhado, dois-pontos ou hífen.';
    if ((!metadata.hasClientSecret || metadata.mode !== 'managed') && !secret.trim()) next.secret = 'Informe o segredo do aplicativo.';
    if (secret.length > 4096 || [...secret].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) next.secret = 'Use até 4096 caracteres e remova quebras de linha ou caracteres de controle do segredo.';
    if (!(provider === 'meta' ? /^v\d{2}\.0$/ : provider === 'google' ? /^v\d{2}$/ : /^20\d{2}(0[1-9]|1[0-2])$/).test(apiVersion.trim())) next.apiVersion = 'Informe uma versão válida da API.';
    if (provider === 'meta' && !/^\d{1,30}$/.test(metaId.trim())) next.metaId = 'Informe o ID numérico da configuração de login, com até 30 dígitos.';
    if (provider === 'google' && googleId.trim() && !/^\d{10}$/.test(googleId.replace(/-/g, '').trim())) next.googleId = 'Informe os 10 dígitos da conta gerenciadora.';
    if (!scopes.length) next.scopes = 'Selecione pelo menos uma permissão.';
    setFields(next);
    if (Object.keys(next).length) { const invalid = document.getElementById(`ads-setup-${Object.keys(next)[0]}`); const advanced = invalid?.closest('details'); if (advanced) advanced.open = true; invalid?.focus(); return; }
    setError(''); setReplacement(false); setTakeover(false); setReviewedSetup({ ...metadata, scopes: [...metadata.scopes] }); setStage('review');
  };
  const save = async () => {
    if (!reviewedSetup || !canSave || locked.current || stage !== 'review' || (requiresReplacement && !replacement) || (reviewedSetup.mode === 'external' && !takeover)) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    const input: AdsSetupInput = { clientId: clientId.trim(), apiVersion: apiVersion.trim(), scopes, ...(secret.trim() ? { clientSecret: secret.trim() } : {}), ...(provider === 'meta' ? { metaLoginConfigId: metaId.trim() } : {}), ...(provider === 'google' && googleId.trim() ? { googleLoginCustomerId: googleId.replace(/-/g, '').trim() } : {}), ...(requiresReplacement ? { confirmReplacement: true } : {}), ...(reviewedSetup.mode === 'external' ? { takeOverExternal: true } : {}) };
    try {
      const response = await api.saveSetup(provider, input, reviewedSetup.version, proposalKey({ input, version: reviewedSetup.version }));
      setSecret(''); proposalKey.reset(); qc.setQueryData(adsKeys.setup(provider), response);
      setStage('saved'); onSaved(); await qc.invalidateQueries({ queryKey: adsKeys.connections });
    } catch (issue) {
      const code = (issue as { code?: string })?.code;
      if (code === 'version_conflict') {
        proposalKey.reset(); setStage('form'); setReviewedSetup(null); setReplacement(false); setTakeover(false);
        const fresh = await setup.refetch();
        setError(fresh.isError ? 'Os dados mudaram. Não foi possível carregar a versão atual; carregue a configuração novamente antes de revisar.' : 'Os dados mudaram. A versão atual foi carregada; revise seus campos e confirme novamente.');
      } else { setError(safeError(issue)); if (code === 'idempotency_conflict') { proposalKey.reset(); setStage('form'); } }
    } finally { locked.current = false; setBusy(false); }
  };
  const authorize = async () => { if (locked.current) return; locked.current = true; setBusy(true); setError(''); try { await onAuthorize(); } catch { setError('Não foi possível iniciar a autorização. Tente novamente pelo botão Continuar e autorizar.'); } finally { locked.current = false; setBusy(false); } };
  const copy = async () => { try { await navigator.clipboard.writeText(metadata!.redirectUri!); setNotice('URL de retorno copiada.'); } catch { setNotice('Selecione e copie a URL de retorno abaixo.'); } };
  const field = (id: string, label: string, value: string, change: (value: string) => void, help?: string, password = false) => <div className="min-w-0 space-y-2"><Label htmlFor={`ads-setup-${id}`}>{label}</Label><Input ref={id === 'clientId' ? firstField : undefined} id={`ads-setup-${id}`} className="min-h-11" type={password ? 'password' : 'text'} autoComplete={password ? 'new-password' : 'off'} value={value} disabled={busy} onChange={event => change(event.target.value)} aria-invalid={!!fields[id]} aria-describedby={`${help ? `ads-help-${id} ` : ''}${fields[id] ? `ads-error-${id}` : ''}`.trim() || undefined} />{help && <p id={`ads-help-${id}`} className="text-sm text-muted-foreground">{help}</p>}{fields[id] && <p id={`ads-error-${id}`} className="text-sm text-status-error">{fields[id]}</p>}</div>;
  return <Dialog open onOpenChange={open => { if (!open && !locked.current) onClose(); }}><DialogContent className={`${leadDialog} sm:max-w-2xl [&_button]:max-w-full [&_button]:whitespace-normal`} onCloseAutoFocus={returnFocus} onInteractOutside={event => { if (locked.current) event.preventDefault(); }} onEscapeKeyDown={event => { if (locked.current) event.preventDefault(); }} aria-busy={busy}>
    <DialogHeader><DialogTitle>Aplicativo {provider === 'google' && purpose === 'analytics' ? 'Google' : adsProviders[provider]}</DialogTitle><DialogDescription>{purpose === 'analytics' ? 'Prepare o aplicativo da empresa para Google Ads e Analytics. Cada serviço terá sua própria autorização.' : 'Prepare o aplicativo da empresa, autorize o acesso e escolha a conta de anúncios.'}</DialogDescription></DialogHeader>
    <AdsConnectionSteps current={stage === 'saved' ? 1 : 0} />
    {(error || setup.error) && <p role="alert" className="text-sm text-status-error">{error || safeError(setup.error)}</p>}
    <p role="status" aria-live="polite" className={notice ? 'text-sm text-text-secondary' : 'sr-only'}>{notice}</p>
    {setup.isLoading && <p role="status">Carregando configuração…</p>}
    {metadata && stage === 'form' && <>
      <div className="space-y-3 text-sm leading-relaxed"><p className="text-text-secondary">{config.help}</p>{provider === 'google' && <p className="text-text-secondary">Para GA4, habilite também Google Analytics Admin API e Google Analytics Data API. Adicione o escopo analytics.readonly à tela de consentimento. A autorização do Analytics solicita apenas leitura e usa a mesma URL de retorno abaixo.</p>}<a className="inline-flex min-h-11 items-center text-brand-accent underline underline-offset-4" href={config.url} target="_blank" rel="noopener noreferrer">Consultar documentação oficial de {adsProviders[provider]}</a></div>
      {hasOrigin ? <section className="min-w-0 space-y-2" aria-label="Retorno de autorização"><p className="text-sm font-medium">URL de retorno para cadastrar no provedor</p><code className="block select-all break-all rounded-md border border-border bg-background p-3 text-sm">{metadata.redirectUri}</code><Button variant="outline" className="min-h-11" onClick={() => { void copy(); }}>Copiar URL de retorno</Button></section> : <p className="text-sm text-status-warning">O responsável pela instalação precisa preparar o endereço público de retorno no servidor. Depois, carregue a configuração novamente para continuar.</p>}
      {metadata.mode === 'external' && <p className="text-sm text-status-warning">Este aplicativo é preparado fora do app. Você pode assumir a gestão com novas credenciais e confirmação. Os arquivos de configuração externos serão preservados.</p>}
      {!canSave && hasOrigin && <p className="text-sm text-status-warning">O armazenamento privado ainda não permite salvar esta configuração. Peça ao responsável pela instalação para verificar o servidor.</p>}
      <fieldset disabled={busy || !canSave} className="min-w-0 space-y-5"><legend className="sr-only">Credenciais do aplicativo</legend>
        {field('clientId', config.idLabel, clientId, setClientId)}
        {field('secret', 'Segredo do aplicativo', secret, setSecret, metadata.mode === 'managed' && metadata.hasClientSecret ? 'Deixe vazio para preservar o segredo armazenado. Informe um novo valor apenas para substituí-lo.' : 'Copie o segredo no painel do provedor. Ele é obrigatório neste cadastro.', true)}
        {field('apiVersion', 'Versão da API', apiVersion, setApiVersion, config.versionHelp)}
        {provider === 'meta' && field('metaId', 'ID da configuração de login', metaId, setMetaId, 'ID numérico da configuração do Facebook Login for Business.')}
        <fieldset aria-invalid={!!fields.scopes} aria-describedby={fields.scopes ? 'ads-error-scopes' : 'ads-scopes-help'}><legend className="text-sm font-medium">Permissões solicitadas</legend><p id="ads-scopes-help" className="mt-2 text-sm text-muted-foreground">Selecione as permissões aprovadas para o aplicativo. Métricas e formulários dependem de acessos distintos.</p><div className="mt-2">{config.scopes.map(scope => <label key={scope} className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm"><Checkbox id={scope === config.scopes[0] ? 'ads-setup-scopes' : undefined} checked={scopes.includes(scope)} onCheckedChange={checked => setScopes(current => checked ? [...current, scope] : current.filter(value => value !== scope))} /><span className="min-w-0 break-words">{scopeLabels[scope]}</span></label>)}</div>{fields.scopes && <p id="ads-error-scopes" className="text-sm text-status-error">{fields.scopes}</p>}</fieldset>
        {provider === 'google' && <details><summary className="min-h-11 cursor-pointer py-3 text-brand-accent">Opções avançadas do Google Ads</summary>{field('googleId', 'ID da conta gerenciadora (opcional)', googleId, setGoogleId, '10 dígitos. Informe somente quando o acesso usa uma conta gerenciadora.')}</details>}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Cancelar</Button><Button variant="outline" className="min-h-11" disabled={busy || setup.isFetching} onClick={() => { setError(''); void setup.refetch(); }}>Carregar configuração novamente</Button>{canSave && <Button className="min-h-11" disabled={busy || setup.isFetching} onClick={review}>Revisar aplicativo</Button>}</div>
    </>}
    {metadata && stage === 'review' && <section className="min-w-0 space-y-5" aria-label="Revisão do aplicativo"><h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-medium outline-none">Revise antes de salvar</h3><dl className="space-y-3 text-sm"><div><dt className="text-muted-foreground">{config.idLabel}</dt><dd className="break-all font-mono">{clientId.trim()}</dd></div><div><dt className="text-muted-foreground">Segredo do aplicativo</dt><dd>{secret.trim() ? 'Novo segredo informado' : 'Segredo armazenado será preservado'}</dd></div><div><dt className="text-muted-foreground">Versão da API</dt><dd>{apiVersion.trim()}</dd></div>{provider === 'meta' && <div><dt className="text-muted-foreground">ID da configuração de login</dt><dd className="break-all">{metaId.trim()}</dd></div>}{provider === 'google' && googleId.trim() && <div><dt className="text-muted-foreground">Conta gerenciadora</dt><dd>{googleId}</dd></div>}<div><dt className="text-muted-foreground">Permissões</dt><dd>{scopes.map(scope => scopeLabels[scope]).join(', ')}</dd></div><div><dt className="text-muted-foreground">URL de retorno</dt><dd className="break-all font-mono">{reviewedSetup?.redirectUri}</dd></div></dl>
      <p className="text-sm text-muted-foreground">Salvar prepara o aplicativo. A conexão só ficará ativa após autorizar no provedor e escolher uma conta.</p>
      {requiresReplacement && <><p className="text-sm text-status-warning">Trocar o aplicativo encerra a autorização atual e invalida consultas pendentes. Será necessário autorizar novamente. Contatos, vínculos e resultados anteriores permanecem no histórico.</p>{provider === 'google' && <p className="text-sm text-status-warning">A troca afeta Google Ads e Google Analytics desta instalação. Os dois precisarão de nova autorização.</p>}<label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><Checkbox checked={replacement} disabled={busy} onCheckedChange={value => setReplacement(value === true)} /><span>Confirmo a troca do aplicativo e a nova autorização necessária.</span></label></>}
      {reviewedSetup?.mode === 'external' && <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><Checkbox checked={takeover} disabled={busy} onCheckedChange={value => setTakeover(value === true)} /><span>Assumir a gestão deste aplicativo pelo app com as novas credenciais.</span></label>}
      <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setStage('form')}>Voltar e editar</Button><Button variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Cancelar</Button><Button className="min-h-11" aria-busy={busy} disabled={busy || (requiresReplacement && !replacement) || (reviewedSetup?.mode === 'external' && !takeover)} onClick={() => { void save(); }}>{busy ? 'Salvando…' : 'Salvar aplicativo'}</Button></div>
    </section>}
    {stage === 'saved' && <section className="space-y-5"><p role="status" aria-live="polite" className="text-sm text-status-success">{purpose === 'analytics' ? 'Aplicativo preparado. Falta autorizar e escolher a propriedade GA4.' : 'Aplicativo preparado. Falta autorizar e escolher a conta.'}</p><p className="text-sm text-text-secondary">{purpose === 'analytics' ? 'Continue no Google para autorizar o Analytics. Ao retornar, escolha a propriedade do site. Google Ads pode ser conectado depois pela aba Anúncios.' : 'Continue no site do provedor para autorizar o acesso. Ao retornar, escolha a conta que será usada nesta instalação.'}</p><div className="flex flex-wrap justify-end gap-3"><Button variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>Concluir depois</Button><Button ref={continueButton} className="min-h-11" disabled={busy} aria-busy={busy} onClick={() => { void authorize(); }}>{busy ? 'Abrindo provedor…' : purpose === 'analytics' ? 'Continuar e autorizar GA4' : 'Continuar e autorizar'}</Button></div></section>}
    {!metadata && !setup.isLoading && <Button variant="outline" className="min-h-11" disabled={setup.isFetching} onClick={() => { void setup.refetch(); }}>Carregar configuração novamente</Button>}
  </DialogContent></Dialog>;
}
