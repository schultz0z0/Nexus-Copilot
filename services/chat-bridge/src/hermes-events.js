const MAX_RUN_SESSION_ID_LENGTH = 64;
const RUN_SESSION_PREFIX = "nexus:";
const APPROVAL_CHOICES = new Set(["once", "session", "always", "deny"]);

const knownFileExtensions = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif",
  "pdf", "doc", "docx", "txt", "rtf", "md", "csv", "json", "xlsx", "xls",
  "ppt", "pptx", "zip", "html", "htm", "mp3", "wav", "mp4",
]);

const sanitizeSessionSegment = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const buildStableHash = (value) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const buildHermesRunSessionId = (chatSessionId) => {
  const sanitized = sanitizeSessionSegment(chatSessionId) || "chat";
  const candidate = `${RUN_SESSION_PREFIX}${sanitized}`;
  if (candidate.length <= MAX_RUN_SESSION_ID_LENGTH) return candidate;

  const hash = buildStableHash(sanitized);
  const maxSegmentLength = MAX_RUN_SESSION_ID_LENGTH - RUN_SESSION_PREFIX.length - hash.length - 1;
  return `${RUN_SESSION_PREFIX}${sanitized.slice(0, maxSegmentLength)}-${hash}`;
};

const parseJsonPayload = (payload) => {
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed : { raw: payload };
  } catch {
    return { raw: payload };
  }
};

const extractDataPayload = (eventBlock) => {
  const dataLines = [];
  String(eventBlock)
    .split("\n")
    .forEach((rawLine) => {
      const line = rawLine.trimEnd();
      if (!line.startsWith("data:")) return;
      let value = line.slice(5);
      if (value.startsWith(" ")) value = value.slice(1);
      dataLines.push(value);
    });

  return dataLines.join("\n").trim();
};

const extractSseEventName = (eventBlock) => {
  const eventLine = String(eventBlock)
    .split("\n")
    .map((line) => line.trimEnd())
    .find((line) => line.startsWith("event:"));

  return eventLine ? eventLine.slice(6).trim() : "";
};

const getFileExtension = (value) => {
  const match = String(value ?? "").match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return match?.[1]?.toLowerCase() ?? "";
};

const isImageLike = (value, mimeType) => {
  if (mimeType?.startsWith("image/")) return true;
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(getFileExtension(value));
};

const isLikelyFileReference = (url) => {
  const value = String(url ?? "").trim();
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return knownFileExtensions.has(getFileExtension(value));
  if (value.startsWith("/") || /^[a-z]:[\\/]/i.test(value)) return knownFileExtensions.has(getFileExtension(value));
  return false;
};

const guessFileNameFromUrl = (url) => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] ?? "arquivo");
  } catch {
    return String(url ?? "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "arquivo";
  }
};

