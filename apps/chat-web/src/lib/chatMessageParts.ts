export type ChatMessageTextPart = {
  id: string;
  type: "text";
  text: string;
  format?: "markdown" | "plain";
};

export type ChatMessageFilePart = {
  id: string;
  type: "file";
  kind: "image" | "file";
  name: string;
  url: string;
  mimeType?: string;
  storagePath?: string;
  storageBucket?: string;
  signedUrlExpiresAt?: string;
  artifactId?: string;
  artifactSize?: number;
  artifactSha256?: string;
  originalUrl?: string;
};

export type ChatMessageArtifactPart = {
  id: string;
  type: "artifact";
  artifactType: "code" | "markdown" | "html" | "text";
  title: string;
  content: string;
  language?: string;
  fileName?: string;
};

export type ChatMessageStatusPart = {
  id: string;
  type: "status";
  text: string;
  tone?: "info" | "success" | "warning";
};

export type ChatMessagePart =
  | ChatMessageTextPart
  | ChatMessageFilePart
  | ChatMessageArtifactPart
  | ChatMessageStatusPart;

type StructuredChatMessagePayload = {
  v: 2;
  parts: ChatMessagePart[];
};

type LegacyStoredAttachment = {
  kind: "image" | "file";
  name: string;
  url: string;
};

const STRUCTURED_MESSAGE_START = "[[NEXUS_CHAT_MESSAGE]]";
const STRUCTURED_MESSAGE_END = "[[/NEXUS_CHAT_MESSAGE]]";
const LEGACY_ATTACHMENTS_START = "[[ATTACHMENTS]]";
const LEGACY_ATTACHMENTS_END = "[[/ATTACHMENTS]]";
const fileExtensionPattern = /\.([a-z0-9]+)(?:[?#].*)?$/i;

export const createChatPartId = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createTextPart = (text: string, format: "markdown" | "plain" = "markdown"): ChatMessageTextPart => ({
  id: createChatPartId(),
  type: "text",
  text,
  format,
});

export const createFilePart = (
  data: Omit<ChatMessageFilePart, "id" | "type">,
): ChatMessageFilePart => ({
  id: createChatPartId(),
  type: "file",
  ...data,
});

export const createArtifactPart = (
  data: Omit<ChatMessageArtifactPart, "id" | "type">,
): ChatMessageArtifactPart => ({
  id: createChatPartId(),
  type: "artifact",
  ...data,
});

export const createStatusPart = (
  text: string,
  tone: ChatMessageStatusPart["tone"] = "info",
): ChatMessageStatusPart => ({
  id: createChatPartId(),
  type: "status",
  text,
  tone,
});

export const getFileExtension = (nameOrUrl: string) => {
  const match = nameOrUrl.match(fileExtensionPattern);
  return match?.[1]?.toLowerCase() ?? "";
};

export const isImageResource = (nameOrUrl: string, mimeType?: string) => {
  if (mimeType?.startsWith("image/")) return true;
  const ext = getFileExtension(nameOrUrl);
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"].includes(ext);
};

export const guessFileNameFromUrl = (url: string, fallback = "arquivo") => {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.split("/").filter(Boolean);
    const last = pathname[pathname.length - 1];
    return decodeURIComponent(last ?? fallback);
  } catch {
    return fallback;
  }
};

const sanitizeParts = (parts: ChatMessagePart[]) => {
  return parts.filter((part) => {
    if (part.type === "text") return part.text.trim().length > 0;
    if (part.type === "status") return part.text.trim().length > 0;
    if (part.type === "artifact") return part.content.trim().length > 0;
    return part.url.trim().length > 0 && part.name.trim().length > 0;
  });
};

const parseStructuredMessage = (raw: string) => {
  const pattern = new RegExp(
    `${STRUCTURED_MESSAGE_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n([\\s\\S]*?)\\n${STRUCTURED_MESSAGE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  const match = raw.match(pattern);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1] ?? "") as StructuredChatMessagePayload;
    if (!parsed || parsed.v !== 2 || !Array.isArray(parsed.parts)) return null;
    return sanitizeParts(parsed.parts);
  } catch {
    return null;
  }
};

const parseLegacyAttachments = (raw: string) => {
  const pattern = new RegExp(
    `${LEGACY_ATTACHMENTS_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n([\\s\\S]*?)\\n${LEGACY_ATTACHMENTS_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  const match = raw.match(pattern);
  if (!match) return null;

  let attachments: LegacyStoredAttachment[] = [];
  try {
    const parsed = JSON.parse(match[1] ?? "") as { items?: LegacyStoredAttachment[] };
    attachments = Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    attachments = [];
  }

  const text = raw.replace(match[0], "").trim();
  const parts: ChatMessagePart[] = [];
  if (text) parts.push(createTextPart(text));
  attachments.forEach((attachment) => {
    parts.push(
      createFilePart({
        kind: attachment.kind,
        name: attachment.name,
        url: attachment.url,
      }),
    );
  });

  return parts;
};

export const parseChatMessageContent = (raw: string): ChatMessagePart[] => {
  const structured = parseStructuredMessage(raw);
  if (structured) return structured;

  const legacy = parseLegacyAttachments(raw);
  if (legacy) return legacy;

  const trimmed = raw.trim();
  return trimmed ? [createTextPart(trimmed)] : [];
};

export const serializeChatMessageContent = (parts: ChatMessagePart[]) => {
  const cleaned = sanitizeParts(parts);
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1 && cleaned[0].type === "text") {
    return cleaned[0].text;
  }

  const payload: StructuredChatMessagePayload = {
    v: 2,
    parts: cleaned,
  };

  return `${STRUCTURED_MESSAGE_START}\n${JSON.stringify(payload)}\n${STRUCTURED_MESSAGE_END}`;
};

export const getPlainTextFromParts = (parts: ChatMessagePart[]) => {
  return parts
    .filter((part): part is ChatMessageTextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
};

export const replaceStatusParts = (
  parts: ChatMessagePart[],
  nextStatus: ChatMessageStatusPart | null,
) => {
  const withoutStatus = parts.filter((part) => part.type !== "status");
  return nextStatus ? [...withoutStatus, nextStatus] : withoutStatus;
};
