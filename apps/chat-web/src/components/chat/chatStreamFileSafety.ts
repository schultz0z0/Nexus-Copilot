import { getFileExtension } from "@/lib/chatMessageParts";

const SAFE_RENDERABLE_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]);
const SAFE_RENDERABLE_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov"]);
const SAFE_RENDERABLE_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/ogg", "video/quicktime"]);

export const parseAllowedStreamFileHosts = (rawValue: string | undefined | null) => {
  if (!rawValue) return [];

  const hosts = new Set<string>();
  rawValue
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      try {
        const normalizedValue = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        const host = new URL(normalizedValue).hostname.toLowerCase();
        if (host) hosts.add(host);
      } catch {
        // ignore invalid env entries in client helper
      }
    });

  return Array.from(hosts);
};

export const getAllowedStreamFileHosts = () => {
  const hosts = new Set<string>();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (supabaseUrl) {
    try {
      hosts.add(new URL(supabaseUrl).hostname.toLowerCase());
    } catch {
      // ignore invalid env in client helper
    }
  }

  parseAllowedStreamFileHosts(import.meta.env.VITE_CHAT_STREAM_FILE_HOSTS as string | undefined).forEach((host) => {
    hosts.add(host);
  });

  if (typeof window !== "undefined" && window.location.hostname) {
    hosts.add(window.location.hostname.toLowerCase());
  }

  return Array.from(hosts);
};

export const isAllowedStreamFileUrl = (url: string, allowedHosts = getAllowedStreamFileHosts()) => {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (!allowedHosts.includes(hostname)) return false;
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") {
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    }
    return false;
  } catch {
    return false;
  }
};

export const isSafeRenderableImage = ({
  kind,
  name,
  mimeType,
}: {
  kind: "image" | "file";
  name: string;
  mimeType?: string;
}) => {
  if (kind !== "image") return false;
  if (mimeType === "image/svg+xml") return false;
  const extension = getFileExtension(name);
  return SAFE_RENDERABLE_IMAGE_EXTENSIONS.has(extension);
};

export const isSafeRenderableVideo = ({
  name,
  mimeType,
}: {
  name: string;
  mimeType?: string;
}) => {
  const normalizedMimeType = mimeType?.split(";")[0]?.trim().toLowerCase();
  const extension = getFileExtension(name);
  if (normalizedMimeType && SAFE_RENDERABLE_VIDEO_MIME_TYPES.has(normalizedMimeType)) return true;
  return SAFE_RENDERABLE_VIDEO_EXTENSIONS.has(extension);
};
