import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  FolderOpen,
  Mail,
  CalendarDays,
  Search,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  workspaceClient,
  workspaceKeys,
  workspaceServices,
  workspaceError,
  safeWorkspaceAuthorizationUrl,
  type WorkspaceClient,
  type WorkspaceConnection,
  type WorkspaceService,
  type WorkspaceApp,
  type WorkspaceFamily,
} from "@/lib/marketingOps/workspace";
import { LeadError } from "./LeadUi";
import {
  leadDialog,
  useDialogReturnFocus,
  useProposalKey,
} from "./leadUiHelpers";
const groups = {
  files: {
    label: "Arquivos",
    icon: FolderOpen,
    services: ["google_drive", "microsoft_files", "google_sheets"],
  },
  mail: {
    label: "E-mail",
    icon: Mail,
    services: ["google_gmail", "microsoft_mail"],
  },
  calendar: {
    label: "Agenda",
    icon: CalendarDays,
    services: ["google_calendar", "microsoft_calendar"],
  },
  organic: {
    label: "Busca orgânica",
    icon: Search,
    services: ["google_search_console"],
  },
} as const;
const statusLabels: Record<string, string> = {
  unprepared: "Aguardando configuração",
  prepared: "Pronto para conectar",
  pending_resource: "Escolha um recurso",
  connected: "Conectado",
  partial: "Conectado com restrições",
  reconnect_required: "Autorize novamente",
  disconnected: "Desconectado",
  error: "Conexão indisponível",
};
const descriptions: Record<WorkspaceService, string> = {
  google_drive: "Briefings e materiais ligados às campanhas.",
  microsoft_files: "Materiais do OneDrive e bibliotecas do SharePoint.",
  google_sheets: "Importação de contatos e resultados com revisão.",
  google_gmail: "Conversas selecionadas, rascunhos e envios revisados.",
  microsoft_mail: "Conversas selecionadas, rascunhos e envios revisados.",
  google_calendar: "Consultar agenda e publicar compromissos após revisão.",
  microsoft_calendar: "Consultar agenda e publicar compromissos após revisão.",
  google_search_console:
    "Consultas e páginas que trazem visitas pela busca Google.",
};
export function WorkspaceIntegrations({
  canManage,
  canConfigure,
  api = workspaceClient,
  redirect = (url: string) => window.location.assign(url),
}: {
  canManage: boolean;
  canConfigure: boolean;
  api?: WorkspaceClient;
  redirect?: (url: string) => void;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: workspaceKeys.connections,
    queryFn: api.connections,
    retry: false,
  });
  const apps = useQuery({
    queryKey: workspaceKeys.apps,
    queryFn: api.apps,
    enabled: canConfigure,
    retry: false,
  });
  const [params, setParams] = useSearchParams();
  const callbackService = params.get("service");
  const initialGroup =
    Object.entries(groups).find(([, group]) =>
      (group.services as readonly string[]).includes(callbackService ?? ""),
    )?.[0] ?? "files";
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const key = useProposalKey();
  const refresh = useRef<HTMLButtonElement>(null);
  const [select, setSelect] = useState<WorkspaceConnection | null>(null);
  const [confirm, setConfirm] = useState<{
    connection: WorkspaceConnection;
    action: "disconnect" | "authorize";
  } | null>(null);
  const [setup, setSetup] = useState<WorkspaceApp | null>(null);
  useEffect(() => {
    const result = params.get("result");
    if (!result) return;
    const knownService = callbackService && Object.prototype.hasOwnProperty.call(workspaceServices, callbackService);
    const copy: Record<string, string> = {
      connected:
        "Autorização recebida. Escolha um recurso para concluir a conexão.",
      cancelled: "Autorização cancelada. Você pode conectar novamente.",
      invalid: "A autorização expirou. Inicie uma nova conexão.",
      permission_required:
        "Confira as permissões e APIs do serviço antes de conectar novamente.",
      api_disabled: "Habilite a API deste serviço no projeto Google da empresa e conecte novamente.",
      rate_limited: "O provedor limitou as consultas. Aguarde antes de tentar novamente.",
      unavailable: "O provedor não concluiu a autorização. Tente novamente.",
      session_required: "Entre novamente e inicie a conexão.",
    };
    setOutcome(
      copy[result === 'connected' && !knownService ? 'invalid' : result] ?? "Atualize as conexões para conferir o resultado.",
    );
    void qc.invalidateQueries({ queryKey: workspaceKeys.connections });
    const next = new URLSearchParams(params);
    next.delete("result");
    setParams(next, { replace: true });
  }, [callbackService, params, qc, setParams]);
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: workspaceKeys.all });
  const act = async (
    connection: WorkspaceConnection,
    action: "authorize" | "disconnect",
    replacement = false,
  ) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (action === "authorize") {
        const response = await api.authorize(
          connection.service,
          connection.version,
          key({
            service: connection.service,
            action,
            version: connection.version,
            replacement,
          }),
          replacement,
        );
        if (
          !safeWorkspaceAuthorizationUrl(connection.service, response.data.url)
        )
          throw new Error(
            "O endereço de autorização não é válido. Peça ao administrador para revisar o aplicativo.",
          );
        redirect(response.data.url);
      } else {
        await api.disconnect(
          connection.service,
          connection.version,
          key({
            service: connection.service,
            action,
            version: connection.version,
          }),
        );
        setOutcome(
          "Conexão encerrada. Vínculos e histórico foram preservados.",
        );
      }
      setConfirm(null);
      await invalidate();
    } catch (issue) {
      setError(issue);
      if ((issue as { status?: number }).status === 409) {
        setConfirm(null);
        await invalidate();
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="space-y-6" aria-label="Integrações de trabalho">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Trabalho de marketing</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Conecte cada serviço e escolha onde sua equipe trabalha.
          </p>
        </div>
        <Button
          ref={refresh}
          variant="outline"
          className="min-h-11"
          disabled={busy || query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Atualizar conexões de trabalho
        </Button>
      </header>
      <LeadError
        error={error || query.error}
        retry={() => {
          setError(null);
          void query.refetch();
        }}
      />
      <p
        role="status"
        aria-live="polite"
        className={outcome ? "text-sm text-text-secondary" : "sr-only"}
      >
        {outcome}
      </p>
      {query.isLoading && <p role="status">Carregando serviços…</p>}
      <Tabs defaultValue={initialGroup}>
        <div className="max-w-full overflow-x-auto">
          <TabsList className="h-12">
            {Object.entries(groups).map(([id, group]) => (
              <TabsTrigger key={id} value={id} className="min-h-11">
                <group.icon aria-hidden="true" className="mr-2 h-4 w-4" />
                {group.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {Object.entries(groups).map(([id, group]) => (
          <TabsContent value={id} key={id} className="mt-5">
            <div className="divide-y divide-border rounded-xl border border-border bg-card">
              {query.data?.data
                .filter((row) =>
                  (group.services as readonly string[]).includes(row.service),
                )
                .map((connection) => (
                  <article
                    key={connection.service}
                    className="space-y-4 p-5 sm:p-6"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-medium">
                        {workspaceServices[connection.service]}
                      </h3>
                      <span
                        className={`text-xs ${connection.status === "connected" && connection.selectedResource ? "text-status-success" : "text-muted-foreground"}`}
                      >
                        {connection.status === "connected" &&
                        !connection.selectedResource
                          ? "Escolha um recurso"
                          : (statusLabels[connection.status] ??
                            "Atualize a conexão")}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {descriptions[connection.service]}
                    </p>
                    {connection.identity && (
                      <p className="break-all text-sm">
                        {connection.identity.email}
                      </p>
                    )}
                    {connection.selectedResource && (
                      <p className="break-words text-sm text-text-secondary">
                        Recurso: {connection.selectedResource.name}
                      </p>
                    )}
                    {connection.safeError && (
                      <p className="text-sm text-status-warning">
                        {workspaceError(connection.safeError)}
                      </p>
                    )}
                    {canManage && (
                      <div className="flex flex-wrap gap-3">
                        {connection.configured && (
                          <Button
                            variant={
                              connection.identity ? "outline" : "default"
                            }
                            className="min-h-11"
                            disabled={busy}
                            onClick={() => {
                              if (connection.identity) {
                                setError(null);
                                setConfirm({ connection, action: "authorize" });
                              } else void act(connection, "authorize");
                            }}
                          >
                            {connection.identity
                              ? `Trocar conta ${workspaceServices[connection.service]}`
                              : `Conectar ${workspaceServices[connection.service]}`}
                          </Button>
                        )}
                        {connection.identity && (
                          <>
                            <Button
                              variant="outline"
                              className="min-h-11"
                              disabled={busy}
                              onClick={() => {
                                setError(null);
                                setSelect(connection);
                              }}
                            >
                              {connection.selectedResource
                                ? "Trocar recurso"
                                : `Escolher recurso ${workspaceServices[connection.service]}`}
                            </Button>
                            <Button
                              variant="ghost"
                              className="min-h-11"
                              disabled={busy}
                              onClick={() => {
                                setError(null);
                                setConfirm({
                                  connection,
                                  action: "disconnect",
                                });
                              }}
                            >
                              Desconectar{" "}
                              {workspaceServices[connection.service]}
                            </Button>
                          </>
                        )}
                        {connection.status === "pending_resource" &&
                          !connection.identity && (
                            <Button
                              variant="outline"
                              className="min-h-11"
                              onClick={() => setSelect(connection)}
                            >
                              Escolher recurso{" "}
                              {workspaceServices[connection.service]}
                            </Button>
                          )}
                      </div>
                    )}
                    {!connection.configured && (
                      <p className="text-sm text-muted-foreground">
                        Um administrador precisa preparar o aplicativo{" "}
                        {connection.service.startsWith("google_")
                          ? "Google"
                          : "Microsoft"}{" "}
                        abaixo.
                      </p>
                    )}
                    {connection.selectedResource && (
                      <Button asChild variant="link" className="min-h-11 px-0">
                        <Link
                          to={`/marketing-ops/workspace?service=${connection.service}`}
                        >
                          Abrir {workspaceServices[connection.service]}
                        </Link>
                      </Button>
                    )}
                  </article>
                ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
      {canConfigure && (
        <details className="border-t border-border pt-5">
          <summary className="min-h-11 cursor-pointer py-3 text-sm text-brand-accent">
            Configuração dos aplicativos Google e Microsoft
          </summary>
          <LeadError
            error={apps.error}
            retry={() => {
              void apps.refetch();
            }}
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {(["google", "microsoft"] as WorkspaceFamily[]).map((family) => {
              const app = apps.data?.data.find((row) => row.family === family);
              return (
                <div
                  key={family}
                  className="space-y-3 rounded-xl border border-border bg-card p-5"
                >
                  <h3 className="font-medium">
                    {family === "google" ? "Google Workspace" : "Microsoft 365"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {app?.configured
                      ? "Aplicativo preparado. Cada serviço pede sua própria autorização."
                      : "Prepare uma vez; os usuários autorizam pelo app."}
                  </p>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={!app || busy}
                    onClick={() => {
                      if (app) setSetup(app);
                    }}
                  >
                    {app?.configured
                      ? "Editar / trocar aplicativo"
                      : "Configurar aplicativo"}
                  </Button>
                </div>
              );
            })}
          </div>
        </details>
      )}
      {select && (
        <WorkspaceResourceDialog
          connection={select}
          api={api}
          fallback={() => refresh.current}
          onClose={() => setSelect(null)}
          onSuccess={() => {
            setSelect(null);
            setOutcome("Recurso selecionado. A conexão foi validada.");
            void invalidate();
          }}
        />
      )}
      {confirm && (
        <WorkspaceConfirm
          title={
            confirm.action === "disconnect"
              ? "Desconectar serviço?"
              : "Trocar conta autorizada?"
          }
          description="A autorização e os trabalhos pendentes deste serviço serão invalidados. Os vínculos e o histórico ficam preservados; outros serviços continuam independentes."
          label={
            confirm.action === "disconnect"
              ? "Confirmar desconexão"
              : "Confirmar nova autorização"
          }
          busy={busy}
          error={error}
          fallback={() => refresh.current}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
          onConfirm={() => {
            void act(confirm.connection, confirm.action, true);
          }}
        />
      )}
      {setup && (
        <WorkspaceAppDialog
          app={setup}
          api={api}
          onClose={() => setSetup(null)}
          onSuccess={() => {
            setSetup(null);
            setOutcome("Aplicativo preparado. Conecte os serviços desejados.");
            void invalidate();
          }}
        />
      )}
    </section>
  );
}
export function WorkspaceConfirm({
  title,
  description,
  label,
  busy,
  error,
  onClose,
  onConfirm,
  fallback,
}: {
  title: string;
  description: string;
  label: string;
  busy: boolean;
  error?: unknown;
  onClose: () => void;
  onConfirm: () => void;
  fallback?: () => HTMLElement | null;
}) {
  const focus = useDialogReturnFocus(fallback);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className={`${leadDialog} sm:max-w-lg`}
        onCloseAutoFocus={focus}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <LeadError error={error} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button className="min-h-11" disabled={busy} onClick={onConfirm}>
            {busy ? "Aguarde…" : label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function WorkspaceResourceDialog({
  connection,
  api,
  onClose,
  onSuccess,
  fallback,
}: {
  connection: WorkspaceConnection;
  api: WorkspaceClient;
  onClose: () => void;
  onSuccess: () => void;
  fallback?: () => HTMLElement | null;
}) {
  const focus = useDialogReturnFocus(fallback);
  const proposal = useProposalKey();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [parentId, setParent] = useState<string>();
  const [page, setPage] = useState<string>();
  const [resourceId, setResource] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const resources = useQuery({
    queryKey: [
      "workspace",
      "resources",
      connection.service,
      parentId,
      filter,
      page,
    ],
    queryFn: () =>
      api.resources(connection.service, { parentId, search: filter, page }),
    retry: false,
  });
  const selectable = (resource: { kind: string; writable?: boolean }) =>
    ["google_drive", "microsoft_files"].includes(connection.service)
      ? ["folder", "site"].includes(resource.kind)
      : connection.service === "google_sheets"
        ? resource.kind === "spreadsheet"
        : connection.service.endsWith("_calendar")
          ? resource.kind === "calendar" && resource.writable !== false
          : true;
  const replacement =
    !!connection.selectedResource &&
    resourceId !== connection.selectedResource.id;
  const save = async () => {
    if (lock.current || !resourceId || (replacement && !confirmed)) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.selectResource(
        connection.service,
        resourceId,
        connection.version,
        proposal({ resourceId, version: connection.version, replacement }),
        replacement,
      );
      onSuccess();
    } catch (issue) {
      setError(issue);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className={leadDialog}
        onCloseAutoFocus={focus}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Escolher recurso · {workspaceServices[connection.service]}
          </DialogTitle>
          <DialogDescription>
            Selecione um recurso acessível à conta autorizada. Nenhum arquivo ou
            mensagem será alterado.
          </DialogDescription>
        </DialogHeader>
        <LeadError
          error={error || resources.error}
          retry={() => {
            void resources.refetch();
          }}
        />
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setFilter(search);
            setPage(undefined);
            setResource("");
          }}
        >
          <Input
            aria-label="Buscar recurso"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="outline" type="submit" className="min-h-11">
            Buscar
          </Button>
        </form>
        {parentId && (
          <Button
            variant="ghost"
            className="min-h-11 self-start"
            onClick={() => {
              setParent(undefined);
              setPage(undefined);
              setResource("");
            }}
          >
            Voltar à raiz
          </Button>
        )}
        {resources.isLoading && <p role="status">Consultando recursos…</p>}
        <fieldset
          disabled={busy}
          className="max-h-[40dvh] space-y-3 overflow-y-auto"
        >
          {resources.data?.data.items.map((resource) => (
            <div
              key={resource.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
            >
              <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  disabled={!selectable(resource)}
                  type="radio"
                  name="workspace-resource"
                  aria-label={`Selecionar ${resource.name}`}
                  checked={resourceId === resource.id}
                  onChange={() => {
                    setResource(resource.id);
                    setConfirmed(false);
                  }}
                />
                <span className="break-words text-sm">
                  {resource.name}
                  {!selectable(resource) ? " · indisponível para seleção" : ""}
                </span>
              </label>
              {["folder", "site"].includes(resource.kind) &&
                connection.service !== "google_search_console" && (
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    onClick={() => {
                      setParent(resource.id);
                      setPage(undefined);
                      setResource("");
                    }}
                  >
                    Abrir pasta
                  </Button>
                )}
            </div>
          ))}
        </fieldset>
        {resources.data && !resources.data.data.items.length && (
          <p className="text-sm text-muted-foreground">
            Nenhum recurso acessível neste recorte. Revise o acesso no provedor
            ou volte à raiz.
          </p>
        )}
        {resources.data?.data.truncated && (
          <p className="text-xs text-status-warning">
            A lista foi limitada. Refine a busca ou navegue pelas pastas.
          </p>
        )}
        {resources.data?.data.nextPage && (
          <Button
            variant="outline"
            className="min-h-11 self-start"
            onClick={() => {
              setPage(resources.data!.data.nextPage!);
              setResource("");
            }}
          >
            Próxima página
          </Button>
        )}
        {replacement && (
          <label className="flex items-start gap-3 rounded-lg border border-border p-4 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Confirmo trocar o recurso. Trabalhos pendentes serão invalidados e o
            histórico será preservado.
          </label>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            className="min-h-11"
            disabled={busy || !resourceId || (replacement && !confirmed)}
            onClick={() => {
              void save();
            }}
          >
            {busy ? "Validando…" : "Confirmar recurso"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function WorkspaceAppDialog({
  app: initialApp,
  api,
  onClose,
  onSuccess,
}: {
  app: WorkspaceApp;
  api: WorkspaceClient;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [app, setApp] = useState(initialApp);
  const focus = useDialogReturnFocus();
  const proposal = useProposalKey();
  const [clientId, setClientId] = useState(app.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [tenantId, setTenant] = useState(app.tenantId ?? "");
  const [review, setReview] = useState(false);
  const [replacement, setReplacement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lock = useRef(false);
  const google = app.family === "google";
  const save = async () => {
    if (lock.current || (app.configured && !replacement)) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const input = {
      clientId: clientId.trim(),
      ...(secret ? { clientSecret: secret } : {}),
      ...(!google ? { tenantId: tenantId.trim() } : {}),
      ...(app.configured ? { confirmReplacement: true } : {}),
    };
    try {
      await api.saveApp(app.family, input, app.version, proposal(input));
      setSecret("");
      onSuccess();
    } catch (issue) {
      setError(issue);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className={`${leadDialog} sm:max-w-2xl`}
        onCloseAutoFocus={focus}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Aplicativo {google ? "Google Workspace" : "Microsoft 365"}
          </DialogTitle>
          <DialogDescription>
            Preparo feito pelo administrador desta instalação. Depois, os
            usuários só autorizam a conta e escolhem seus recursos.
          </DialogDescription>
        </DialogHeader>
        <LeadError error={error} />
        {!app.redirectUri && (
          <p className="text-sm text-status-warning">
            O responsável pela instalação precisa configurar a origem pública e
            o armazenamento privado do servidor antes de continuar.
          </p>
        )}
        {(error as { code?: string })?.code === "version_conflict" && (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const latest = await api.apps();
                const current = latest.data.find(
                  (row) => row.family === app.family,
                );
                if (!current)
                  throw new Error(
                    "Não foi possível carregar a configuração atual.",
                  );
                setApp(current);
                setReview(false);
                setReplacement(false);
                setError(null);
                proposal.reset();
              } catch (issue) {
                setError(issue);
              } finally {
                setBusy(false);
              }
            }}
          >
            Carregar versão atual e revisar meus campos
          </Button>
        )}
        {!review ? (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              setReview(true);
            }}
          >
            <details
              className="rounded-lg border border-border p-4 text-sm"
              open={!app.configured}
            >
              <summary className="min-h-11 cursor-pointer text-brand-accent">
                Onde encontrar as credenciais e permissões
              </summary>
              <ol className="mt-3 list-decimal space-y-3 pl-5 text-muted-foreground">
                {google ? (
                  <>
                    <li>
                      No projeto Google Cloud da empresa, habilite Google Drive
                      API, Gmail API, Google Calendar API, Google Sheets API e
                      Google Search Console API.
                    </li>
                    <li>
                      Prepare a tela de consentimento e um cliente OAuth do tipo
                      Aplicativo da Web. Os serviços pedem permissões
                      separadamente; o Gmail solicita leitura e composição de
                      mensagens.
                    </li>
                    <li>
                      Cadastre exatamente a URI de retorno abaixo. Você pode
                      reutilizar as credenciais Google da instalação, se já
                      preparadas.
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      No Microsoft Entra da empresa, registre um aplicativo de
                      tenant único e copie Application (client) ID e Directory
                      (tenant) ID.
                    </li>
                    <li>
                      Adicione as permissões delegadas Microsoft Graph
                      User.Read, Files.Read.All, Sites.Read.All, Mail.ReadWrite,
                      Mail.Send e Calendars.ReadWrite, concedendo consentimento
                      administrativo quando necessário.
                    </li>
                    <li>
                      Crie um segredo de cliente, copie o valor e cadastre a URI
                      abaixo como plataforma Web. O servidor usa Microsoft Graph
                      REST.
                    </li>
                  </>
                )}
              </ol>
              <a
                className="mt-3 inline-flex min-h-11 items-center text-brand-accent"
                target="_blank"
                rel="noopener noreferrer"
                href={
                  google
                    ? "https://console.cloud.google.com/apis/credentials"
                    : "https://entra.microsoft.com/"
                }
              >
                Abrir {google ? "Google Cloud" : "Microsoft Entra"}
              </a>
            </details>
            <div className="space-y-2">
              <Label htmlFor="workspace-callback">URI de retorno</Label>
              <Input
                id="workspace-callback"
                readOnly
                value={app.redirectUri ?? "Não disponível"}
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={!app.redirectUri}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(app.redirectUri!)
                    .catch(() =>
                      setError(
                        new Error(
                          "Não foi possível copiar. Selecione e copie o endereço acima.",
                        ),
                      ),
                    );
                }}
              >
                Copiar URI de retorno
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-client">ID do aplicativo</Label>
              <Input
                id="workspace-client"
                required
                maxLength={500}
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              />
            </div>
            {!google && (
              <div className="space-y-2">
                <Label htmlFor="workspace-tenant">ID do tenant Microsoft</Label>
                <Input
                  id="workspace-tenant"
                  required
                  value={tenantId}
                  onChange={(event) => setTenant(event.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="workspace-secret">Segredo do aplicativo</Label>
              <Input
                id="workspace-secret"
                type="password"
                autoComplete="off"
                required={!app.hasSecret || clientId.trim() !== app.clientId}
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {app.hasSecret
                  ? "Em branco conserva o segredo armazenado. Ele nunca é devolvido pelo servidor."
                  : "Use o valor do segredo, não seu identificador. Ele será cifrado no servidor."}
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                className="min-h-11"
                type="submit"
                disabled={!app.redirectUri}
              >
                Revisar configuração
              </Button>
            </div>
          </form>
        ) : (
          <section className="space-y-5">
            <h3 className="font-medium">Confira antes de salvar</h3>
            <p className="break-all text-sm">ID: {clientId}</p>
            {!google && <p className="break-all text-sm">Tenant: {tenantId}</p>}
            <p className="text-sm">
              Segredo:{" "}
              {secret ? "Novo valor informado" : "Valor existente preservado"}
            </p>
            {app.configured && (
              <label className="flex items-start gap-3 rounded-lg border border-border p-4 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={replacement}
                  onChange={(event) => setReplacement(event.target.checked)}
                />
                Confirmo trocar o aplicativo. Autorizações e trabalhos pendentes
                de todos os serviços desta família serão invalidados; histórico
                e outras integrações serão preservados.
              </label>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => setReview(false)}
              >
                Voltar à edição
              </Button>
              <Button
                className="min-h-11"
                disabled={busy || (app.configured && !replacement)}
                onClick={() => {
                  void save();
                }}
              >
                {busy ? "Salvando…" : "Salvar aplicativo"}
              </Button>
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
