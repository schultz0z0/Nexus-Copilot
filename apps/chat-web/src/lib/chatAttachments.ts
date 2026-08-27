import { z } from "zod";

import {
  createFilePart,
  parseChatMessageContent,
  serializeChatMessageContent,
  type ChatMessageFilePart,
} from "@/lib/chatMessageParts";
import {
  buildUnsupportedAttachmentMessage,
  isChatAttachmentSupportedInCurrentStage,
  normalizeChatAttachmentMimeType,
} from "@/lib/chatAttachmentPolicy";
import { supabase } from "@/lib/supabase";

const DEFAULT_CHAT_ATTACHMENTS_BUCKET =
  ((import.meta.env.VITE_CHAT_ATTACHMENTS_BUCKET || import.meta.env.NEXT_PUBLIC_CHAT_ATTACHMENTS_BUCKET) as
    | string
    | undefined) ?? "chat-attachments";
const DEFAULT_GENERATED_IMAGES_BUCKET =
  ((import.meta.env.VITE_SUPABASE_OUTPUTS_BUCKET || import.meta.env.NEXT_PUBLIC_SUPABASE_OUTPUTS_BUCKET) as
    | string
    | undefined) ?? "image-gen-outputs";
const DEFAULT_GENERATED_IMAGES_PREFIX =
  ((import.meta.env.VITE_SUPABASE_GENERATED_IMAGES_PREFIX ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_GENERATED_IMAGES_PREFIX) as string | undefined) ??
  "hermes-chat-images";

export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 15;
const SIGNED_URL_REFRESH_WINDOW_MS = 60 * 1000;

const attachmentFileSchema = z.object({
  name: z.string().trim().min(1, "Nome do arquivo obrigatorio."),
  size: z.number().int().positive().max(MAX_CHAT_ATTACHMENT_BYTES, "Arquivo acima do limite."),
  type: z.string().trim().optional().default(""),
});

export type ChatAttachmentLike = {
  file: File;
  kind: "image" | "file";
};

type UploadedAttachmentResult = {
  storedParts: ChatMessageFilePart[];
};

type UploadChatAttachmentsParams = {
  attachments: ChatAttachmentLike[];
  sessionId: string;
  userId: string;
  bucket?: string;
};

const getFileExtension = (fileName: string) => {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
};

const isAttachmentTypeAllowed = (file: File) => {
  const extension = getFileExtension(file.name);
  const mimeType = normalizeChatAttachmentMimeType(file.type, extension);
  return isChatAttachmentSupportedInCurrentStage(mimeType, extension);
};

export const resolveChatAttachmentBucket = ({
  storageBucket,
  storagePath,
  fallbackBucket,
}: {
  storageBucket?: string;
  storagePath?: string;
  fallbackBucket?: string;
} = {}) => {
  const explicitBucket = storageBucket?.trim() || fallbackBucket?.trim();
  if (explicitBucket) return explicitBucket;

  const normalizedPath = storagePath?.trim() ?? "";
  const generatedPrefix = DEFAULT_GENERATED_IMAGES_PREFIX.trim().replace(/^\/+|\/+$/g, "");
  if (generatedPrefix && normalizedPath.startsWith(`${generatedPrefix}/`)) {
    return DEFAULT_GENERATED_IMAGES_BUCKET;
  }

  return DEFAULT_CHAT_ATTACHMENTS_BUCKET;
};

const getAttachmentBucket = (bucket?: string) => resolveChatAttachmentBucket({ fallbackBucket: bucket });

const mapStorageError = (error: string) => {
  if (error.includes("Bucket not found")) {
    return "Bucket de anexos do chat nao configurado no Supabase.";
  }

  return error;
};

export const validateAttachmentFile = (file: File) => {
  const parsed = attachmentFileSchema.safeParse({
    name: file.name,
    size: file.size,
    type: file.type,
  });

  if (!parsed.success) {
    const sizeIssue = parsed.error.issues.find((issue) => issue.path[0] === "size");
    if (sizeIssue) {
      return {
        success: false as const,
        error: `${file.name} excede o limite de 10MB.`,
      };
    }

    return {
      success: false as const,
      error: `Nao foi possivel validar o arquivo ${file.name}.`,
    };
  }

  if (!isAttachmentTypeAllowed(file)) {
    return {
      success: false as const,
      error: buildUnsupportedAttachmentMessage(file.name),
    };
  }

  return {
    success: true as const,
    data: parsed.data,
  };
};

