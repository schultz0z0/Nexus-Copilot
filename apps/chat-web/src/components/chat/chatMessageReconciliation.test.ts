import { describe, expect, it } from "vitest";

import { reconcileHydratedMessages } from "./chatMessageReconciliation";

describe("reconcileHydratedMessages", () => {
  it("preserva a resposta otimista em streaming quando o banco ainda nao persistiu o assistant", () => {
    const result = reconcileHydratedMessages({
      currentMessages: [
        {
          id: "user-temp",
          role: "user",
          content: "Analise a imagem",
          created_at: "2026-05-29T10:00:00.000Z",
        },
        {
          id: "assistant-stream",
          role: "assistant",
          content: "Claro, estou analisando",
          created_at: "2026-05-29T10:00:01.000Z",
        },
      ],
      hydratedMessages: [
        {
          id: "user-db",
          role: "user",
          content: "Analise a imagem",
          created_at: "2026-05-29T10:00:00.000Z",
        },
      ],
      activeStreamingMessageId: "assistant-stream",
    });

    expect(result).toEqual([
      {
        id: "user-db",
        role: "user",
        content: "Analise a imagem",
        created_at: "2026-05-29T10:00:00.000Z",
      },
      {
        id: "assistant-stream",
        role: "assistant",
        content: "Claro, estou analisando",
        created_at: "2026-05-29T10:00:01.000Z",
      },
    ]);
  });

  it("nao duplica mensagem otimista quando o banco ja persistiu um equivalente", () => {
    const result = reconcileHydratedMessages({
      currentMessages: [
        {
          id: "assistant-stream",
          role: "assistant",
          content: "Resposta final",
          created_at: "2026-05-29T10:00:01.000Z",
        },
      ],
      hydratedMessages: [
        {
          id: "assistant-db",
          role: "assistant",
          content: "Resposta final",
          created_at: "2026-05-29T10:00:01.500Z",
        },
      ],
      activeStreamingMessageId: "assistant-stream",
    });

    expect(result).toEqual([
      {
        id: "assistant-db",
        role: "assistant",
        content: "Resposta final",
        created_at: "2026-05-29T10:00:01.500Z",
      },
    ]);
  });
});
