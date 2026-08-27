import { describe, expect, it } from "vitest";

import { createFilePart } from "@/lib/chatMessageParts";

import { buildChatProxyPayload } from "./chatProxyPayload";

describe("buildChatProxyPayload", () => {
  it("serializa imagem e pdf em attachments estruturados sem markdown no texto", () => {
    const result = buildChatProxyPayload({
      sessionId: "session-1",
      messageText: "analise estes anexos",
      attachments: [
        createFilePart({
          kind: "image",
          name: "imagem.png",
          url: "https://signed-url/image",
          mimeType: "image/png",
          storagePath: "user-1/session-1/imagem.png",
        }),
        createFilePart({
          kind: "file",
          name: "arquivo.pdf",
          url: "https://signed-url/pdf",
          mimeType: "application/pdf",
          storagePath: "user-1/session-1/arquivo.pdf",
        }),
      ],
    });

    expect(result).toEqual({
      session_id: "session-1",
      message_text: "analise estes anexos",
      attachments: [
        {
          kind: "image",
          name: "imagem.png",
          mime_type: "image/png",
          storage_path: "user-1/session-1/imagem.png",
        },
        {
          kind: "file",
          name: "arquivo.pdf",
          mime_type: "application/pdf",
          storage_path: "user-1/session-1/arquivo.pdf",
        },
      ],
    });
  });

  it("nao serializa signed_url no payload do cliente", () => {
    const payload = buildChatProxyPayload({
      sessionId: "session-1",
      messageText: "analise",
      attachments: [
        createFilePart({
          kind: "image",
          name: "imagem.png",
          url: "https://signed-url/image",
          mimeType: "image/png",
          storagePath: "user-1/session-1/imagem.png",
        }),
      ],
    });

    expect(payload.attachments?.[0]).not.toHaveProperty("signed_url");
  });

  it("serializa opcoes do modo gerar imagem sem misturar no texto do usuario", () => {
    const payload = buildChatProxyPayload({
      sessionId: "session-1",
      messageText: "crie uma imagem para uma campanha da ENS",
      attachments: [],
      imageGeneration: {
        quality: "high",
        size: "2560x1440",
        outputFormat: "webp",
      },
    });

    expect(payload).toEqual({
      session_id: "session-1",
      message_text: "crie uma imagem para uma campanha da ENS",
      intent: "image_generate",
      image_options: {
        quality: "high",
        size: "2560x1440",
        output_format: "webp",
      },
    });
  });

  it("rejeita attachment sem storagePath ou mimeType valido", () => {
    expect(() =>
      buildChatProxyPayload({
        sessionId: "session-1",
        messageText: "analise",
        attachments: [
          createFilePart({
            kind: "image",
            name: "imagem.png",
            url: "https://signed-url/image",
          }),
        ],
      }),
    ).toThrow("Nao foi possivel preparar o anexo imagem.png para o Hermes.");
  });

  it("adds Picture routing only when the Picture experience is explicit", () => {
    const normal = buildChatProxyPayload({
      sessionId: "session-1",
      messageText: "gere uma peça",
      attachments: [],
    });
    const picture = buildChatProxyPayload({
      sessionId: "session-2",
      messageText: "gere uma peça",
      attachments: [],
      experience: "picture",
      pictureWorkspaceId: "workspace-1",
    });

    expect(normal).toEqual({ session_id: "session-1", message_text: "gere uma peça" });
    expect(picture).toEqual({
      session_id: "session-2",
      message_text: "gere uma peça",
      experience: "picture",
      picture_workspace_id: "workspace-1",
    });
  });
});
