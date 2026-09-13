import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { extractAttachmentText } from "./attachment-text.js";

export const CHAT_ATTACHMENT_BUCKET = "chat-attachments";
export const CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60 * 30;
export const CHAT_ATTACHMENT_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_COUNT = 4;

export const CHAT_ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "text/ecmascript",
  "application/ecmascript",
  "application/json",
  "application/rtf",
  "text/rtf",
]);

const normalizeSupabaseUrl = (value) => {
  const url = new URL(value);
  return url.toString().replace(/\/$/, "");
};

const encodeStoragePath = (storagePath) =>
  storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const hasSuspiciousPathSegments = (storagePath) =>
  storagePath.includes("..") || storagePath.includes("\\") || storagePath.startsWith("/") || storagePath.endsWith("/");

const encodeBase64 = (bytes) => Buffer.from(bytes).toString("base64");

const buildInlineDataUrl = (mimeType, bytes) => `data:${mimeType};base64,${encodeBase64(bytes)}`;

const INPUT_IMAGE_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
  ["image/svg+xml", "svg"],
]);

const sanitizePathSegment = (value, fallback = "item") => {
  const sanitized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._=-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);

  return sanitized || fallback;
};

const fileNameFromAttachment = (attachment) => {
  const rawName = String(attachment.name ?? "").split(/[\\/]/).pop() || "image";
  const safeName = sanitizePathSegment(rawName, "image");
  if (/\.[a-z0-9]{2,8}$/i.test(safeName)) return safeName;
  const extension = INPUT_IMAGE_EXTENSIONS.get(attachment.mime_type) || "png";
  return `${safeName}.${extension}`;
};

const toHermesPosixPath = (...segments) =>
  path.posix.join(...segments.map((segment) => String(segment).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")));

const materializeHermesImageInput = async ({
  attachment,
  bytes,
  sessionId,
  sharedImageBridgeDir,
  sharedImageHermesDir,
}) => {
  if (attachment.kind !== "image" || !sharedImageBridgeDir || !sharedImageHermesDir) {
    return null;
  }

  const sessionSegment = sanitizePathSegment(sessionId, "session");
  const fileName = `${randomUUID()}-${fileNameFromAttachment(attachment)}`;
  const bridgeDir = path.join(sharedImageBridgeDir, sessionSegment);
  const bridgePath = path.join(bridgeDir, fileName);
  const hermesRoot = String(sharedImageHermesDir).replace(/\\/g, "/").replace(/\/+$/g, "");
  const hermesPath = `${hermesRoot}/${toHermesPosixPath(sessionSegment, fileName)}`;

  await mkdir(bridgeDir, { recursive: true });
  await writeFile(bridgePath, Buffer.from(bytes));

  return {
    bridge_image_path: bridgePath,
    hermes_image_path: hermesPath,
  };
};

const buildStorageHeaders = ({ supabaseAnonKey, supabaseServiceRoleKey, userToken }) => {
  const key = supabaseServiceRoleKey || supabaseAnonKey;
  const bearer = supabaseServiceRoleKey || userToken;
  if (!key || !bearer) {
    throw new Error("missing_supabase_storage_credentials");
  }

  return {
    apikey: key,
    Authorization: `Bearer ${bearer}`,
  };
};

const toAbsoluteSignedUrl = (supabaseUrl, value) => {
  if (!value || typeof value !== "string") {
    throw new Error("attachment_signed_url_failed");
  }
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value, supabaseUrl).toString();
};

const parseSignedUrlPayload = (payload) =>
  payload?.signedUrl ?? payload?.signedURL ?? payload?.signed_url ?? payload?.data?.signedUrl ?? payload?.data?.signedURL;

export const assertAttachmentAccess = ({ attachment, userId, sessionId }) => {
  const mimeType = String(attachment.mime_type ?? "").trim().toLowerCase();
  if (!CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error("invalid_attachment_mime");
  }

  const normalizedPath = String(attachment.storage_path ?? "").trim();
  if (attachment.artifact_id || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedPath)) {
    return;
  }

  if (!normalizedPath || hasSuspiciousPathSegments(normalizedPath)) {
    throw new Error("invalid_attachment_path");
  }

  const expectedPrefix = `${userId}/${sessionId}/`;
  if (!normalizedPath.startsWith(expectedPrefix)) {
    throw new Error("forbidden_attachment");
  }
};

const readAttachmentBytes = async ({ supabaseUrl, bucket, storagePath, headers, fetchImpl }) => {
  const response = await fetchImpl(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(storagePath)}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`attachment_fetch_failed:${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > CHAT_ATTACHMENT_MAX_DOWNLOAD_BYTES) {
    throw new Error("attachment_too_large");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > CHAT_ATTACHMENT_MAX_DOWNLOAD_BYTES) {
    throw new Error("attachment_too_large");
  }

  return bytes;
};

const createAttachmentSignedUrl = async ({ supabaseUrl, bucket, storagePath, headers, fetchImpl }) => {
  const response = await fetchImpl(`${supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeStoragePath(storagePath)}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`attachment_signed_url_failed:${response.status}`);
  }

  return toAbsoluteSignedUrl(supabaseUrl, parseSignedUrlPayload(payload));
};