export const buildChatAttachmentPath = ({
  userId,
  sessionId,
  fileName,
  now = Date.now(),
}: {
  userId: string;
  sessionId: string;
  fileName: string;
  now?: number;
}) => {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}/${sessionId}/${now}-${safeName}`;
};

const escapeMarkdownText = (text: string) => text.replace(/\[/g, "\\[").replace(/\]/g, "\\]");

export const buildChatAttachmentMarkdown = ({
  kind,
  name,
  url,
}: Pick<ChatMessageFilePart, "kind" | "name" | "url">) => {
  if (kind === "image") {
    return `![${escapeMarkdownText(name)}](${url})`;
  }

  return `- [${escapeMarkdownText(name)}](${url})`;
};

export const buildSignedUrlExpiresAt = ({
  now = Date.now(),
  expiresInSeconds = SIGNED_URL_EXPIRES_IN_SECONDS,
}: {
  now?: number;
  expiresInSeconds?: number;
}) => new Date(now + expiresInSeconds * 1000).toISOString();

export const shouldRefreshSignedUrl = (
  signedUrlExpiresAt?: string,
  {
    now = Date.now(),
    refreshWindowMs = SIGNED_URL_REFRESH_WINDOW_MS,
  }: {
    now?: number;
    refreshWindowMs?: number;
  } = {},
) => {
  if (!signedUrlExpiresAt) {
    return true;
  }

  const expiresAt = Date.parse(signedUrlExpiresAt);
  if (Number.isNaN(expiresAt)) {
    return true;
  }

  return expiresAt - now <= refreshWindowMs;
};

const createSignedAttachmentUrl = async (path: string, bucket?: string) => {
  const activeBucket = getAttachmentBucket(bucket);
  const { data, error } = await supabase.storage
    .from(activeBucket)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(mapStorageError(error?.message ?? "Nao foi possivel gerar a URL assinada do anexo."));
  }

  return {
    signedUrl: data.signedUrl,
    signedUrlExpiresAt: buildSignedUrlExpiresAt({}),
  };
};

export const refreshChatAttachmentUrl = async (part: ChatMessageFilePart, bucket?: string) => {
  if (!part.storagePath || !shouldRefreshSignedUrl(part.signedUrlExpiresAt)) {
    return part;
  }

  const activeBucket = resolveChatAttachmentBucket({
    storageBucket: bucket ?? part.storageBucket,
    storagePath: part.storagePath,
  });
  const { signedUrl, signedUrlExpiresAt } = await createSignedAttachmentUrl(part.storagePath, activeBucket);
  return {
    ...part,
    url: signedUrl,
    signedUrlExpiresAt,
    storageBucket: activeBucket,
  };
};

export const shouldHideTextImagePreview = ({
  textUrl,
  hasStructuredImagePart,
}: {
  textUrl: string;
  hasStructuredImagePart: boolean;
}) => {
  if (!hasStructuredImagePart) return false;

  try {
    const parsed = new URL(textUrl);
    const normalizedPath = parsed.pathname.replace(/^\/storage\/v1/, "");
    if (normalizedPath.startsWith("/v1/artifacts/")) return true;
    const generatedPrefix = DEFAULT_GENERATED_IMAGES_PREFIX.trim().replace(/^\/+|\/+$/g, "");
    return (
      normalizedPath.startsWith(`/object/sign/${DEFAULT_GENERATED_IMAGES_BUCKET}/${generatedPrefix}/`) ||
      normalizedPath.startsWith(`/object/public/${DEFAULT_GENERATED_IMAGES_BUCKET}/${generatedPrefix}/`)
    );
  } catch {
    return false;
  }
};

export const uploadChatAttachments = async ({
  attachments,
  sessionId,
  userId,
  bucket,
}: UploadChatAttachmentsParams): Promise<UploadedAttachmentResult> => {
  if (attachments.length === 0) {
    return { storedParts: [] };
  }

  const activeBucket = getAttachmentBucket(bucket);
  const storedParts: ChatMessageFilePart[] = [];

  for (const attachment of attachments) {
    const validation = validateAttachmentFile(attachment.file);
    if (!validation.success) {
      throw new Error(validation.error);
    }

    const normalizedMimeType = normalizeChatAttachmentMimeType(
      attachment.file.type,
      getFileExtension(attachment.file.name),
    );

    const storagePath = buildChatAttachmentPath({
      userId,
      sessionId,
      fileName: attachment.file.name,
    });

    const { error: uploadError } = await supabase.storage.from(activeBucket).upload(storagePath, attachment.file, {
      cacheControl: "3600",
      upsert: false,
    });

    if (uploadError) {
      throw new Error(mapStorageError(uploadError.message));
    }

    try {
      const { signedUrl, signedUrlExpiresAt } = await createSignedAttachmentUrl(storagePath, activeBucket);
      const storedPart = createFilePart({
        kind: attachment.kind,
        name: attachment.file.name,
        url: signedUrl,
        mimeType: normalizedMimeType || undefined,
        storagePath,
        storageBucket: activeBucket,
        signedUrlExpiresAt,
      });

      storedParts.push(storedPart);
    } catch (error) {
      await supabase.storage.from(activeBucket).remove([storagePath]);
      throw error;
    }
  }

  return {
    storedParts,
  };
};

export const refreshChatMessageAttachmentUrls = async (content: string) => {
  const parts = parseChatMessageContent(content);
  if (parts.length === 0) return content;

  let changed = false;
  const refreshedParts = await Promise.all(
    parts.map(async (part) => {
      if (part.type !== "file" || !part.storagePath) {
        return part;
      }

      if (!shouldRefreshSignedUrl(part.signedUrlExpiresAt)) {
        return part;
      }

      const refreshedPart = await refreshChatAttachmentUrl(part);
      if (refreshedPart.url === part.url && refreshedPart.signedUrlExpiresAt === part.signedUrlExpiresAt) {
        return part;
      }

      changed = true;
      return refreshedPart;
    }),
  );

  return changed ? serializeChatMessageContent(refreshedParts) : content;
};
