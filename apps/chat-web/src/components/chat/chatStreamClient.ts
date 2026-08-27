import { createFilePart, guessFileNameFromUrl, isImageResource, type ChatMessageArtifactPart, type ChatMessageFilePart, type ChatMessageStatusPart } from "@/lib/chatMessageParts";
import type { ChatProxyPayload } from "@/lib/chatProxyPayload";
import { getTenantContext } from "@/lib/tenant-id";
import { isAllowedStreamFileUrl } from "./chatStreamFileSafety";

export type StreamStatus = {
  text: string;
  tone?: ChatMessageStatusPart["tone"];
};

export type StreamArtifact = Omit<ChatMessageArtifactPart, "id" | "type">;

type SendMessageToChatbotStreamParams = {
  payload: ChatProxyPayload;
  getAccessToken: () => Promise<string>;
  refreshAccessToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
  resolveChatbotProxyBaseUrl: () => string;
  onDelta: (delta: string) => void;
  onMeta?: (meta: Record<string, unknown>) => void;
  onStatus?: (status: StreamStatus) => void;
  onFiles?: (files: ChatMessageFilePart[]) => void;
  onArtifact?: (artifact: StreamArtifact) => void;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status: number) => {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
};

const requestRun = async ({
  token,
  payload,
  resolveChatbotProxyBaseUrl,
}: {
  token: string;
  payload: ChatProxyPayload;
  resolveChatbotProxyBaseUrl: () => string;
}) => {
  try {
    const baseUrl = resolveChatbotProxyBaseUrl();
    const { Authorization: _tenantAuthorization, ...tenantContext } = await getTenantContext();
    return await fetch(`${baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...tenantContext,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Falha de rede");
    throw err;
  }
};

const requestRunEvents = async ({
  token,
  runId,
  cursor,
  resolveChatbotProxyBaseUrl,
}: {
  token: string;
  runId: string;
  cursor: number;
  resolveChatbotProxyBaseUrl: () => string;
}) => {
  const baseUrl = resolveChatbotProxyBaseUrl();
  return await fetch(`${baseUrl}/api/chat/runs/${encodeURIComponent(runId)}/events?cursor=${cursor}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
  });
};

