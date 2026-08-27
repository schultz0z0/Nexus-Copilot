import { describe, expect, it } from "vitest";

import {
  buildChatAttachmentMarkdown,
  buildChatAttachmentPath,
  buildSignedUrlExpiresAt,
  resolveChatAttachmentBucket,
  shouldHideTextImagePreview,
  shouldRefreshSignedUrl,
  validateAttachmentFile,
} from "./chatAttachments";

describe("chatAttachments", () => {
  it("monta o path com user e session e sanitiza o nome do arquivo", () => {
    expect(
      buildChatAttachmentPath({
        userId: "user-123",
        sessionId: "session-456",
        fileName: "imagem final (1).png",
        now: 1700000000000,
      }),
    ).toBe("user-123/session-456/1700000000000-imagem_final__1_.png");
  });

  it("gera markdown de imagem e escapa colchetes no nome", () => {
    expect(
      buildChatAttachmentMarkdown({
        kind: "image",
        name: "foto [final].png",
        url: "https://example.com/foto.png",
      }),
    ).toBe("![foto \\[final\\].png](https://example.com/foto.png)");
  });

  it("rejeita arquivo acima do limite de upload", () => {
    const file = new File(["conteudo"], "grande.png", {
      type: "image/png",
    });
    Object.defineProperty(file, "size", { value: 11 * 1024 * 1024 });

    const result = validateAttachmentFile(file);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("O arquivo acima do limite nao deveria ser aceito.");
    }
    expect(result.error).toBe("grande.png excede o limite de 10MB.");
  });

  it("aceita formatos documentais reabertos no contrato atual do chat", () => {
    const file = new File(["conteudo"], "documento.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const result = validateAttachmentFile(file);

    expect(result.success).toBe(true);
  });

  it("gera expiresAt com base no ttl da signed url", () => {
    expect(buildSignedUrlExpiresAt({ now: 1_700_000_000_000, expiresInSeconds: 900 })).toBe(
      "2023-11-14T22:28:20.000Z",
    );
  });

  it("nao renova signed url ainda valida fora da janela de refresh", () => {
    expect(
      shouldRefreshSignedUrl("2026-05-28T17:30:00.000Z", {
        now: Date.parse("2026-05-28T17:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("renova signed url quando ela estiver ausente ou perto de expirar", () => {
    expect(shouldRefreshSignedUrl(undefined)).toBe(true);
    expect(
      shouldRefreshSignedUrl("2026-05-28T17:00:30.000Z", {
        now: Date.parse("2026-05-28T17:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("infere o bucket de imagens geradas quando mensagens antigas nao trazem storageBucket", () => {
    expect(resolveChatAttachmentBucket({ storagePath: "hermes-chat-images/nexus-chat/image.png" })).toBe(
      "image-gen-outputs",
    );
  });

  it("nao cria preview textual extra quando ja existe imagem estruturada na mensagem", () => {
    expect(
      shouldHideTextImagePreview({
        textUrl: "https://project.supabase.co/storage/v1/object/sign/image-gen-outputs/hermes-chat-images/nexus/image.png?token=old",
        hasStructuredImagePart: true,
      }),
    ).toBe(true);

    expect(
      shouldHideTextImagePreview({
        textUrl: "https://example.com/public-image.png",
        hasStructuredImagePart: false,
      }),
    ).toBe(false);
  });

  it("nao cria preview textual extra para artifact quando ja existe imagem estruturada", () => {
    expect(
      shouldHideTextImagePreview({
        textUrl: "https://arquivos.solucoes-nexus.tech/v1/artifacts/artifact-1/content?token=abc",
        hasStructuredImagePart: true,
      }),
    ).toBe(true);
  });
});
