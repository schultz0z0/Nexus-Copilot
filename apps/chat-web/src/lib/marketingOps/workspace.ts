import { MarketingOpsApiError } from "./client";
export const workspaceServices = {
  google_drive: "Google Drive",
  microsoft_files: "OneDrive e SharePoint",
  google_gmail: "Gmail",
  microsoft_mail: "Outlook",
  google_calendar: "Google Calendar",
  microsoft_calendar: "Calendário Outlook",
  google_sheets: "Google Sheets",
  google_search_console: "Google Search Console",
} as const;
export type WorkspaceService = keyof typeof workspaceServices;
export type WorkspaceFamily = "google" | "microsoft";
export interface WorkspaceResource {
  id: string;
  name: string;
  kind: "folder" | "file" | "spreadsheet" | "calendar" | "mailbox" | "site";
  url: string | null;
  mimeType?: string;
  writable?: boolean;
}
export interface WorkspacePage<T> {
  items: T[];
  nextPage: string | null;
  truncated: boolean;
}
export interface WorkspaceConnection {
  service: WorkspaceService;
  status: string;
  version: number;
  generation: number;
  configured: boolean;
  identity: { id: string; email: string; name: string } | null;
  selectedResource: WorkspaceResource | null;
  resources: WorkspaceResource[];
  safeError: string | null;
  lastSyncAt: string | null;
}
export interface WorkspaceApp {
  family: WorkspaceFamily;
  configured: boolean;
  version: number;
  clientId: string | null;
  tenantId: string | null;
  redirectUri: string | null;
  hasSecret: boolean;
  source: string;
}
export interface WorkspaceMessage {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
  text?: string;
}
export interface WorkspaceDraft {
  id: string;
  subject: string;
  to: string[];
  text: string;
}
export interface WorkspaceReceipt {
  id: string;
  status: "completed" | "pending" | "uncertain" | "blocked" | "failed";
  result?: unknown;
}
export interface WorkspaceEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  url: string | null;
}
export interface WorkspaceEventInput {
  title: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
  campaignId?: string;
  actionId?: string;
}
export interface WorkspaceSheet {
  name: string;
  headers: string[];
  rows: string[][];
  truncated: boolean;
}
export interface WorkspaceLink {
  id: string;
  service: WorkspaceService;
  kind: string;
  resourceId: string;
  name: string;
  url: string | null;
  active: boolean;
  available?: boolean;
  version: number;
  createdAt: string;
}
export interface SearchConsoleReport {
  from: string;
  to: string;
  totals: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  } | null;
  daily: { date: string; clicks: number; impressions: number }[];
  pages: {
    page: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }[];
  queries: {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }[];
  truncated: boolean;
  stale?: boolean;
  lastSyncAt?: string;
}
export const workspaceKeys = {
  all: ["workspace"] as const,
  apps: ["workspace", "apps"] as const,
  connections: ["workspace", "connections"] as const,
  links: (id: string) => ["workspace", "links", id] as const,
};
const messages: Record<string, string> = {
  workspace_unprepared:
    "Um administrador precisa preparar o aplicativo da empresa.",
  integration_unprepared:
    "Um administrador precisa preparar o aplicativo da empresa.",
  workspace_permission_required:
    "Sua conta não tem acesso a este recurso. Confira as permissões no provedor ou renove a autorização.",
  workspace_api_disabled:
    "Habilite a API deste serviço no projeto Google da empresa e autorize novamente.",
  workspace_resource_required:
    "Escolha um recurso nas integrações para continuar.",
  workspace_not_connected: "Conecte este serviço nas integrações.",
  workspace_reconnect_required:
    "A autorização expirou ou foi revogada. Conecte novamente.",
  workspace_resource_unavailable:
    "Este recurso não está acessível. Atualize a lista ou escolha outro.",
  workspace_provider_unavailable:
    "O provedor não respondeu. Os dados anteriores foram preservados.",
  workspace_invalid_response:
    "Não foi possível validar os dados do provedor. Os dados anteriores foram preservados.",
  workspace_rate_limited:
    "O provedor limitou as consultas. Aguarde antes de tentar novamente.",
  workspace_connection_changed:
    "A conexão mudou. Atualize e revise antes de confirmar.",
  workspace_operation_uncertain:
    "O provedor pode ter concluído a operação. Confira no provedor antes de preparar outra; não repita o envio.",
  workspace_confirmation_required:
    "Revise e confirme explicitamente esta operação.",
  version_conflict:
    "Os dados mudaram. Atualize e revise antes de confirmar novamente.",
  idempotency_conflict:
    "Esta proposta mudou. Revise antes de confirmar novamente.",
  forbidden: "Seu usuário não pode realizar esta ação.",
  unauthorized: "Sua sessão expirou. Entre novamente.",
  validation_error: "Confira os campos informados.",
  feature_disabled: "Esta operação está desabilitada na instalação.",
};
export function workspaceError(code: string) {
  if (["workspace_draft_changed", "workspace_send_blocked"].includes(code))
    return "O rascunho mudou ou não pôde ser revisado. Confira o provedor e prepare um novo rascunho.";
  return (
    messages[code] ??
    "Não foi possível concluir a operação. Atualize a conexão e tente novamente."
  );
}
export function parseWorkspaceMetric(value: string): number | undefined {
  const input = value.trim().replace(/^R\$\s*/, "");
  if (!input) return undefined;
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(input))
    throw new Error(
      "Confira os números da planilha. Use formato brasileiro: 1.234,56, sem valores negativos.",
    );
  const result = Number(input.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(result) || result > Number.MAX_SAFE_INTEGER)
    throw new Error("O número está fora do limite seguro.");
  return result;
}
export function safeWorkspaceAuthorizationUrl(
  service: WorkspaceService,
  value: string,
) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (service.startsWith("google_")
        ? url.hostname === "accounts.google.com" &&
          url.pathname.startsWith("/o/oauth2/")
        : url.hostname === "login.microsoftonline.com" &&
          /\/oauth2\/v2\.0\/authorize$/.test(url.pathname))
    );
  } catch {
    return false;
  }
}
export function safeWorkspaceResourceUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ([
        "drive.google.com",
        "docs.google.com",
        "mail.google.com",
        "calendar.google.com",
        "search.google.com",
        "outlook.office.com",
        "outlook.office365.com",
        "onedrive.live.com",
      ].includes(url.hostname) ||
        /^[a-z0-9-]+\.sharepoint\.com$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}
