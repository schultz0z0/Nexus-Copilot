import { useQuery } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router-dom";
import { workspaceDashboardTarget } from "@/lib/marketingOps/dashboardNavigation";
import { FolderOpen } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { MarketingOpsMobileBar } from "@/components/marketing-ops/MarketingOpsMobileBar";
import { WorkspaceWorkbench } from "@/components/marketing-ops/WorkspaceWorkbench";
import { LeadError } from "@/components/marketing-ops/LeadUi";
import { useAuth } from "@/contexts/AuthContext";
import { marketingOpsFlags } from "@/lib/marketingOps/flags";
import { marketingOpsClient } from "@/lib/marketingOps/runtime";
import {
  workspaceServices,
  type WorkspaceService,
} from "@/lib/marketingOps/workspace";
export default function WorkspacePage() {
  const { normalizedRole } = useAuth();
  const canRead = normalizedRole === "admin" || normalizedRole === "manager";
  const canManage = canRead && marketingOpsFlags(import.meta.env).write;
  const [params] = useSearchParams();
  const campaignId = params.get("campaignId");
  const validId =
    !campaignId || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(campaignId);
  const campaign = useQuery({
    queryKey: ["workspace", "campaign", campaignId],
    queryFn: () => marketingOpsClient.getCampaign(campaignId!),
    enabled: canRead && !!campaignId && validId,
    retry: false,
  });
  const requested = params.get("service");
  const service =
    requested &&
    Object.prototype.hasOwnProperty.call(workspaceServices, requested)
      ? (requested as WorkspaceService)
      : undefined;
  if (!campaignId) return <Navigate replace to={workspaceDashboardTarget(params)} />;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="min-w-0 md:pl-20">
        <MarketingOpsMobileBar
          label="Trabalho integrado"
          icon={<FolderOpen aria-hidden="true" className="h-4 w-4" />}
        />
        <main className="mx-auto max-w-[1360px] space-y-7 px-4 py-7 pb-24 sm:px-6 md:px-10 md:py-10">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Trabalho integrado
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {campaign.data
                ? `Campanha: ${campaign.data.data.name}`
                : "Arquivos, conversas, agenda e dados do seu marketing."}
            </p>
          </header>
          {!canRead ? (
            <p className="text-sm text-muted-foreground">
              Os serviços de trabalho estão disponíveis para gestores e
              administradores.
            </p>
          ) : !validId ? (
            <LeadError
              error={
                new Error(
                  "A campanha informada não é válida. Abra Trabalho pela página da campanha.",
                )
              }
            />
          ) : (
            <>
              <LeadError error={campaign.error} />
              {campaignId && campaign.isLoading && (
                <p role="status">Validando campanha…</p>
              )}
              {(!campaignId || campaign.data) && (
                <WorkspaceWorkbench
                  key={campaignId ?? "general"}
                  campaign={campaign.data?.data}
                  service={service}
                  canManage={canManage}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