const extractFilesFromUnknown = (value, depth = 0) => {
  if (depth > 4 || value === null || value === undefined) return [];

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return [];
    try {
      return extractFilesFromUnknown(JSON.parse(trimmed), depth + 1);
    } catch {
      return [];
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractFilesFromUnknown(item, depth + 1));
  }

  if (typeof value !== "object") return [];

  const record = value;
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  const mimeType =
    typeof record.mime_type === "string"
      ? record.mime_type
      : typeof record.mimeType === "string"
        ? record.mimeType
        : typeof record.content_type === "string"
          ? record.content_type
          : undefined;

  const rawUrlCandidates = [
    record.url,
    record.image,
    record.image_url,
    record.file_url,
    record.download_url,
    record.host_image,
    record.agent_visible_image,
    record.path,
    record.file_path,
    record.output_path,
    record.local_path,
    record.href,
  ].filter((candidate) => typeof candidate === "string" && candidate.trim().length > 0);

  const rawName =
    typeof record.name === "string"
      ? record.name
      : typeof record.filename === "string"
        ? record.filename
        : typeof record.file_name === "string"
          ? record.file_name
          : typeof record.title === "string"
            ? record.title
            : undefined;

  const directFiles = rawUrlCandidates.flatMap((url) => {
    if (!(type.includes("file") || type.includes("image") || mimeType || rawName || isLikelyFileReference(url))) {
      return [];
    }

    const name = rawName?.trim() || guessFileNameFromUrl(url);
    const storagePath =
      typeof record.storage_path === "string" && record.storage_path.trim()
        ? record.storage_path.trim()
        : undefined;
    const signedUrlExpiresAt =
      typeof record.signed_url_expires_at === "string" && record.signed_url_expires_at.trim()
        ? record.signed_url_expires_at.trim()
        : undefined;
    const storageBucket =
      typeof record.storage_bucket === "string" && record.storage_bucket.trim()
        ? record.storage_bucket.trim()
        : undefined;
    const originalUrl = [
      record.original_url,
      record.original_download_url,
      record.original_image_url,
      record.original_file_url,
      record.source_url,
    ].find((candidate) => typeof candidate === "string" && candidate.trim() && candidate.trim() !== url);
    return [{
      name,
      url,
      kind: type.includes("image") || isImageLike(name || url, mimeType) ? "image" : "file",
      ...(originalUrl ? { original_url: originalUrl.trim() } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(storagePath ? { storage_path: storagePath } : {}),
      ...(storageBucket ? { storage_bucket: storageBucket } : {}),
      ...(signedUrlExpiresAt ? { signed_url_expires_at: signedUrlExpiresAt } : {}),
    }];
  });

  return [
    ...directFiles,
    ...extractFilesFromUnknown(record.files, depth + 1),
    ...extractFilesFromUnknown(record.content, depth + 1),
    ...extractFilesFromUnknown(record.output, depth + 1),
    ...extractFilesFromUnknown(record.result, depth + 1),
    ...extractFilesFromUnknown(record.artifacts, depth + 1),
    ...extractFilesFromUnknown(record.items, depth + 1),
    ...extractFilesFromUnknown(record.payload, depth + 1),
    ...extractFilesFromUnknown(record.item, depth + 1),
  ];
};

