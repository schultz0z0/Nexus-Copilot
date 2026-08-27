export type ChatTextRenderMode = "markdown" | "plain";

export const STREAMING_MARKDOWN_RENDER_LIMIT = 4_000;

export const getTextRenderMode = ({
  role,
  isStreaming,
  textLength,
}: {
  role: "user" | "assistant";
  isStreaming: boolean;
  textLength: number;
}): ChatTextRenderMode => {
  if (role === "assistant" && isStreaming && textLength > STREAMING_MARKDOWN_RENDER_LIMIT) {
    return "plain";
  }

  return "markdown";
};

export const shouldExtractTextImagePreviews = ({
  role,
  isStreaming,
}: {
  role: "user" | "assistant";
  isStreaming: boolean;
}) => role === "assistant" && !isStreaming;

export const getStreamingRenderFrameDelayMs = (queuedLength: number) => {
  if (queuedLength > 4_000) return 32;
  if (queuedLength > 1_000) return 48;
  return 72;
};

export const getStreamingRenderChunkSize = (queuedLength: number) => {
  if (queuedLength > 4_000) return 1_200;
  if (queuedLength > 1_000) return 640;
  if (queuedLength > 240) return 260;
  return Math.max(80, queuedLength);
};
