import { Link2 } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { MarketingOpsMobileBar } from '@/components/marketing-ops/MarketingOpsMobileBar';
import { AdsIntegrations } from '@/components/marketing-ops/AdsIntegrations';
import { useAuth } from '@/contexts/AuthContext';
import { marketingOpsFlags } from '@/lib/marketingOps/flags';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WebAnalyticsIntegrations } from '@/components/marketing-ops/WebAnalyticsIntegrations';
import { InstallationApps } from '@/components/marketing-ops/InstallationApps';
import { WorkspaceIntegrations } from '@/components/marketing-ops/WorkspaceIntegrations';

export default function IntegrationsPage() {
  const { normalizedRole } = useAuth(); const flags = marketingOpsFlags(import.meta.env);
  const canManage = flags.write && (normalizedRole === 'admin' || normalizedRole === 'manager');
  const canConfigure = flags.write && normalizedRole === 'admin';
  const canReadAnalytics = normalizedRole === 'admin' || normalizedRole === 'manager';
  const [params] = useSearchParams();
  return <div className="min-h-screen bg-background text-foreground"><Sidebar /><div className="min-w-0 md:pl-20"><MarketingOpsMobileBar label="Integrações" icon={<Link2 aria-hidden="true" className="h-4 w-4" />} /><main className="mx-auto max-w-5xl space-y-7 px-4 py-7 sm:px-6 md:px-10 md:py-10"><header><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Integrações</h1><p className="mt-2 text-sm text-muted-foreground">Conexões da sua empresa, gerenciadas por aqui.</p></header>
    <Tabs defaultValue={params.get('tab') === 'workspace' ? 'workspace' : params.get('provider') === 'ga4' || params.get('tab') === 'analytics' ? 'analytics' : 'ads'}><TabsList className="mb-6 h-auto min-h-12 flex-wrap"><TabsTrigger value="ads" className="min-h-11">Anúncios</TabsTrigger>{canReadAnalytics && <><TabsTrigger value="analytics" className="min-h-11">Análise do site</TabsTrigger><TabsTrigger value="workspace" className="min-h-11">Trabalho</TabsTrigger></>}</TabsList><TabsContent value="ads"><AdsIntegrations canManage={canManage} canConfigure={false} /></TabsContent>{canReadAnalytics && <><TabsContent value="analytics"><WebAnalyticsIntegrations canManage={canManage} canConfigure={canConfigure} /></TabsContent><TabsContent value="workspace"><WorkspaceIntegrations canManage={canManage} canConfigure={canConfigure} /></TabsContent></>}</Tabs>
    {canConfigure && <InstallationApps />}</main></div></div>;
}
