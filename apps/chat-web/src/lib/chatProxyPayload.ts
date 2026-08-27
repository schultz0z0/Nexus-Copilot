import { z } from "zod";

import { normalizeChatAttachmentMimeType } from "@/lib/chatAttachmentPolicy";
import type { ChatMessageFilePart } from "@/lib/chatMessageParts";

const chatProxyAttachmentSchema = z.object({
  kind: z.enum(["image", "file"]),
  name: z.string().trim().min(1),
  mimeType: z.string().trim().min(1),
  storagePath: z.string().trim().min(1),
});

const imageGenerationOptionsSchema = z.object({
  quality: z.enum(["auto", "low", "medium", "high"]),
  size: z.enum([
    "auto",
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "2048x2048",
    "2048x1152",
    "1152x2048",
    "2560x1440",
    "1440x2560",
    "3840x2160",
    "2160x3840",
  ]),
  outputFormat: z.enum(["png", "jpeg", "webp"]),
});

export type ChatProxyAttachmentPayload = {
  kind: "image" | "file";
  name: string;
  mime_type: string;
  storage_path: string;
};

export type ChatImageGenerationOptions = z.infer<typeof imageGenerationOptionsSchema>;

export type ChatProxyImageOptionsPayload = {
  quality: ChatImageGenerationOptions["quality"];
  size: ChatImageGenerationOptions["size"];
  output_format: ChatImageGenerationOptions["outputFormat"];
};

export type ChatProxyPayload = {
  session_id: string;
  message_text: string;
  attachments?: ChatProxyAttachmentPayload[];
  intent?: "image_generate";
  image_options?: ChatProxyImageOptionsPayload;
  experience?: "picture";
  picture_workspace_id?: string;
};

type BuildChatProxyPayloadParams = {
  sessionId: string;
  messageText: string;
  attachments: ChatMessageFilePart[];
  imageGeneration?: ChatImageGenerationOptions | null;
  experience?: "normal" | "picture";
  pictureWorkspaceId?: string;
};

const mapAttachmentForProxy = (attachment: ChatMessageFilePart): ChatProxyAttachmentPayload => {
  const parsed = chatProxyAttachmentSchema.safeParse({
    kind: attachment.kind,
    name: attachment.name,
    mimeType: normalizeChatAttachmentMimeType(attachment.mimeType ?? "", attachment.name.split(".").pop() ?? ""),
    storagePath: attachment.storagePath,
  });

  if (!parsed.success) {
    throw new Error(`Nao foi possivel preparar o anexo ${attachment.name} para o Hermes.`);
  }

  return {
    kind: parsed.data.kind,
    name: parsed.data.name,
    mime_type: parsed.data.mimeType,
    storage_path: parsed.data.storagePath,
  };
};

export const buildChatProxyPayload = ({
  sessionId,
  messageText,
  attachments,
  imageGeneration,
  experience = "normal",
  pictureWorkspaceId,
}: BuildChatProxyPayloadParams): ChatProxyPayload => {
  const trimmedMessage = messageText.trim();
  const normalizedSessionId = sessionId.trim();

  const payload: ChatProxyPayload = {
    session_id: normalizedSessionId,
    message_text: trimmedMessage,
  };

  if (attachments.length > 0) {
    payload.attachments = attachments.map(mapAttachmentForProxy);
  }

  if (imageGeneration) {
    const parsed = imageGenerationOptionsSchema.safeParse(imageGeneration);
    if (!parsed.success) {
      throw new Error("Nao foi possivel preparar as opcoes de imagem para o Hermes.");
    }

    payload.intent = "image_generate";
    payload.image_options = {
      quality: parsed.data.quality,
      size: parsed.data.size,
      output_format: parsed.data.outputFormat,
    };
  }

  if (experience === "picture") {
    const workspaceId = pictureWorkspaceId?.trim();
    if (!workspaceId) {
      throw new Error("Workspace Picture inválido.");
    }
    delete payload.intent;
    delete payload.image_options;
    payload.experience = "picture";
    payload.picture_workspace_id = workspaceId;
  }

  return payload;
};