const requestRunSnapshot = async ({
  token,
  runId,
  resolveChatbotProxyBaseUrl,
}: {
  token: string;
  runId: string;
  resolveChatbotProxyBaseUrl: () => string;
}) => {
  const baseUrl = resolveChatbotProxyBaseUrl();
  return await fetch(`${baseUrl}/api/chat/runs/${encodeURIComponent(runId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
};

const parseRunId = async (response: Response) => {
  const parsed = await response.json().catch(() => null) as { run?: { id?: unknown }; id?: unknown } | null;
  const runId = typeof parsed?.run?.id === "string" ? parsed.run.id : typeof parsed?.id === "string" ? parsed.id : "";
  if (!runId) {
    throw new Error("A bridge criou a tarefa sem identificador de execução.");
  }
  return runId;
};

type RunSnapshotEvent = {
  event?: unknown;
  data?: unknown;
};

const serializeSnapshotEvent = (event: RunSnapshotEvent) => {
  const eventType = typeof event.event === "string" ? event.event.trim() : "";
  if (!eventType) return "";
  const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data ?? {});
  return `event: ${eventType}\ndata: ${data}`;
};

export const sendMessageToChatbotStream = async ({
  payload,
  getAccessToken,
  refreshAccessToken,
  signOut,
  resolveChatbotProxyBaseUrl,
  onDelta,
  onMeta,
  onStatus,
  onFiles,
  onArtifact,
}: SendMessageToChatbotStreamParams) => {
  let accessToken = await getAccessToken();
  let response: Response;

  try {
    response = await requestRun({ token: accessToken, payload, resolveChatbotProxyBaseUrl });
  } catch {
    await wait(600);
    response = await requestRun({ token: accessToken, payload, resolveChatbotProxyBaseUrl });
  }

  if (!response.ok && (response.status === 401 || response.status === 403)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      accessToken = refreshed;
      response = await requestRun({ token: accessToken, payload, resolveChatbotProxyBaseUrl });
    } else {
      await signOut();
      throw new Error("Sessão expirada. Faça login novamente.");
    }
  }

  if (!response.ok && isRetryableStatus(response.status)) {
    await wait(600);
    response = await requestRun({ token: accessToken, payload, resolveChatbotProxyBaseUrl });
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    let errorMessage = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed.detail) errorMessage = parsed.detail;
      else if (parsed.error) errorMessage = parsed.error;
      else if (parsed.message) errorMessage = parsed.message;
    } catch {
      // use raw text
    }
    throw new Error(errorMessage || `Erro ${response.status}: Falha na comunicação com a IA`);
  }

  const runId = await parseRunId(response);
  let buffer = "";
  let completed = false;
  let streamError: string | null = null;
  let cursor = 0;

  const processChunk = (chunk: string) => {
    const lines = chunk.split("\n");

    let eventType = "";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.substring(6).trim();
      } else if (line.startsWith("data:")) {
        let data = line.substring(5);
        if (data.startsWith(" ")) {
          data = data.substring(1);
        }
        dataLines.push(data);
      }
    }

    if (!eventType) return;

    if (eventType === "done") {
      completed = true;
      return;
    }

    if (eventType === "error") {
      const combinedData = dataLines.join("\n");
      streamError = combinedData || "Erro na resposta da IA";
      return;
    }

    if (eventType === "meta") {
      const combinedData = dataLines.join("\n");
      if (!combinedData) return;
      try {
        const parsed = JSON.parse(combinedData);
        if (parsed && onMeta) onMeta(parsed as Record<string, unknown>);
      } catch {
        if (onMeta) onMeta({ raw: combinedData });
      }
      return;
    }

    if (eventType === "status") {
      const combinedData = dataLines.join("\n");
      if (!combinedData || !onStatus) return;
      try {
        const parsed = JSON.parse(combinedData) as Record<string, unknown>;
        const text = typeof parsed.text === "string" ? parsed.text : "";
        if (!text) return;
        onStatus({
          text,
          tone:
            parsed.tone === "success" || parsed.tone === "warning" || parsed.tone === "info"
              ? parsed.tone
              : "info",
        });
      } catch {
        onStatus({ text: combinedData, tone: "info" });
      }
      return;
    }

    if (eventType === "files") {
      const combinedData = dataLines.join("\n");
      if (!combinedData || !onFiles) return;
      try {
        const parsed = JSON.parse(combinedData) as { files?: Array<Record<string, unknown>> };
        const files = Array.isArray(parsed.files)
          ? parsed.files.flatMap((file) => {
              const url = typeof file.url === "string" ? file.url : "";
              if (!url || !isAllowedStreamFileUrl(url)) return [];
              const mimeType = typeof file.mimeType === "string" ? file.mimeType : undefined;
              const name =
                typeof file.name === "string" && file.name.trim().length > 0
                  ? file.name
                  : guessFileNameFromUrl(url);
              const kind = file.kind === "image" || isImageResource(name || url, mimeType) ? "image" : "file";
              const artifactId = typeof file.artifact_id === "string" ? file.artifact_id : undefined;
              const artifactSize = typeof file.artifact_size === "number" ? file.artifact_size : undefined;
              const artifactSha256 = typeof file.artifact_sha256 === "string" ? file.artifact_sha256 : undefined;
              const originalUrl = typeof file.original_url === "string" ? file.original_url : undefined;
              const storagePath = !artifactId && typeof file.storage_path === "string" ? file.storage_path : undefined;
              const storageBucket = !artifactId && typeof file.storage_bucket === "string" ? file.storage_bucket : undefined;
              const signedUrlExpiresAt =
                typeof file.signed_url_expires_at === "string" ? file.signed_url_expires_at : undefined;

              return [
                createFilePart({
                  name,
                  url,
                  kind,
                  mimeType,
                  storagePath,
                  storageBucket,
                  signedUrlExpiresAt,
                  artifactId,
                  artifactSize,
                  artifactSha256,
                  originalUrl,
                }),
              ];
            })
          : [];

        if (files.length > 0) onFiles(files);
      } catch {
        // ignore malformed payloads
      }
      return;
    }

    if (eventType === "artifact") {
      const combinedData = dataLines.join("\n");
      if (!combinedData || !onArtifact) return;
      try {
        const parsed = JSON.parse(combinedData) as Record<string, unknown>;
        if (typeof parsed.content !== "string" || !parsed.content.trim()) return;
        onArtifact({
          title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : "Artifact Hermes",
          content: parsed.content,
          artifactType:
            parsed.artifactType === "markdown" ||
            parsed.artifactType === "html" ||
            parsed.artifactType === "text" ||
            parsed.artifactType === "code"
              ? parsed.artifactType
              : "text",
          language: typeof parsed.language === "string" ? parsed.language : undefined,
          fileName: typeof parsed.fileName === "string" ? parsed.fileName : undefined,
        });
      } catch {
        // ignore malformed payloads
      }
      return;
    }

    if (eventType !== "delta") return;

    const combinedData = dataLines.join("\n");
    if (!combinedData) return;

    let deltaText = combinedData;
    try {
      const parsed = JSON.parse(combinedData);
      if (typeof parsed === "string") deltaText = parsed;
      else if (parsed?.delta) deltaText = parsed.delta;
      else if (parsed?.text) deltaText = parsed.text;
      else if (parsed?.content) deltaText = parsed.content;
    } catch {
      deltaText = combinedData;
    }

    if (deltaText) onDelta(deltaText);
  };

  const refreshOrThrow = async () => {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      accessToken = refreshed;
      return;
    }
    await signOut();
    throw new Error("Sessão expirada. Faça login novamente.");
  };

  const reconcileSnapshot = async () => {
    const snapshotResponse = await requestRunSnapshot({
      token: accessToken,
      runId,
      resolveChatbotProxyBaseUrl,
    }).catch(() => null);

    if (snapshotResponse?.status === 401 || snapshotResponse?.status === 403) {
      await refreshOrThrow();
      return true;
    }

    if (!snapshotResponse?.ok) return false;

    const snapshot = await snapshotResponse.json().catch(() => null) as {
      run?: { status?: string; events?: RunSnapshotEvent[] };
    } | null;
    const events = Array.isArray(snapshot?.run?.events) ? snapshot.run.events : [];

    while (cursor < events.length) {
      const chunk = serializeSnapshotEvent(events[cursor]);
      cursor += 1;
      if (!chunk) continue;
      processChunk(chunk);
      if (streamError) throw new Error(streamError);
      if (completed) return true;
    }

    const status = snapshot?.run?.status;
    if (status === "completed") {
      completed = true;
      return true;
    }
    if (
      status === "failed" ||
      status === "cancelled" ||
      status === "canceled" ||
      status === "expired" ||
      status === "interrupted"
    ) {
      throw new Error("Hermes encerrou a execução antes de entregar uma resposta.");
    }

    return false;
  };

  while (!completed) {
    let eventsResponse: Response;
    try {
      eventsResponse = await requestRunEvents({
        token: accessToken,
        runId,
        cursor,
        resolveChatbotProxyBaseUrl,
      });
    } catch {
      if (await reconcileSnapshot()) continue;
      await wait(900);
      continue;
    }

    if (!eventsResponse.ok || !eventsResponse.body) {
      if (eventsResponse.status === 401 || eventsResponse.status === 403) {
        await refreshOrThrow();
        continue;
      }

      if (isRetryableStatus(eventsResponse.status)) {
        await wait(900);
        continue;
      }

      const errorText = await eventsResponse.text().catch(() => "");
      throw new Error(errorText || `Erro ${eventsResponse.status}: Falha ao acompanhar a execução da IA`);
    }

    const reader = eventsResponse.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (!completed) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          processChunk(part);
          cursor += 1;
          if (streamError) {
            try {
              await reader.cancel();
            } catch {
              // ignore cancellation errors
            }
            throw new Error(streamError);
          }

          if (completed) {
            break;
          }
        }
      }
    } catch {
      if (streamError) throw new Error(streamError);
      buffer = "";
      await wait(900);
      continue;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore release errors
      }
    }

    if (!completed) {
      buffer = "";
      if (await reconcileSnapshot()) continue;

      await wait(900);
    }
  }

  if (buffer.trim()) {
    processChunk(buffer);
    cursor += 1;
  }

  if (streamError) {
    throw new Error(streamError);
  }
};