const dedupeFiles = (files) => {
  const seen = new Set();
  return files.filter((file) => {
    const key = file.url.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const extractAssistantText = (payload) => {
  if (typeof payload.output === "string") return payload.output;
  if (typeof payload.output_text === "string") return payload.output_text;
  if (typeof payload.content === "string") return payload.content;
  if (typeof payload.text === "string") return payload.text;

  const message = payload.message;
  if (message && typeof message === "object") {
    if (typeof message.content === "string") return message.content;
    if (typeof message.text === "string") return message.text;
  }

  return "";
};

const extractAssistantTextFromUnknown = (value, depth = 0) => {
  if (depth > 6 || value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractAssistantTextFromUnknown(item, depth + 1));
  }

  if (typeof value !== "object") return [];

  const record = value;
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  const role = typeof record.role === "string" ? record.role.toLowerCase() : "";

  if ((type === "output_text" || type === "text") && typeof record.text === "string" && record.text.length > 0) {
    return [record.text];
  }

  if ((type === "message" || role === "assistant") && typeof record.content === "string" && record.content.length > 0) {
    return [record.content];
  }

  return [
    ...extractAssistantTextFromUnknown(record.item, depth + 1),
    ...extractAssistantTextFromUnknown(record.items, depth + 1),
    ...extractAssistantTextFromUnknown(record.output, depth + 1),
    ...extractAssistantTextFromUnknown(record.content, depth + 1),
    ...extractAssistantTextFromUnknown(record.response, depth + 1),
  ];
};

const buildMissingTextDelta = (currentStreamedText, candidateText) => {
  if (!candidateText) return null;
  if (!currentStreamedText) return candidateText;
  if (candidateText === currentStreamedText) return null;
  if (candidateText.startsWith(currentStreamedText)) {
    return candidateText.slice(currentStreamedText.length);
  }
  return null;
};

const extractErrorMessage = (value, depth = 0) => {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value !== "object") return null;

  if (typeof value.message === "string" && value.message.trim()) return value.message.trim();
  if (typeof value.error === "string" && value.error.trim()) return value.error.trim();
  return extractErrorMessage(value.error, depth + 1) ?? extractErrorMessage(value.response, depth + 1);
};

const extractToolName = (payload) => (
  typeof payload.tool_name === "string"
    ? payload.tool_name
    : payload.tool && typeof payload.tool === "object" && typeof payload.tool.name === "string"
      ? payload.tool.name
      : ""
);

const classifyToolMemoryLayer = (toolName) => {
  if (toolName.startsWith("ens_rag_")) {
    return { tool_namespace: "ens_rag", memory_layer: "rag" };
  }
  if (toolName.startsWith("nexus_graph_")) {
    return { tool_namespace: "nexus_graph", memory_layer: "graph" };
  }
  return { tool_namespace: "external", memory_layer: "external_tool" };
};

const buildToolMemoryMeta = (eventName, payload, context) => {
  const toolName = extractToolName(payload);
  if (!eventName.includes("tool") || !toolName) return null;

  const failure = eventName.includes("failed") || eventName.includes("error") || Boolean(payload.error);
  return {
    provider: "hermes",
    event: "memory.tool",
    tool_name: toolName,
    ...classifyToolMemoryLayer(toolName),
    tenant_id: context.tenantId ?? null,
    user_id: context.userId ?? null,
    run_id: context.runId,
    session_id: context.sessionId,
    failure,
    ...(failure ? { error_excerpt: (extractErrorMessage(payload) ?? "Tool failed").slice(0, 160) } : {}),
  };
};

const describeStatusEvent = (eventName, payload) => {
  const toolName = extractToolName(payload);

  if (eventName.includes("tool") && toolName) {
    return {
      text: eventName.includes("completed") || eventName.includes("done")
        ? `Hermes concluiu a ferramenta ${toolName}.`
        : `Hermes iniciou a ferramenta ${toolName}.`,
      tone: eventName.includes("completed") || eventName.includes("done") ? "success" : "info",
    };
  }

  if (eventName === "run.started" || eventName === "run.created") {
    return { text: "Hermes iniciou a execução do agente.", tone: "info" };
  }

  if (eventName === "run.completed") {
    return { text: "Hermes concluiu a execução do agente.", tone: "success" };
  }

  if (eventName === "run.failed") {
    return { text: "Hermes reportou uma falha ao executar o agente.", tone: "warning" };
  }

  return null;
};

export const parseHermesEventBlock = (eventBlock, context) => {
  const payload = extractDataPayload(eventBlock);
  if (!payload) {
    return {
      events: [],
      streamedText: context.streamedText,
      responseId: null,
      completed: false,
      failed: false,
      errorCode: null,
      recoveredFromFailure: false,
    };
  }

  if (payload === "[DONE]") {
    return {
      events: [{ event: "done", data: { request_id: context.requestId } }],
      streamedText: context.streamedText,
      responseId: null,
      completed: true,
      failed: false,
      errorCode: null,
      recoveredFromFailure: false,
    };
  }

  const parsedPayload = parseJsonPayload(payload);
  const eventName = extractSseEventName(eventBlock) || (typeof parsedPayload.event === "string" ? parsedPayload.event : "message");
  const events = [];
  let nextStreamedText = context.streamedText;
  const extractedFiles = dedupeFiles(extractFilesFromUnknown(parsedPayload));

  if (eventName === "approval.request") {
    const requestId = typeof parsedPayload.request_id === "string" ? parsedPayload.request_id.trim() : "";
    const choices = Array.isArray(parsedPayload.choices)
      ? parsedPayload.choices.filter((choice) => APPROVAL_CHOICES.has(choice))
      : [];
    if (!requestId || choices.length === 0) {
      return {
        events: [],
        streamedText: nextStreamedText,
        responseId: null,
        completed: false,
        failed: false,
        errorCode: null,
        recoveredFromFailure: false,
      };
    }

    const rawSummary = [parsedPayload.summary, parsedPayload.command, parsedPayload.description]
      .find((value) => typeof value === "string" && value.trim());
    events.push({
      event: "approval",
      data: {
        run_id: typeof parsedPayload.run_id === "string" ? parsedPayload.run_id : context.runId,
        request_id: requestId,
        choices,
        summary: (rawSummary?.trim() || "Hermes solicita aprovação.").slice(0, 500),
      },
    });

    return {
      events,
      streamedText: nextStreamedText,
      responseId: null,
      completed: false,
      failed: false,
      errorCode: null,
      recoveredFromFailure: false,
    };
  }

  if (eventName === "approval.resolved") {
    const requestId = typeof parsedPayload.request_id === "string" ? parsedPayload.request_id.trim() : "";
    if (requestId) {
      events.push({
        event: "meta",
        data: {
          provider: "hermes",
          event: "approval.resolved",
          run_id: typeof parsedPayload.run_id === "string" ? parsedPayload.run_id : context.runId,
          session_id: typeof parsedPayload.session_id === "string" ? parsedPayload.session_id : context.sessionId,
          request_id: requestId,
          choice: APPROVAL_CHOICES.has(parsedPayload.choice) ? parsedPayload.choice : null,
        },
      });
    }

    return {
      events,
      streamedText: nextStreamedText,
      responseId: null,
      completed: false,
      failed: false,
      errorCode: null,
      recoveredFromFailure: false,
    };
  }

  if (eventName === "run.stopping") {
    events.push({
      event: "meta",
      data: {
        provider: "hermes",
        event: "run.stopping",
        run_id: typeof parsedPayload.run_id === "string" ? parsedPayload.run_id : context.runId,
        session_id: typeof parsedPayload.session_id === "string" ? parsedPayload.session_id : context.sessionId,
      },
    });
    events.push({
      event: "status",
      data: { text: "Hermes está interrompendo a execução do agente.", tone: "info" },
    });

    return {
      events,
      streamedText: nextStreamedText,
      responseId: null,
      completed: false,
      failed: false,
      errorCode: null,
      recoveredFromFailure: false,
    };
  }

  if (eventName === "run.cancelled" || eventName === "run.canceled") {
    events.push({
      event: "meta",
      data: {
        provider: "hermes",
        event: "run.cancelled",
        run_id: typeof parsedPayload.run_id === "string" ? parsedPayload.run_id : context.runId,
        session_id: typeof parsedPayload.session_id === "string" ? parsedPayload.session_id : context.sessionId,
      },
    });
    events.push({ event: "done", data: { request_id: context.requestId } });

    return {
      events,
      streamedText: nextStreamedText,
      responseId: null,
      completed: false,
      failed: false,
      cancelled: true,
      errorCode: null,
      recoveredFromFailure: false,
    };
  }

  if (eventName === "message.delta" || eventName === "assistant.delta" || eventName === "response.output_text.delta") {
    const delta = typeof parsedPayload.delta === "string" ? parsedPayload.delta : "";
    if (delta) {
      events.push({ event: "delta", data: { delta } });
      nextStreamedText += delta;
    }

    return {
      events,
      streamedText: nextStreamedText,
      responseId: null,
      completed: false,
      failed: false,
      errorCode: null,
      recoveredFromFailure: false,
    };
  }

  if (eventName === "assistant.completed" || eventName === "message.completed" || eventName === "run.completed" || eventName === "response.completed" || eventName === "response.output_item.done") {
    const completedText = eventName.startsWith("response.")
      ? extractAssistantTextFromUnknown(parsedPayload).join("")
      : extractAssistantText(parsedPayload);
    const missingDelta = buildMissingTextDelta(nextStreamedText, completedText);
    if (missingDelta) {
      events.push({ event: "delta", data: { delta: missingDelta } });
      nextStreamedText += missingDelta;
    }

    if (extractedFiles.length > 0) {
      events.push({ event: "files", data: { files: extractedFiles } });
    }

    if (eventName !== "response.output_item.done") {
      events.push({
        event: "meta",
        data: {
          provider: "hermes",
          event: eventName,
          run_id: typeof parsedPayload.run_id === "string" ? parsedPayload.run_id : context.runId,
          session_id: typeof parsedPayload.session_id === "string" ? parsedPayload.session_id : context.sessionId,
          ...(eventName.startsWith("response.")
            ? {
                response_id: typeof parsedPayload.id === "string" ? parsedPayload.id : null,
                conversation: context.conversation ?? null,
              }
            : {}),
        },
      });
    }

    if (eventName === "run.completed" || eventName === "response.completed") {
      events.push({ event: "done", data: { request_id: context.requestId } });
    }

    return {
      events,
      streamedText: nextStreamedText,
      responseId: typeof parsedPayload.id === "string" ? parsedPayload.id : null,
      completed: eventName === "run.completed" || eventName === "response.completed",
      failed: false,
      errorCode: null,
      recoveredFromFailure: false,
    };
  }

  if (eventName === "run.failed" || eventName === "response.failed" || eventName === "error") {
    const finalText = eventName.startsWith("response.")
      ? extractAssistantTextFromUnknown(parsedPayload).join("")
      : "";
    const missingDelta = buildMissingTextDelta(nextStreamedText, finalText);
    if (missingDelta) {
      events.push({ event: "delta", data: { delta: missingDelta } });
      nextStreamedText += missingDelta;
    }

    const upstreamError = extractErrorMessage(parsedPayload) ?? "Falha ao executar o Hermes.";
    const errorCode = upstreamError.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80) || "unknown_error";
    events.push({
      event: "meta",
      data: {
        provider: "hermes",
        event: eventName,
        run_id: typeof parsedPayload.run_id === "string" ? parsedPayload.run_id : context.runId,
        session_id: typeof parsedPayload.session_id === "string" ? parsedPayload.session_id : context.sessionId,
        response_id: typeof parsedPayload.id === "string" ? parsedPayload.id : null,
        conversation: context.conversation ?? null,
        error_code: errorCode,
        has_assistant_text: nextStreamedText.trim().length > 0,
        upstream_error_excerpt: upstreamError.slice(0, 160),
      },
    });

    if (nextStreamedText.trim().length > 0) {
      events.push({ event: "done", data: { request_id: context.requestId } });
      return {
        events,
        streamedText: nextStreamedText,
        responseId: typeof parsedPayload.id === "string" ? parsedPayload.id : null,
        completed: true,
        failed: false,
        errorCode,
        recoveredFromFailure: true,
      };
    }

    events.push({ event: "error", data: upstreamError });
    events.push({ event: "done", data: { request_id: context.requestId } });

    return {
      events,
      streamedText: nextStreamedText,
      responseId: typeof parsedPayload.id === "string" ? parsedPayload.id : null,
      completed: false,
      failed: true,
      errorCode,
      recoveredFromFailure: false,
    };
  }

  const status = describeStatusEvent(eventName, parsedPayload);
  const toolMemoryMeta = buildToolMemoryMeta(eventName, parsedPayload, context);
  if (toolMemoryMeta) events.push({ event: "meta", data: toolMemoryMeta });
  if (status) events.push({ event: "status", data: status });
  if (extractedFiles.length > 0) events.push({ event: "files", data: { files: extractedFiles } });

  return {
    events,
    streamedText: nextStreamedText,
    responseId: null,
    completed: false,
    failed: false,
    errorCode: null,
    recoveredFromFailure: false,
  };
};

const buildStatusEventBlock = (payload, event) => (
  `data: ${JSON.stringify({ ...payload, event })}`
);

export const parseHermesStatusPayload = (payload, context) => {
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";

  if (status === "completed") {
    return {
      terminal: true,
      parsed: parseHermesEventBlock(buildStatusEventBlock(payload, "run.completed"), context),
    };
  }

  if (status === "cancelled" || status === "canceled") {
    return {
      terminal: true,
      parsed: parseHermesEventBlock(buildStatusEventBlock(payload, "run.cancelled"), context),
    };
  }

  if (status === "failed") {
    return {
      terminal: true,
      parsed: parseHermesEventBlock(buildStatusEventBlock({
        ...payload,
        error: payload.error ?? { message: "Hermes encerrou o run sem concluir." },
      }, "run.failed"), context),
    };
  }

  return { terminal: false, parsed: null };
};
