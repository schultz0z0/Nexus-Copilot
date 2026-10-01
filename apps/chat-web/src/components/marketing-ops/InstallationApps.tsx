import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { adsClient, adsKeys, adsProviders, safeAuthorizationUrl, type AdsProvider } from '@/lib/marketingOps/ads';
import { analyticsClient, analyticsKeys, safeGoogleAnalyticsUrl } from '@/lib/marketingOps/analytics';
import { AdsSetupDialog } from './AdsSetupDialog';
import { LeadError } from './LeadUi';

export function InstallationApps() {
  const qc = useQueryClient(); const [provider, setProvider] = useState<AdsProvider | null>(null); const first = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('');
  return <details className="border-t border-border pt-3"><summary className="flex min-h-11 cursor-pointer items-center text-sm text-brand-accent">Configuração avançada da instalação</summary><div className="space-y-5 pt-4"><p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">O administrador prepara os aplicativos da empresa uma vez. Depois, cada responsável autoriza sua conta pelo botão Conectar. Google Ads e Analytics compartilham o mesmo aplicativo Google, com permissões e recursos independentes.</p><LeadError error={error} /><p role="status" className={notice ? 'text-sm text-status-success' : 'sr-only'}>{notice}</p><div className="flex flex-wrap gap-3">{(['google', 'meta', 'linkedin'] as AdsProvider[]).map((key, index) => <Button ref={index === 0 ? first : undefined} key={key} variant="outline" className="min-h-11" onClick={() => { setError(null); setProvider(key); }}>{key === 'google' ? 'Preparar / trocar aplicativo Google' : `Preparar / trocar aplicativo ${adsProviders[key]}`}</Button>)}</div></div>
    {provider && <AdsSetupDialog provider={provider} api={adsClient} purpose={provider === 'google' ? 'analytics' : 'ads'} focusFallback={() => first.current} onClose={() => setProvider(null)} onSaved={() => { setNotice('Aplicativo preparado. Agora autorize o serviço que deseja conectar.'); void qc.invalidateQueries({ queryKey: analyticsKeys.all }); void qc.invalidateQueries({ queryKey: adsKeys.all }); }} onAuthorize={async () => {
      try { const result = provider === 'google' ? await analyticsClient.authorize() : await adsClient.authorize(provider); window.location.assign(provider === 'google' ? safeGoogleAnalyticsUrl(result.data.authorizationUrl) : safeAuthorizationUrl(provider, result.data.authorizationUrl)); }
      catch (issue) { setError(issue); throw issue; }
    }} />}
  </details>;
}
