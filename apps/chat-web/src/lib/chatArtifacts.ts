import {
  parseChatMessageContent,
  serializeChatMessageContent,
  type ChatMessageFilePart,
} from "./chatMessageParts";

const SIGNED_URL_REFRESH_WINDOW_MS = 60 * 1000;

type RefreshArtifactOptions = {
  now?: number;
  refreshWindowMs?: number;
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string | null | undefined>;
  chatbotProxyBaseUrl?: string;
};

const resolveChatbotProxyBaseUrl = (override?: string) => {
  const raw = (override ?? import.meta.env.VITE_CHATBOT_PROXY_URL ?? import.meta.env.NEXT_PUBLIC_CHATBOT_PROXY_URL ?? "")
    .trim();
  if (!raw) return null;
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const getSupabaseAccessToken = async () => {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
};

const shouldRefreshArtifactSignedUrl = (
  signedUrlExpiresAt?: string,
  { now = Date.now(), refreshWindowMs = SIGNED_URL_REFRESH_WINDOW_MS }: { now?: number; refreshWindowMs?: number } = {},
) => {
  if (!signedUrlExpiresAt) return true;
  const expiresAt = Date.parse(signedUrlExpiresAt);
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - now <= refreshWindowMs;
};

export const refreshArtifactFileUrl = async (
  part: ChatMessageFilePart,
  {
    now = Date.now(),
    refreshWindowMs,
    fetchImpl = fetch,
    getAccessToken = getSupabaseAccessToken,
    chatbotProxyBaseUrl,
  }: RefreshArtifactOptions = {},
) => {
  if (!part.artifactId || !shouldRefreshArtifactSignedUrl(part.signedUrlExpiresAt, { now, refreshWindowMs })) {
    return part;
  }

  const baseUrl = resolveChatbotProxyBaseUrl(chatbotProxyBaseUrl);
  if (!baseUrl) throw new Error("chatbot_proxy_not_configured");

  const token = await getAccessToken();
  if (!token) throw new Error("missing_session_token");

  const response = await fetchImpl(`${baseUrl}/api/artifacts/${encodeURIComponent(part.artifactId)}/access-link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.url !== "string") {
    throw new Error(typeof payload.error === "string" ? payload.error : `artifact_access_link_failed:${response.status}`);
  }

  return {
    ...part,
    url: payload.url,
    signedUrlExpiresAt: typeof payload.expires_at === "string" ? payload.expires_at : part.signedUrlExpiresAt,
  };
};

export const refreshChatMessageArtifactUrls = async (content: string) => {
  const parts = parseChatMessageContent(content);
  if (parts.length === 0) return content;

  let changed = false;
  const refreshedParts = await Promise.all(
    parts.map(async (part) => {
      if (part.type !== "file" || !part.artifactId) return part;

      if (!shouldRefreshArtifactSignedUrl(part.signedUrlExpiresAt)) return part;

      const refreshedPart = await refreshArtifactFileUrl(part);
      if (refreshedPart.url === part.url && refreshedPart.signedUrlExpiresAt === part.signedUrlExpiresAt) {
        return part;
      }

      changed = true;
      return refreshedPart;
    }),
  );

  return changed ? serializeChatMessageContent(refreshedParts) : content;
};
