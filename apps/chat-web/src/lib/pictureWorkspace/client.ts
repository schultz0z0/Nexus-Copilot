import type { PictureWorkspace, PictureWorkspaceClient, PictureWorkspaceFile } from "./types";

const errorMessages: Record<string, string> = {
  unauthorized: "Sua sessão expirou. Entre novamente.",
  picture_not_configured: "O modo Picture não está configurado.",
  picture_unavailable: "O Picture está indisponível no momento.",
  picture_timeout: "O Picture demorou para responder. Tente novamente.",
  picture_workspace_not_found: "Este workspace não foi encontrado.",
  picture_session_not_found: "A sessão desta peça não foi encontrada.",
  picture_candidate_missing: "Ainda não existe uma peça final para aprovar.",
  picture_candidate_not_ready: "A peça final ainda não está pronta para aprovação.",
  picture_approval_required: "Aprove a peça final antes de criar uma nova.",
};

export class PictureWorkspaceApiError extends Error {
  constructor(public readonly code: string, public readonly status: number, message?: string) {
    super(message || errorMessages[code] || "Não foi possível concluir a operação no Picture.");
    this.name = "PictureWorkspaceApiError";
  }
}

interface PictureWorkspaceClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}

export const createPictureWorkspaceClient = (options: PictureWorkspaceClientOptions): PictureWorkspaceClient => {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const token = await options.getAccessToken();
    if (!token) throw new PictureWorkspaceApiError("unauthorized", 401);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new PictureWorkspaceApiError("picture_unavailable", 503);
    }
    const payload = await response.json().catch(() => ({})) as {
      error?: string;
      workspace?: PictureWorkspace;
      files?: PictureWorkspaceFile[];
    };
    if (!response.ok) {
      const code = payload.error || "picture_request_failed";
      throw new PictureWorkspaceApiError(code, response.status);
    }
    return payload as T;
  };

  const workspacePath = (workspaceId: string) =>
    `/api/picture/workspaces/${encodeURIComponent(workspaceId)}`;

  return {
    current: async (signal) => (await request<{ workspace: PictureWorkspace }>(
      "/api/picture/workspace/current",
      { method: "POST", body: "{}", signal },
    )).workspace,
    details: async (workspaceId, signal) => (await request<{ workspace: PictureWorkspace }>(
      workspacePath(workspaceId), { signal },
    )).workspace,
    files: async (workspaceId, signal) => (await request<{ files: PictureWorkspaceFile[] }>(
      `${workspacePath(workspaceId)}/files`, { signal },
    )).files,
    approve: async (workspaceId, signal) => (await request<{ workspace: PictureWorkspace }>(
      `${workspacePath(workspaceId)}/approve`, { method: "POST", body: "{}", signal },
    )).workspace,
    newPiece: async (workspaceId, signal) => (await request<{ workspace: PictureWorkspace }>(
      `${workspacePath(workspaceId)}/new-piece`, { method: "POST", body: "{}", signal },
    )).workspace,
    accessFile: async (artifactId, signal) => {
      const result = await request<{ url: string; expires_at: string }>(
        `/api/artifacts/${encodeURIComponent(artifactId)}/access-link`,
        { method: "POST", body: "{}", signal },
      );
      return { url: result.url, expiresAt: result.expires_at };
    },
  };
};