const readArtifactBytes = async ({ artifactInternalUrl, artifactId, internalKey, fetchImpl = fetch }) => {
  const response = await fetchImpl(`${artifactInternalUrl.replace(/\/$/, "")}/v1/artifacts/${encodeURIComponent(artifactId)}/content`, {
    headers: internalKey ? { Authorization: `Bearer ${internalKey}` } : {},
  });
  if (!response.ok) throw new Error(`attachment_fetch_failed:${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > CHAT_ATTACHMENT_MAX_DOWNLOAD_BYTES) {
    throw new Error("attachment_too_large");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > CHAT_ATTACHMENT_MAX_DOWNLOAD_BYTES) {
    throw new Error("attachment_too_large");
  }
  return bytes;
};

const createArtifactSignedUrl = async ({ artifactInternalUrl, artifactId, userId, internalKey, fetchImpl = fetch }) => {
  const response = await fetchImpl(`${artifactInternalUrl.replace(/\/$/, "")}/v1/artifacts/${encodeURIComponent(artifactId)}/access-link`, {
    method: "POST",
    headers: {
      ...(internalKey ? { Authorization: `Bearer ${internalKey}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ owner_id: userId, expires_in_seconds: CHAT_ATTACHMENT_SIGNED_URL_TTL_SECONDS }),
  });
  if (!response.ok) throw new Error(`attachment_signed_url_failed:${response.status}`);
  const payload = await response.json();
  return payload.url;
};

const normalizeAttachment = (attachment) => ({
  kind: attachment?.kind === "image" ? "image" : "file",
  name: String(attachment?.name ?? "").trim() || "arquivo",
  mime_type: String(attachment?.mime_type ?? "").trim().toLowerCase(),
  storage_path: String(attachment?.storage_path ?? attachment?.artifact_id ?? "").trim(),
  artifact_id: String(attachment?.artifact_id ?? "").trim() || null,
});

export const prepareHermesAttachments = async ({
  attachments,
  userId,
  sessionId,
  supabaseUrl,
  supabaseAnonKey = "",
  supabaseServiceRoleKey = "",
  userToken = "",
  bucket = CHAT_ATTACHMENT_BUCKET,
  artifactInternalUrl = process.env.ARTIFACT_INTERNAL_URL || "http://localhost:8095",
  artifactInternalKey = process.env.ARTIFACT_INTERNAL_KEY || "",
  sharedImageBridgeDir = process.env.HERMES_IMAGE_INPUTS_BRIDGE_DIR || "",
  sharedImageHermesDir = process.env.HERMES_IMAGE_INPUTS_HERMES_DIR || "",
  fetchImpl = fetch,
}) => {
  const normalizedAttachments = Array.isArray(attachments) ? attachments.map(normalizeAttachment) : [];
  if (normalizedAttachments.length > CHAT_ATTACHMENT_MAX_COUNT) {
    throw new Error("too_many_attachments");
  }
  if (normalizedAttachments.length === 0) return [];

  const normalizedSupabaseUrl = supabaseUrl ? normalizeSupabaseUrl(supabaseUrl) : null;
  const headers = (supabaseUrl && (supabaseServiceRoleKey || supabaseAnonKey || userToken))
    ? buildStorageHeaders({ supabaseAnonKey, supabaseServiceRoleKey, userToken })
    : {};

  return await Promise.all(normalizedAttachments.map(async (attachment) => {
    assertAttachmentAccess({ attachment, userId, sessionId });

    const isArtifact = Boolean(attachment.artifact_id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attachment.storage_path);
    const artifactId = attachment.artifact_id || attachment.storage_path;

    let bytes;
    let signedUrl;

    if (isArtifact) {
      [bytes, signedUrl] = await Promise.all([
        readArtifactBytes({
          artifactInternalUrl,
          artifactId,
          internalKey: artifactInternalKey,
          fetchImpl,
        }),
        createArtifactSignedUrl({
          artifactInternalUrl,
          artifactId,
          userId,
          internalKey: artifactInternalKey,
          fetchImpl,
        }),
      ]);
    } else {
      if (!normalizedSupabaseUrl) throw new Error("missing_SUPABASE_URL");
      [bytes, signedUrl] = await Promise.all([
        readAttachmentBytes({
          supabaseUrl: normalizedSupabaseUrl,
          bucket,
          storagePath: attachment.storage_path,
          headers,
          fetchImpl,
        }),
        createAttachmentSignedUrl({
          supabaseUrl: normalizedSupabaseUrl,
          bucket,
          storagePath: attachment.storage_path,
          headers,
          fetchImpl,
        }),
      ]);
    }

    const extractedText = extractAttachmentText(attachment, bytes);
    const hermesImageInput = await materializeHermesImageInput({
      attachment,
      bytes,
      sessionId,
      sharedImageBridgeDir,
      sharedImageHermesDir,
    });

    return {
      ...attachment,
      signed_url: signedUrl,
      original_signed_url: signedUrl,
      inline_data_url: buildInlineDataUrl(attachment.mime_type, bytes),
      ...(hermesImageInput ?? {}),
      ...(extractedText ? { extracted_text: extractedText } : {}),
    };
  }));
};
