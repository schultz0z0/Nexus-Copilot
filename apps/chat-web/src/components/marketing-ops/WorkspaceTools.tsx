import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  workspaceKeys,
  parseWorkspaceMetric,
  safeWorkspaceResourceUrl,
  type WorkspaceClient,
  type WorkspaceConnection,
  type WorkspaceDraft,
  type WorkspaceMessage,
  type WorkspaceResource,
  type WorkspaceEventInput,
} from "@/lib/marketingOps/workspace";
import {
  leadClient,
  reportMetricLabels,
  type ReportMetrics,
  type ResultReportInput,
} from "@/lib/marketingOps/leads";
import { parseLeadCsv } from "@/lib/marketingOps/leadFiles";
import { marketingOpsClient } from "@/lib/marketingOps/runtime";
import type { MarketingOpsCampaign } from "@/lib/marketingOps/types";
import { LeadImportDialog } from "./LeadImportDialog";
import { CampaignReportsDialog } from "./CampaignReportsDialog";
import { LeadError } from "./LeadUi";
import { WorkspaceConfirm } from "./WorkspaceIntegrations";
import {
  leadDialog,
  leadSelect,
  shortDate,
  useCampaignActions,
  useDialogReturnFocus,
  useProposalKey,
} from "./leadUiHelpers";
interface ToolProps {
  connection: WorkspaceConnection;
  api: WorkspaceClient;
  canManage: boolean;
  campaign?: MarketingOpsCampaign;
}
export function WorkspaceResourceLink({
  url,
  children,
}: {
  url: string | null;
  children: React.ReactNode;
}) {
  return safeWorkspaceResourceUrl(url) ? (
    <a
      className="inline-flex min-h-11 items-center text-sm text-brand-accent"
      href={url!}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ) : null;
}
export function WorkspaceFiles({
  connection,
  api,
  canManage,
  campaign,
}: ToolProps) {
  const qc = useQueryClient();
  const key = useProposalKey();
  const [parentId, setParent] = useState<string>();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState<string>();
  const [attach, setAttach] = useState<WorkspaceResource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState("");
  const lock = useRef(false);
  const files = useQuery({
    queryKey: [
      "workspace",
      "files",
      connection.service,
      connection.generation,
      parentId,
      filter,
      page,
    ],
    queryFn: () =>
      api.files(connection.service, { parentId, search: filter, page }),
    retry: false,
  });
  const save = async () => {
    if (!attach || !campaign || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const input = {
        service: connection.service,
        kind: "file" as const,
        resourceId: attach.id,
      };
      await api.attach(campaign.id, input, connection.version, key(input));
      setAttach(null);
      setOutcome(
        "Arquivo vinculado à campanha. O original permanece no provedor.",
      );
      await qc.invalidateQueries({
        queryKey: workspaceKeys.links(campaign.id),
      });
    } catch (issue) {
      setError(issue);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="space-y-5" aria-label="Arquivos conectados">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-medium">
          {connection.selectedResource?.name}
        </h2>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={files.isFetching}
          onClick={() => {
            void files.refetch();
          }}
        >
          Atualizar arquivos
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter(search);
          setPage(undefined);
        }}
      >
        <Input
          aria-label="Buscar arquivos"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit" variant="outline" className="min-h-11">
          Buscar
        </Button>
      </form>
      {parentId && (
        <Button
          variant="ghost"
          className="min-h-11"
          onClick={() => {
            setParent(undefined);
            setPage(undefined);
          }}
        >
          Voltar ao recurso selecionado
        </Button>
      )}
      <LeadError
        error={error || files.error}
        retry={() => {
          void files.refetch();
        }}
      />
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-status-success"
      >
        {outcome}
      </p>
      {files.isLoading && <p role="status">Consultando materiais…</p>}
      {files.data && !files.data.data.items.length && (
        <p className="text-sm text-muted-foreground">
          Nenhum arquivo encontrado neste recorte.
        </p>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {files.data?.data.items.map((file) => (
          <li
            key={file.id}
            className="flex flex-wrap items-center justify-between gap-3 p-4"
          >
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">{file.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {file.kind === "folder" || file.kind === "site"
                  ? "Pasta ou biblioteca"
                  : "Arquivo"}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {["folder", "site"].includes(file.kind) ? (
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    setParent(file.id);
                    setPage(undefined);
                  }}
                >
                  Abrir pasta
                </Button>
              ) : (
                <>
                  <WorkspaceResourceLink url={file.url}>
                    Abrir original
                  </WorkspaceResourceLink>
                  {campaign && canManage && (
                    <Button
                      variant="outline"
                      className="min-h-11"
                      onClick={() => {
                        setError(null);
                        setAttach(file);
                      }}
                    >
                      Vincular à campanha
                    </Button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {files.data?.data.truncated && (
        <p className="text-xs text-status-warning">
          Lista limitada. Refine a busca para encontrar outros materiais.
        </p>
      )}
      {files.data?.data.nextPage && (
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => setPage(files.data!.data.nextPage!)}
        >
          Próxima página
        </Button>
      )}
      {!campaign && (
        <p className="text-xs text-muted-foreground">
          Para vincular um arquivo, abra Trabalho dentro da campanha desejada.
        </p>
      )}
      {attach && (
        <WorkspaceConfirm
          title="Vincular arquivo à campanha?"
          description={`${attach.name} será vinculado a ${campaign?.name}. O arquivo original não será copiado nem alterado.`}
          label="Confirmar vínculo"
          busy={busy}
          error={error}
          onClose={() => setAttach(null)}
          onConfirm={() => {
            void save();
          }}
        />
      )}
    </section>
  );
}
export function WorkspaceMail({
  connection,
  api,
  canManage,
  campaign,
}: ToolProps) {
  const qc = useQueryClient();
  const key = useProposalKey();
  const messages = useQuery({
    queryKey: [
      "workspace",
      "messages",
      connection.service,
      connection.generation,
    ],
    queryFn: () => api.messages(connection.service),
    retry: false,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [attach, setAttach] = useState<WorkspaceMessage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");
  const lock = useRef(false);
  const detail = useQuery({
    queryKey: ["workspace", "message", connection.service, selected],
    queryFn: () => api.message(connection.service, selected!),
    enabled: !!selected,
    retry: false,
  });
  const save = async () => {
    if (!attach || !campaign || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const input = {
        service: connection.service,
        kind: "message" as const,
        resourceId: attach.id,
      };
      await api.attach(campaign.id, input, connection.version, key(input));
      setAttach(null);
      setOutcome("Mensagem vinculada à campanha.");
      await qc.invalidateQueries({
        queryKey: workspaceKeys.links(campaign.id),
      });
    } catch (issue) {
      setError(issue);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="space-y-5" aria-label="Mensagens conectadas">
      <header className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-medium">Mensagens recentes</h2>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={messages.isFetching}
            onClick={() => {
              void messages.refetch();
            }}
          >
            Atualizar mensagens
          </Button>
          {canManage && (
            <Button className="min-h-11" onClick={() => setCompose(true)}>
              Nova mensagem
            </Button>
          )}
        </div>
      </header>
      <p className="text-xs text-muted-foreground">
        Até 20 mensagens recentes da pasta selecionada, em texto simples e sem
        anexos. Envios exigem revisão humana; esta caixa não substitui disparos
        de e-mail marketing.
      </p>
      <LeadError
        error={error || messages.error}
        retry={() => {
          void messages.refetch();
        }}
      />
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-status-success"
      >
        {outcome}
      </p>
      {messages.isLoading && <p role="status">Consultando mensagens…</p>}
      {messages.data && !messages.data.data.items.length && (
        <p className="text-sm text-muted-foreground">
          Nenhuma mensagem acessível neste recorte.
        </p>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {messages.data?.data.items.map((message) => (
          <li key={message.id}>
            <button
              className="block min-h-11 w-full space-y-2 p-5 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSelected(message.id)}
            >
              <p className="break-words text-sm font-medium">
                {message.subject || "Sem assunto"}
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {message.from} · {shortDate(message.receivedAt)}
              </p>
              <p className="line-clamp-2 break-words text-xs text-text-secondary">
                {message.snippet}
              </p>
            </button>
          </li>
        ))}
      </ul>
      {messages.data?.data.truncated && (
        <p className="text-xs text-status-warning">
          A lista contém um recorte das mensagens recentes.
        </p>
      )}
      {selected && (
        <MessageDialog
          message={detail.data?.data}
          error={detail.error}
          loading={detail.isLoading}
          onClose={() => setSelected(null)}
          onAttach={
            campaign && canManage
              ? (message) => {
                  setSelected(null);
                  setError(null);
                  setAttach(message);
                }
              : undefined
          }
        />
      )}
      {compose && (
        <MailCompose
          connection={connection}
          api={api}
          campaign={campaign}
          onClose={() => setCompose(false)}
        />
      )}
      {attach && (
        <WorkspaceConfirm
          title="Vincular mensagem à campanha?"
          description={`${attach.subject || "Sem assunto"} será vinculada a ${campaign?.name}.`}
          label="Confirmar vínculo"
          busy={busy}
          error={error}
          onClose={() => setAttach(null)}
          onConfirm={() => {
            void save();
          }}
        />
      )}
    </section>
  );
}
function MessageDialog({
  message,
  error,
  loading,
  onClose,
  onAttach,
}: {
  message?: WorkspaceMessage;
  error: unknown;
  loading: boolean;
  onClose: () => void;
  onAttach?: (message: WorkspaceMessage) => void;
}) {
  const focus = useDialogReturnFocus();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className={leadDialog} onCloseAutoFocus={focus}>
        <DialogHeader>
          <DialogTitle>
            {message?.subject || "Mensagem selecionada"}
          </DialogTitle>
          <DialogDescription>
            {message?.from ?? "Consultando mensagem no provedor."}
          </DialogDescription>
        </DialogHeader>
        <LeadError error={error} />
        {loading && <p role="status">Carregando mensagem…</p>}
        {message && (
          <>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {message.text ?? message.snippet}
            </p>
            {onAttach && (
              <Button
                className="min-h-11 self-end"
                onClick={() => onAttach(message)}
              >
                Vincular à campanha
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
function MailCompose({
  connection,
  api,
  campaign,
  onClose,
}: {
  connection: WorkspaceConnection;
  api: WorkspaceClient;
  campaign?: MarketingOpsCampaign;
  onClose: () => void;
}) {
  const focus = useDialogReturnFocus();
  const createKey = useProposalKey();
  const sendKey = useProposalKey();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [review, setReview] = useState(false);
  const [draft, setDraft] = useState<WorkspaceDraft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const input = {
      to: to
        .split(/[,;]/)
        .map((value) => value.trim())
        .filter(Boolean),
      subject: subject.trim(),
      text,
      ...(campaign ? { campaignId: campaign.id } : {}),
    };
    try {
      const result = await api.createDraft(
        connection.service,
        input,
        connection.version,
        createKey(input),
      );
      setDraft(result.data);
    } catch (issue) {
      setError(issue);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const send = async () => {
    if (!draft || lock.current || uncertain || receipt) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.sendDraft(
        connection.service,
        draft.id,
        connection.version,
        sendKey({ draftId: draft.id }),
        campaign?.id,
      );
      setReceipt(result.data.id);
      setUncertain(
        result.data.status === "uncertain" || result.data.status === "pending",
      );
      setBlocked(
        result.data.status === "blocked" || result.data.status === "failed",
      );
    } catch (issue) {
      setError(issue);
      const code = (issue as { code?: string }).code;
      if (
        ["workspace_draft_changed", "workspace_send_blocked"].includes(
          code ?? "",
        )
      )
        setBlocked(true);
      if (
        code === "workspace_operation_uncertain" ||
        !(issue as { status?: number }).status ||
        (issue as { status?: number }).status! >= 500
      )
        setUncertain(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const recipientsValid = to
    .split(/[,;]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .every((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  const recipientsCount = to
    .split(/[,;]/)
    .map((value) => value.trim())
    .filter(Boolean).length;
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
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {draft ? "Revisar envio" : "Preparar mensagem"}
          </DialogTitle>
          <DialogDescription>
            Envio por {connection.identity?.email}.{" "}
            {campaign ? `Campanha: ${campaign.name}.` : ""} Nenhuma mensagem
            será enviada sem sua confirmação.
          </DialogDescription>
        </DialogHeader>
        <LeadError error={error} />
        {receipt || uncertain || blocked ? (
          <section role="status" aria-live="polite" className="space-y-4">
            <h3
              className={`font-medium ${uncertain ? "text-status-warning" : "text-status-success"}`}
            >
              {blocked
                ? "Envio bloqueado"
                : uncertain
                  ? "Resultado do envio não confirmado"
                  : "Mensagem enviada"}
            </h3>
            {uncertain && (
              <p className="text-sm">
                Não repita o envio. Confira a pasta Enviados no provedor antes
                de preparar outra mensagem.
              </p>
            )}
            {receipt && (
              <p className="break-all font-mono text-xs">Recibo: {receipt}</p>
            )}
            {blocked && (
              <p className="text-sm text-status-warning">
                O rascunho mudou ou não pôde ser revisado. Confira o provedor e
                prepare um novo rascunho. Nenhum novo envio será tentado por
                esta tela.
              </p>
            )}
            <Button className="min-h-11" onClick={onClose}>
              Concluir
            </Button>
          </section>
        ) : review ? (
          <section className="space-y-5">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Para</dt>
                <dd className="break-all">{to}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Assunto</dt>
                <dd className="break-words">{subject}</dd>
              </div>
            </dl>
            <p className="whitespace-pre-wrap break-words rounded-lg border border-border p-4 text-sm">
              {text}
            </p>
            {draft && (
              <p className="text-xs text-muted-foreground">
                Rascunho salvo no provedor. Confirme para enviá-lo aos
                destinatários acima.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              {!draft && (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={() => setReview(false)}
                >
                  Voltar à edição
                </Button>
              )}
              <Button
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  void (draft ? send() : save());
                }}
              >
                {busy
                  ? "Aguarde…"
                  : draft
                    ? "Confirmar envio agora"
                    : "Salvar rascunho no provedor"}
              </Button>
            </div>
          </section>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (recipientsValid && to.trim()) setReview(true);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="workspace-to">Destinatários</Label>
              <Input
                id="workspace-to"
                value={to}
                maxLength={1000}
                required
                onChange={(event) => setTo(event.target.value)}
                aria-describedby="workspace-to-help"
              />
              <p
                id="workspace-to-help"
                className="text-xs text-muted-foreground"
              >
                Separe até 20 endereços por vírgula. Confira todos antes de
                enviar.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-subject">Assunto</Label>
              <Input
                id="workspace-subject"
                value={subject}
                maxLength={300}
                required
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-body">Mensagem</Label>
              <textarea
                id="workspace-body"
                className={`${leadSelect} h-auto py-3`}
                rows={8}
                value={text}
                maxLength={20000}
                required
                onChange={(event) => setText(event.target.value)}
              />
            </div>
            {to && !recipientsValid && (
              <p role="alert" className="text-sm text-status-error">
                Confira os endereços de e-mail.
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                className="min-h-11"
                disabled={
                  !to.trim() ||
                  !recipientsValid ||
                  recipientsCount > 20 ||
                  !subject.trim() ||
                  !text.trim()
                }
              >
                Revisar rascunho
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function WorkspaceCalendar({
  connection,
  api,
  canManage,
  campaign,
}: ToolProps) {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(
    new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
  );
  const [publish, setPublish] = useState(false);
  const events = useQuery({
    queryKey: [
      "workspace",
      "events",
      connection.service,
      connection.generation,
      from,
      to,
    ],
    queryFn: () => api.events(connection.service, { from, to }),
    enabled: !!from && !!to && from <= to,
    retry: false,
  });
  return (
    <section className="space-y-5" aria-label="Agenda conectada">
      <p className="text-xs text-muted-foreground">
        Até 100 compromissos por consulta, em uma janela de até 31 dias. Os
        horários são exibidos no fuso do seu navegador.
      </p>
      <header className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-medium">
          {connection.selectedResource?.name}
        </h2>
        {canManage && (
          <Button className="min-h-11" onClick={() => setPublish(true)}>
            Novo compromisso
          </Button>
        )}
      </header>
      <div className="flex flex-wrap gap-3">
        <div className="space-y-2">
          <Label htmlFor="workspace-events-from">De</Label>
          <Input
            id="workspace-events-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="workspace-events-to">Até</Label>
          <Input
            id="workspace-events-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          className="min-h-11 self-end"
          disabled={events.isFetching || from > to}
          onClick={() => {
            void events.refetch();
          }}
        >
          Atualizar agenda
        </Button>
      </div>
      <LeadError error={events.error} />
      {from > to && (
        <p role="alert" className="text-sm text-status-error">
          O término deve ser posterior ao início.
        </p>
      )}
      {events.isLoading && <p role="status">Consultando agenda…</p>}
      {events.data && !events.data.data.items.length && (
        <p className="text-sm text-muted-foreground">
          Nenhum compromisso informado neste período.
        </p>
      )}
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {events.data?.data.items.map((event) => (
          <li key={event.id} className="space-y-2 p-5">
            <h3 className="break-words text-sm font-medium">{event.title}</h3>
            <p className="text-xs text-muted-foreground">
              {new Date(event.start).toLocaleString("pt-BR")} →{" "}
              {new Date(event.end).toLocaleString("pt-BR")}
            </p>
            <WorkspaceResourceLink url={event.url}>
              Abrir compromisso
            </WorkspaceResourceLink>
          </li>
        ))}
      </ul>
      {events.data?.data.truncated && (
        <p className="text-xs text-status-warning">
          A agenda retornou um recorte limitado. Reduza o período.
        </p>
      )}
      {publish && (
        <EventDialog
          connection={connection}
          api={api}
          campaign={campaign}
          onClose={() => {
            setPublish(false);
            void events.refetch();
          }}
        />
      )}
    </section>
  );
}
function EventDialog({
  connection,
  api,
  campaign,
  onClose,
}: {
  connection: WorkspaceConnection;
  api: WorkspaceClient;
  campaign?: MarketingOpsCampaign;
  onClose: () => void;
}) {
  const focus = useDialogReturnFocus();
  const key = useProposalKey();
  const actions = useCampaignActions(
    campaign?.id ?? "",
    marketingOpsClient,
    !!campaign,
  );
  const [title, setTitle] = useState(campaign?.name ?? "");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(
    campaign?.startsOn ? `${campaign.startsOn}T09:00` : "",
  );
  const [end, setEnd] = useState("");
  const [actionId, setAction] = useState("");
  const [proposal, setProposal] = useState<WorkspaceEventInput | null>(null);
  const [receipt, setReceipt] = useState<{ status: string; id: string } | null>(
    null,
  );
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lock = useRef(false);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const review = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const a = new Date(start);
    const b = new Date(end);
    if (
      !Number.isFinite(a.getTime()) ||
      !Number.isFinite(b.getTime()) ||
      a >= b ||
      b.getTime() - a.getTime() > 31 * 86400000
    ) {
      setError(
        new Error(
          "Informe início e término válidos, em uma janela de até 31 dias.",
        ),
      );
      return;
    }
    setProposal({
      title: title.trim(),
      description,
      start: a.toISOString(),
      end: b.toISOString(),
      timeZone: zone,
      ...(campaign ? { campaignId: campaign.id } : {}),
      ...(actionId ? { actionId } : {}),
    });
  };
  const save = async () => {
    if (!proposal || lock.current || uncertain) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api.publishEvent(
        connection.service,
        proposal,
        connection.version,
        key(proposal),
      );
      setReceipt(result.data);
      setUncertain(result.data.status !== "completed");
    } catch (issue) {
      setError(issue);
      if (
        (issue as { code?: string }).code === "workspace_operation_uncertain" ||
        !(issue as { status?: number }).status ||
        (issue as { status?: number }).status! >= 500
      )
        setUncertain(true);
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
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Publicar compromisso</DialogTitle>
          <DialogDescription>
            Calendário: {connection.selectedResource?.name}. Os horários são
            apresentados no fuso {zone}. A publicação exige sua confirmação.
          </DialogDescription>
        </DialogHeader>
        <LeadError error={error} />
        {receipt || uncertain ? (
          <section className="space-y-4" role="status">
            <h3 className="font-medium">
              {uncertain
                ? "Publicação não confirmada"
                : "Compromisso publicado"}
            </h3>
            {uncertain && (
              <p className="text-sm text-status-warning">
                Confira o calendário no provedor antes de preparar outro
                compromisso. Não repita esta publicação.
              </p>
            )}
            {receipt && (
              <p className="break-all font-mono text-xs">
                Recibo: {receipt.id}
              </p>
            )}
            <Button className="min-h-11" onClick={onClose}>
              Concluir
            </Button>
          </section>
        ) : proposal ? (
          <section className="space-y-5">
            <h3 className="break-words font-medium">{proposal.title}</h3>
            <p className="text-sm">
              {new Date(proposal.start).toLocaleString("pt-BR")} →{" "}
              {new Date(proposal.end).toLocaleString("pt-BR")} · {zone}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {proposal.description}
            </p>
            {campaign && (
              <p className="text-sm">
                Campanha: {campaign.name}
                {actionId
                  ? ` · ${actions.data?.find((action) => action.id === actionId)?.title ?? "Ação vinculada"}`
                  : ""}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => setProposal(null)}
              >
                Voltar à edição
              </Button>
              <Button
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  void save();
                }}
              >
                {busy ? "Publicando…" : "Confirmar publicação"}
              </Button>
            </div>
          </section>
        ) : (
          <form className="space-y-5" onSubmit={review}>
            <div className="space-y-2">
              <Label htmlFor="workspace-event-title">
                Título do compromisso
              </Label>
              <Input
                id="workspace-event-title"
                required
                maxLength={300}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="workspace-event-start">Início</Label>
                <Input
                  id="workspace-event-start"
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace-event-end">Término</Label>
                <Input
                  id="workspace-event-end"
                  type="datetime-local"
                  required
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-event-description">Descrição</Label>
              <textarea
                id="workspace-event-description"
                rows={4}
                maxLength={10000}
                className={`${leadSelect} h-auto py-3`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {campaign && (
              <div className="space-y-2">
                <Label htmlFor="workspace-event-action">
                  Ação da campanha (opcional)
                </Label>
                <select
                  id="workspace-event-action"
                  className={leadSelect}
                  value={actionId}
                  onChange={(event) => {
                    setAction(event.target.value);
                    const action = actions.data?.find(
                      (row) => row.id === event.target.value,
                    );
                    if (action) setTitle(action.title);
                  }}
                >
                  <option value="">Sem vínculo com ação</option>
                  {actions.data?.map((action) => (
                    <option key={action.id} value={action.id}>
                      {action.title}
                    </option>
                  ))}
                </select>
                <LeadError error={actions.error} />
              </div>
            )}
            <div className="flex justify-end">
              <Button type="submit" className="min-h-11">
                Revisar compromisso
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function WorkspaceSheets({
  connection,
  api,
  canManage,
  campaign,
}: ToolProps) {
  const sheet = useQuery({
    queryKey: ["workspace", "sheet", connection.generation],
    queryFn: api.sheet,
    retry: false,
  });
  const [importing, setImporting] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [selected, setSelected] = useState(0);
  const [columns, setColumns] = useState<
    Partial<Record<keyof ReportMetrics, string>>
  >({});
  const [report, setReport] = useState<Partial<ResultReportInput> | null>(null);
  const [error, setError] = useState<unknown>(null);
  const table = sheet.data?.data;
  const prepare = () => {
    if (!table) return;
    setError(null);
    try {
      const metrics: ReportMetrics = {};
      const row = table.rows[selected];
      for (const [key, column] of Object.entries(columns)) {
        if (!column || !row[Number(column) - 1]?.trim()) continue;
        const numeric = parseWorkspaceMetric(row[Number(column) - 1]);
        if (numeric === undefined) continue;
        metrics[key as keyof ReportMetrics] = numeric;
      }
      if (!Object.keys(metrics).length)
        throw new Error("Relacione pelo menos uma métrica medida.");
      setReport({
        metrics,
        notes: `Importação revisada de ${table.name}, linha ${selected + 2}.`,
      });
      setMapping(false);
    } catch (issue) {
      setError(issue);
    }
  };
  const leadTable = () => {
    if (!table) return undefined;
    const csv = [table.headers, ...table.rows]
      .map((row) =>
        row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    return parseLeadCsv(csv);
  };
  return (
    <section className="space-y-5" aria-label="Planilha conectada">
      <header className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-medium">
          {table?.name ?? connection.selectedResource?.name}
        </h2>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={sheet.isFetching}
          onClick={() => {
            void sheet.refetch();
          }}
        >
          Atualizar planilha
        </Button>
      </header>
      <LeadError error={error || sheet.error} />
      <p className="text-sm text-muted-foreground">
        Prévia da primeira aba, limitada a 500 linhas e 52 colunas. Nenhum
        contato ou resultado é gravado automaticamente.
      </p>
      {sheet.isLoading && <p role="status">Lendo planilha…</p>}
      {table && (
        <>
          <div
            tabIndex={0}
            role="region"
            aria-label="Prévia da planilha"
            className="max-h-96 overflow-auto rounded-xl border border-border"
          >
            <table className="w-full text-left text-sm">
              <thead className="bg-card">
                <tr>
                  {table.headers.map((header, index) => (
                    <th
                      key={index}
                      className="whitespace-nowrap p-3 font-medium"
                    >
                      {header || `Coluna ${index + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {table.rows.slice(0, 20).map((row, index) => (
                  <tr key={index}>
                    {table.headers.map((_, col) => (
                      <td
                        key={col}
                        className="max-w-72 break-words p-3 text-muted-foreground"
                      >
                        {row[col]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            {table.rows.length} linhas lidas. A prévia visual mostra até 20.
          </p>
          {table.truncated && (
            <p className="text-xs text-status-warning">
              A leitura foi limitada. Revise a planilha e divida em lotes; uma
              importação parcial pode omitir contatos.
            </p>
          )}
          {campaign && canManage ? (
            <div className="flex flex-wrap gap-3">
              <Button
                className="min-h-11"
                disabled={table.truncated || !table.rows.length}
                onClick={() => {
                  try {
                    leadTable();
                    setImporting(true);
                  } catch (issue) {
                    setError(issue);
                  }
                }}
              >
                Mapear e revisar contatos
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={!table.rows.length}
                onClick={() => setMapping(true)}
              >
                Mapear resultado semanal
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Abra Trabalho em uma campanha para importar contatos ou resultados
              com revisão.
            </p>
          )}
        </>
      )}
      {importing && campaign && (
        <LeadImportDialog
          campaignId={campaign.id}
          api={leadClient}
          initialTable={leadTable()}
          onClose={() => setImporting(false)}
        />
      )}
      {mapping && table && (
        <SheetReportMapping
          table={table}
          selected={selected}
          columns={columns}
          error={error}
          onSelect={setSelected}
          onColumns={setColumns}
          onClose={() => setMapping(false)}
          onConfirm={prepare}
        />
      )}
      {report && campaign && (
        <CampaignReportsDialog
          campaignId={campaign.id}
          api={leadClient}
          ops={marketingOpsClient}
          readOnly={!canManage}
          initialReport={report}
          onClose={() => setReport(null)}
        />
      )}
    </section>
  );
}
function SheetReportMapping({
  table,
  selected,
  columns,
  error,
  onSelect,
  onColumns,
  onClose,
  onConfirm,
}: {
  table: { headers: string[]; rows: string[][] };
  selected: number;
  columns: Partial<Record<keyof ReportMetrics, string>>;
  error: unknown;
  onSelect: (value: number) => void;
  onColumns: (value: Partial<Record<keyof ReportMetrics, string>>) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const focus = useDialogReturnFocus();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className={leadDialog} onCloseAutoFocus={focus}>
        <DialogHeader>
          <DialogTitle>Mapear resultado semanal</DialogTitle>
          <DialogDescription>
            Escolha uma única linha de valores agregados. Depois, revise a
            fonte, o período e os números no formulário de relatório. Os valores
            usam formato brasileiro: 1.234,56. Em branco significa não medido.
          </DialogDescription>
        </DialogHeader>
        <LeadError error={error} />
        <div className="space-y-2">
          <Label htmlFor="sheet-result-row">Linha da planilha</Label>
          <select
            id="sheet-result-row"
            className={leadSelect}
            value={selected}
            onChange={(event) => onSelect(Number(event.target.value))}
          >
            {table.rows.map((row, index) => (
              <option key={index} value={index}>
                Linha {index + 2} · {row.slice(0, 3).join(" · ").slice(0, 140)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(reportMetricLabels).map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`sheet-metric-${key}`}>{label}</Label>
              <select
                id={`sheet-metric-${key}`}
                className={leadSelect}
                value={columns[key as keyof ReportMetrics] ?? ""}
                onChange={(event) =>
                  onColumns({ ...columns, [key]: event.target.value })
                }
              >
                <option value="">Não medido</option>
                {table.headers.map((header, index) => (
                  <option key={index} value={index + 1}>
                    {header} · {table.rows[selected]?.[index] ?? ""}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button className="min-h-11" onClick={onConfirm}>
            Continuar para revisão do relatório
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
