import { describe, expect, it } from "vitest";

import {
  CHAT_COMPOSER_ACCEPTED_FILE_TYPES,
  CHAT_PROXY_MAX_ATTACHMENTS,
  CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES,
  chatAttachmentStageLabel,
  normalizeChatAttachmentMimeType,
  isChatAttachmentSupportedInCurrentStage,
} from "./chatAttachmentPolicy";

describe("chatAttachmentPolicy", () => {
  it("expõe o limite de anexos alinhado ao proxy", () => {
    expect(CHAT_PROXY_MAX_ATTACHMENTS).toBe(4);
  });

  it("aceita documentos e arquivos de codigo/texto nesta etapa", () => {
    expect(CHAT_COMPOSER_ACCEPTED_FILE_TYPES).toBe("image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.md,.txt,.html,.htm,.css,.js,.json,.rtf");
    expect(isChatAttachmentSupportedInCurrentStage("image/png", "png")).toBe(true);
    expect(isChatAttachmentSupportedInCurrentStage("application/pdf", "pdf")).toBe(true);
    expect(isChatAttachmentSupportedInCurrentStage("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx")).toBe(true);
    expect(isChatAttachmentSupportedInCurrentStage("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx")).toBe(true);
    expect(isChatAttachmentSupportedInCurrentStage("application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx")).toBe(true);
    expect(isChatAttachmentSupportedInCurrentStage("text/html", "html")).toBe(true);
    expect(isChatAttachmentSupportedInCurrentStage("text/css", "css")).toBe(true);
    expect(isChatAttachmentSupportedInCurrentStage("text/javascript", "js")).toBe(true);
    expect(isChatAttachmentSupportedInCurrentStage("application/json", "json")).toBe(true);
    expect(isChatAttachmentSupportedInCurrentStage("text/csv", "csv")).toBe(true);
  });

  it("mantem exatamente os mesmos MIME types aceitos pelo bucket", () => {
    expect(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("application/vnd.ms-excel");
    expect(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("text/html");
    expect(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("text/css");
    expect(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("text/javascript");
    expect(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("application/javascript");
    expect(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("application/x-javascript");
    expect(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("application/json");
    expect(CHAT_SUPPORTED_ATTACHMENT_MIME_TYPES).toContain("text/csv");
  });

  it("normaliza MIME type vazio a partir da extensao quando o browser nao preenche file.type", () => {
    expect(normalizeChatAttachmentMimeType("", "md")).toBe("text/markdown");
    expect(normalizeChatAttachmentMimeType("", "csv")).toBe("text/csv");
    expect(normalizeChatAttachmentMimeType("", "pptx")).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(normalizeChatAttachmentMimeType("", "html")).toBe("text/html");
    expect(normalizeChatAttachmentMimeType("", "css")).toBe("text/css");
    expect(normalizeChatAttachmentMimeType("", "js")).toBe("text/javascript");
    expect(normalizeChatAttachmentMimeType("", "json")).toBe("application/json");
    expect(normalizeChatAttachmentMimeType("", "rtf")).toBe("application/rtf");
  });

  it("expõe o rótulo da etapa atual para mensagens de UX", () => {
    expect(chatAttachmentStageLabel()).toBe("imagens, PDF e documentos");
  });
});