export function createWorkspaceClient(
  options: { fetch?: typeof globalThis.fetch; baseUrl?: string } = {},
) {
  const base = (options.baseUrl ?? "/api/marketing").replace(/\/$/, "");
  const request = async <T>(
    path: string,
    method = "GET",
    body?: unknown,
    version?: number,
    key?: string,
  ): Promise<{ data: T }> => {
    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (version !== undefined) headers.set("If-Match", `"${version}"`);
    if (key) headers.set("Idempotency-Key", key);
    const response = await (options.fetch ?? globalThis.fetch)(base + path, {
      method,
      headers,
      credentials: "same-origin",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new MarketingOpsApiError(
        payload.error?.code ?? "request_failed",
        response.status,
        workspaceError(payload.error?.code),
        response.headers.get("x-correlation-id") ??
          payload.error?.correlationId ??
          null,
      );
    return payload;
  };
  const route = (service: WorkspaceService) => `/workspace/${service}`;
  const query = (input: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    Object.entries(input).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  };
  return {
    apps: () => request<WorkspaceApp[]>("/workspace/apps"),
    saveApp: (
      family: WorkspaceFamily,
      input: {
        clientId: string;
        clientSecret?: string;
        tenantId?: string;
        confirmReplacement?: boolean;
      },
      version: number,
      key: string,
    ) =>
      request<WorkspaceApp>(
        `/workspace/apps/${family}`,
        "POST",
        input,
        version,
        key,
      ),
    connections: () => request<WorkspaceConnection[]>("/workspace/connections"),
    authorize: (
      service: WorkspaceService,
      version: number,
      key: string,
      confirmReplacement = false,
    ) =>
      request<{ url: string }>(
        `${route(service)}/authorize`,
        "POST",
        { ...(confirmReplacement ? { confirmReplacement: true } : {}) },
        version,
        key,
      ),
    resources: (
      service: WorkspaceService,
      options: { parentId?: string; search?: string; page?: string } = {},
    ) =>
      request<WorkspacePage<WorkspaceResource>>(
        `${route(service)}/resources?${query(options)}`,
      ),
    selectResource: (
      service: WorkspaceService,
      resourceId: string,
      version: number,
      key: string,
      confirmReplacement = false,
    ) =>
      request<WorkspaceConnection>(
        `${route(service)}/resource`,
        "POST",
        {
          resourceId,
          ...(confirmReplacement ? { confirmReplacement: true } : {}),
        },
        version,
        key,
      ),
    disconnect: (service: WorkspaceService, version: number, key: string) =>
      request<WorkspaceConnection>(
        `${route(service)}/disconnect`,
        "POST",
        {},
        version,
        key,
      ),
    files: (
      service: WorkspaceService,
      options: { parentId?: string; search?: string; page?: string } = {},
    ) =>
      request<WorkspacePage<WorkspaceResource>>(
        `${route(service)}/files?${query(options)}`,
      ),
    messages: (service: WorkspaceService) =>
      request<WorkspacePage<WorkspaceMessage>>(`${route(service)}/messages`),
    message: (service: WorkspaceService, id: string) =>
      request<WorkspaceMessage>(
        `${route(service)}/messages/${encodeURIComponent(id)}`,
      ),
    createDraft: (
      service: WorkspaceService,
      input: {
        to: string[];
        subject: string;
        text: string;
        campaignId?: string;
      },
      version: number,
      key: string,
    ) =>
      request<WorkspaceDraft>(
        `${route(service)}/drafts`,
        "POST",
        input,
        version,
        key,
      ),
    sendDraft: (
      service: WorkspaceService,
      draftId: string,
      version: number,
      key: string,
      campaignId?: string,
    ) =>
      request<WorkspaceReceipt>(
        `${route(service)}/drafts/${encodeURIComponent(draftId)}/send`,
        "POST",
        { confirm: true, ...(campaignId ? { campaignId } : {}) },
        version,
        key,
      ),
    events: (service: WorkspaceService, period: { from: string; to: string }) =>
      request<WorkspacePage<WorkspaceEvent>>(
        `${route(service)}/events?${query(period)}`,
      ),
    publishEvent: (
      service: WorkspaceService,
      input: WorkspaceEventInput,
      version: number,
      key: string,
    ) =>
      request<WorkspaceReceipt>(
        `${route(service)}/events`,
        "POST",
        { ...input, confirm: true },
        version,
        key,
      ),
    sheet: () => request<WorkspaceSheet>("/workspace/google_sheets/sheet"),
    report: (period: { from: string; to: string }) =>
      request<SearchConsoleReport>(
        `/workspace/google_search_console/report?${query(period)}`,
      ),
    syncReport: (
      period: { from: string; to: string },
      version: number,
      key: string,
    ) =>
      request<SearchConsoleReport>(
        "/workspace/google_search_console/report",
        "POST",
        period,
        version,
        key,
      ),
    links: (campaignId: string) =>
      request<WorkspaceLink[]>(
        `/campaigns/${encodeURIComponent(campaignId)}/workspace-links`,
      ),
    attach: (
      campaignId: string,
      input: {
        service: WorkspaceService;
        kind: "file" | "message";
        resourceId: string;
      },
      version: number,
      key: string,
    ) =>
      request<WorkspaceLink>(
        `/campaigns/${encodeURIComponent(campaignId)}/workspace-links`,
        "POST",
        input,
        version,
        key,
      ),
    disableLink: (campaignId: string, link: WorkspaceLink, key: string) =>
      request<WorkspaceLink>(
        `/campaigns/${encodeURIComponent(campaignId)}/workspace-links/${encodeURIComponent(link.id)}/disable`,
        "POST",
        {},
        link.version,
        key,
      ),
  };
}
export type WorkspaceClient = ReturnType<typeof createWorkspaceClient>;
export const workspaceClient = createWorkspaceClient();
