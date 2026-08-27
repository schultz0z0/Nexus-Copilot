import {
  createFilePart,
  guessFileNameFromUrl,
  type ChatMessageFilePart,
  type ChatMessagePart,
} from "@/lib/chatMessageParts";
import { isAllowedStreamFileUrl, isSafeRenderableImage } from "./chatStreamFileSafety";

const httpsUrlPattern = /https:\/\/[^\s<>"'`)\]]+/gi;
const trailingPunctuationPattern = /[.,;:!?]+$/g;

const normalizeExtractedUrl = (url: string) => url.trim().replace(trailingPunctuationPattern, "");

export const createRenderableImagePreviewPartFromUrl = (
  url: string,
  allowedHosts?: string[],
): ChatMessageFilePart | null => {
  const normalizedUrl = normalizeExtractedUrl(url);
  if (!normalizedUrl || !isAllowedStreamFileUrl(normalizedUrl, allowedHosts)) return null;

  const name = guessFileNameFromUrl(normalizedUrl, "imagem");
  const part = createFilePart({
    kind: "image",
    name,
    url: normalizedUrl,
  });

  return isSafeRenderableImage(part) ? part : null;
};

export const extractRenderableImagePreviewsFromParts = (
  parts: ChatMessagePart[],
  allowedHosts?: string[],
) => {
  const seenUrls = new Set(
    parts
      .filter((part): part is ChatMessageFilePart => part.type === "file")
      .map((part) => part.url.trim())
      .filter(Boolean),
  );
  const previews: ChatMessageFilePart[] = [];

  parts.forEach((part) => {
    if (part.type !== "text") return;

    for (const match of part.text.matchAll(httpsUrlPattern)) {
      const preview = createRenderableImagePreviewPartFromUrl(match[0], allowedHosts);
      if (!preview || seenUrls.has(preview.url)) continue;

      seenUrls.add(preview.url);
      previews.push(preview);
    }
  });

  return previews;
};
