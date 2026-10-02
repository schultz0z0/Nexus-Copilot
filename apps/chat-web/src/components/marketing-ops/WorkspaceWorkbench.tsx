import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  workspaceClient,
  workspaceKeys,
  workspaceServices,
  workspaceError,
  type WorkspaceClient,
  type WorkspaceLink,
  type WorkspaceService,
} from "@/lib/marketingOps/workspace";
import type { MarketingOpsCampaign } from "@/lib/marketingOps/types";
import {
  WorkspaceCalendar,
  WorkspaceFiles,
  WorkspaceMail,
  WorkspaceResourceLink,
  WorkspaceSheets,
} from "./WorkspaceTools";
import { SearchConsoleResults } from "./SearchConsoleResults";
import { WorkspaceConfirm } from "./WorkspaceIntegrations";
import { LeadError } from "./LeadUi";
import { leadSelect, shortDate, useProposalKey } from "./leadUiHelpers";
export function WorkspaceWorkbench({
  campaign,
  service: initialService,
  canManage,
  api = workspaceClient,
}: {
  campaign?: MarketingOpsCampaign;
  service?: WorkspaceService;
  canManage: boolean;
  api?: WorkspaceClient;
}) {
  const connections = useQuery({
    queryKey: workspaceKeys.connections,
    queryFn: api.connections,
    retry: false,
  });
  const [service, setService] = useState<WorkspaceService>(
    initialService ?? "google_drive",
  );
  const connection = connections.data?.data.find(
    (row) => row.service === service,
  );
  const active =
    connection?.selectedResource &&
    (["connected", "partial"].includes(connection.status) ||
      service === "google_search_console");
  const editable = canManage && campaign?.status !== "archived";
  return (
    <section className="space-y-7" aria-label="Espaço de trabalho integrado">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full space-y-2 sm:w-80">
          <Label htmlFor="workspace-service">Serviço de trabalho</Label>
          <select
            id="workspace-service"
            className={leadSelect}
            value={service}
            onChange={(event) =>
              setService(event.target.value as WorkspaceService)
            }
          >
            {Object.entries(workspaceServices).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <Button asChild variant="outline" className="min-h-11">
          <Link to={`/settings/integrations?tab=workspace&service=${service}`}>
            Gerenciar conexão
          </Link>
        </Button>
      </div>
      <LeadError
        error={connections.error}
        retry={() => {
          void connections.refetch();
        }}
      />
      {connections.isLoading && (
        <p role="status">Carregando serviços de trabalho…</p>
      )}
      {connection?.safeError && (
        <p className="text-sm text-status-warning">
          {workspaceError(connection.safeError)}
        </p>
      )}
      {!connections.isLoading && !connections.isError && !active && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg font-medium">
            Conecte {workspaceServices[service]}
          </h2>
          <p className="text-sm text-muted-foreground">
            Autorize a conta e escolha o recurso nas integrações. O
            consentimento sozinho ainda não conclui a conexão.
          </p>
          <Button asChild className="min-h-11">
            <Link
              to={`/settings/integrations?tab=workspace&service=${service}`}
            >
              Abrir integrações
            </Link>
          </Button>
        </div>
      )}
      {active && connection && (
        <div key={`${service}:${connection.generation}`}>
          {["google_drive", "microsoft_files"].includes(service) && (
            <WorkspaceFiles
              connection={connection}
              api={api}
              canManage={editable}
              campaign={campaign}
            />
          )}
          {["google_gmail", "microsoft_mail"].includes(service) && (
            <WorkspaceMail
              connection={connection}
              api={api}
              canManage={editable}
              campaign={campaign}
            />
          )}
          {["google_calendar", "microsoft_calendar"].includes(service) && (
            <WorkspaceCalendar
              connection={connection}
              api={api}
              canManage={editable}
              campaign={campaign}
            />
          )}
          {service === "google_sheets" && (
            <WorkspaceSheets
              connection={connection}
              api={api}
              canManage={editable}
              campaign={campaign}
            />
          )}
          {service === "google_search_console" && (
            <SearchConsoleResults
              connection={connection}
              api={api}
              canManage={editable}
            />
          )}
        </div>
      )}
      {campaign && (
        <CampaignWorkspaceLinks
          campaign={campaign}
          api={api}
          canManage={editable}
        />
      )}
    </section>
  );
}
function CampaignWorkspaceLinks({
  campaign,
  api,
  canManage,
}: {
  campaign: MarketingOpsCampaign;
  api: WorkspaceClient;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const key = useProposalKey();
  const links = useQuery({
    queryKey: workspaceKeys.links(campaign.id),
    queryFn: () => api.links(campaign.id),
    retry: false,
  });
  const [disable, setDisable] = useState<WorkspaceLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState("");
  const lock = useRef(false);
  const refresh = useRef<HTMLButtonElement>(null);
  const save = async () => {
    if (!disable || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.disableLink(
        campaign.id,
        disable,
        key({ id: disable.id, version: disable.version }),
      );
      setDisable(null);
      setOutcome("Vínculo desativado. O histórico permanece disponível.");
      await qc.invalidateQueries({
        queryKey: workspaceKeys.links(campaign.id),
      });
    } catch (issue) {
      setError(issue);
      if ((issue as { status?: number }).status === 409) {
        setDisable(null);
        await links.refetch();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      className="space-y-4 border-t border-border pt-6"
      aria-label="Vínculos de trabalho da campanha"
    >
      <header className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-medium">
          Materiais e conversas vinculados
        </h2>
        <Button
          ref={refresh}
          variant="ghost"
          className="min-h-11"
          disabled={links.isFetching}
          onClick={() => {
            void links.refetch();
          }}
        >
          Atualizar vínculos
        </Button>
      </header>
      <LeadError error={error || links.error} />
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-status-success"
      >
        {outcome}
      </p>
      {links.isLoading && <p role="status">Carregando vínculos…</p>}
      {links.data && !links.data.data.length && (
        <p className="text-sm text-muted-foreground">
          Nenhum material ou mensagem vinculado ainda. Escolha um serviço acima
          e vincule os recursos selecionados.
        </p>
      )}
      <ul className="divide-y divide-border">
        {links.data?.data.map((link) => (
          <li
            key={link.id}
            className="flex flex-wrap justify-between gap-3 py-4"
          >
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">{link.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {workspaceServices[link.service]} ·{" "}
                {link.kind === "message" ? "Mensagem" : "Arquivo"} ·{" "}
                {link.active ? "Ativo" : "Histórico"} ·{" "}
                {shortDate(link.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {link.available === false && (
                <p className="self-center text-xs text-status-warning">
                  A conexão mudou. Este vínculo permanece no histórico;
                  selecione o recurso novamente na conexão atual.
                </p>
              )}
              <WorkspaceResourceLink
                url={link.available === false ? null : link.url}
              >
                Abrir original
              </WorkspaceResourceLink>
              {canManage && link.active && (
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => {
                    setError(null);
                    setDisable(link);
                  }}
                >
                  Desativar vínculo
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {disable && (
        <WorkspaceConfirm
          title="Desativar vínculo?"
          description="Este recurso deixará de compor os vínculos ativos da campanha. O original e o histórico serão preservados."
          label="Confirmar desativação"
          busy={busy}
          error={error}
          fallback={() => refresh.current}
          onClose={() => setDisable(null)}
          onConfirm={() => {
            void save();
          }}
        />
      )}
    </section>
  );
}
