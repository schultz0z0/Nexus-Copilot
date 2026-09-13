export interface User {
  id: string;
  email: string;
  full_name?: string | null;
  avatar_url?: string | null;
  tenant_id?: string | null;
  role?: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url?: string | null;
  role: string;
  active: boolean;
  hermes_enabled: boolean;
  hermes_base_url: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  session_kind: "normal" | "picture";
  user_message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ListMessagesResponse {
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface ChatRunCreatePayload {
  session_id?: string;
  message?: string;
  [key: string]: unknown;
}

export interface ChatRunResponse {
  run_id?: string;
  id?: string;
  state?: unknown;
  status?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export const onUnauthorized = (handler: UnauthorizedHandler | null) => {
  unauthorizedHandler = handler;
};

const getBaseUrl = () => {
  const url = import.meta.env.VITE_APP_API_URL || "";
  return url.replace(/\/$/, "");
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;
  const headers = new Headers(options.headers || {});

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    let errorBody: unknown = null;
    try {
      errorBody = await response.json();
      const parsed = errorBody as { error?: unknown; message?: unknown } | null;
      if (parsed?.error) {
        errorMessage = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error);
      } else if (parsed?.message) {
        errorMessage = typeof parsed.message === "string" ? parsed.message : JSON.stringify(parsed.message);
      }
    } catch {
      // Non-JSON error body
    }

    if (response.status === 401 && unauthorizedHandler) {
      try {
        unauthorizedHandler();
      } catch {
        // Ignore handler error
      }
    }

    throw new ApiError(response.status, errorMessage, errorBody);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : ({} as T)) as T;
}

export const api = {
  auth: {
    login: (credentials: { email: string; password: string }): Promise<{ user: User }> =>
      request<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      }),

    logout: (): Promise<{ ok: boolean }> =>
      request<{ ok: boolean }>("/api/auth/logout", {
        method: "POST",
      }),

    me: (): Promise<{ user: User }> =>
      request<{ user: User }>("/api/auth/me", {
        method: "GET",
      }),

    session: (): Promise<{ user: User }> =>
      request<{ user: User }>("/api/auth/session", {
        method: "GET",
      }),

    changePassword: (currentPassword: string, newPassword: string): Promise<{ ok: boolean }> =>
      request<{ ok: boolean }>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
  },

  admin: {
    users: {
      list: (): Promise<{ users: AdminUser[] }> =>
        request<{ users: AdminUser[] }>("/api/admin/users", {
          method: "GET",
        }),

      create: (payload: {
        email: string;
        password: string;
        full_name?: string;
        role?: string;
      }): Promise<{ user: AdminUser }> =>
        request<{ user: AdminUser }>("/api/admin/users", {
          method: "POST",
          body: JSON.stringify(payload),
        }),

      update: (
        id: string,
        payload: {
          full_name?: string;
          role?: string;
          active?: boolean;
          avatar_url?: string | null;
          hermes_enabled?: boolean;
          hermes_base_url?: string | null;
        }
      ): Promise<{ user: AdminUser }> =>
        request<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        }),

      resetPassword: (id: string, password: string): Promise<{ ok: boolean }> =>
        request<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
          method: "POST",
          body: JSON.stringify({ password }),
        }),

      delete: (id: string): Promise<{ ok: boolean }> =>
        request<{ ok: boolean }>(`/api/admin/users/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),

      uploadAvatar: async (userId: string, file: File): Promise<{ avatar_url: string }> => {
        const formData = new FormData();
        formData.append("file", file);
        const baseUrl = getBaseUrl();
        const response = await fetch(`${baseUrl}/api/admin/users/${encodeURIComponent(userId)}/avatar`, {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new ApiError(response.status, errorData.error || "Failed to upload avatar");
        }
        return response.json();
      },

      deleteAvatar: (userId: string): Promise<{ ok: boolean; avatar_url: null }> =>
        request<{ ok: boolean; avatar_url: null }>(`/api/admin/users/${encodeURIComponent(userId)}/avatar`, {
          method: "DELETE",
        }),
    },
  },

  chat: {
    listSessions: (options?: { session_kind?: string; limit?: number }): Promise<{ sessions: ChatSession[] }> => {
      const params = new URLSearchParams();
      if (options?.session_kind !== undefined) {
        params.set("session_kind", options.session_kind);
      }
      if (options?.limit !== undefined) {
        params.set("limit", String(options.limit));
      }
      const qs = params.toString();
      return request<{ sessions: ChatSession[] }>(`/api/chat/sessions${qs ? `?${qs}` : ""}`, {
        method: "GET",
      });
    },

    createSession: (data?: { id?: string; title?: string; session_kind?: string }): Promise<{ session: ChatSession }> =>
      request<{ session: ChatSession }>("/api/chat/sessions", {
        method: "POST",
        body: JSON.stringify(data ?? {}),
      }),

    getSession: (id: string): Promise<{ session: ChatSession }> =>
      request<{ session: ChatSession }>(`/api/chat/sessions/${encodeURIComponent(id)}`, {
        method: "GET",
      }),

    updateSession: (id: string, data: { title: string }): Promise<{ session: ChatSession }> =>
      request<{ session: ChatSession }>(`/api/chat/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    deleteSession: (id: string): Promise<{ ok: boolean }> =>
      request<{ ok: boolean }>(`/api/chat/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),

    listMessages: (
      sessionId: string,
      options?: { limit?: number; before?: { created_at: string; id: string } }
    ): Promise<ListMessagesResponse> => {
      const params = new URLSearchParams();
      if (options?.limit !== undefined) {
        params.set("limit", String(options.limit));
      }
      if (options?.before?.created_at && options?.before?.id) {
        params.set("before_created_at", options.before.created_at);
        params.set("before_id", options.before.id);
      }
      const qs = params.toString();
      return request<ListMessagesResponse>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages${qs ? `?${qs}` : ""}`,
        {
          method: "GET",
        }
      );
    },

    createMessage: (
      sessionId: string,
      data: { id?: string; role: "user" | "assistant"; content: string }
    ): Promise<{ message: ChatMessage }> =>
      request<{ message: ChatMessage }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    createRun: (payload: ChatRunCreatePayload): Promise<ChatRunResponse> =>
      request<ChatRunResponse>("/api/chat/runs", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    getRun: (id: string): Promise<ChatRunResponse> =>
      request<ChatRunResponse>(`/api/chat/runs/${encodeURIComponent(id)}`, {
        method: "GET",
      }),

    stopRun: (id: string): Promise<ChatRunResponse> =>
      request<ChatRunResponse>(`/api/chat/runs/${encodeURIComponent(id)}/stop`, {
        method: "POST",
      }),

    getRunEventsUrl: (id: string, cursor?: number): string => {
      const baseUrl = getBaseUrl();
      const params = cursor !== undefined ? `?cursor=${encodeURIComponent(cursor)}` : "";
      return `${baseUrl}/api/chat/runs/${encodeURIComponent(id)}/events${params}`;
    },
  },

  users: {
    uploadAvatar: async (file: File): Promise<{ avatar_url: string }> => {
      const formData = new FormData();
      formData.append("file", file);
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/users/me/avatar`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(response.status, errorData.error || "Failed to upload avatar");
      }
      return response.json();
    },

    deleteAvatar: (): Promise<{ ok: boolean; avatar_url: null }> =>
      request<{ ok: boolean; avatar_url: null }>("/api/users/me/avatar", {
        method: "DELETE",
      }),
  },

  attachments: {
    upload: async (
      file: File,
      sessionId?: string
    ): Promise<{
      attachment: {
        id: string;
        filename: string;
        content_type: string;
        byte_size: number;
        sha256: string;
        url: string;
        direct_url?: string;
        token?: string;
        expires_at?: string;
      };
    }> => {
      const formData = new FormData();
      formData.append("file", file);
      if (sessionId) {
        formData.append("session_id", sessionId);
      }
      const baseUrl = getBaseUrl();
      const response = await fetch(`${baseUrl}/api/attachments`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(response.status, errorData.error || "Failed to upload attachment");
      }
      return response.json();
    },

    refreshAccessLink: (
      id: string
    ): Promise<{
      artifact_id: string;
      url: string;
      token: string;
      expires_at: string;
    }> =>
      request<{
        artifact_id: string;
        url: string;
        token: string;
        expires_at: string;
      }>(`/api/attachments/${encodeURIComponent(id)}/access-link`, {
        method: "POST",
      }),
  },
};

export default api;
