import { describe, expect, it } from "vitest";

import { shouldShowPendingAssistantIndicator } from "./chatStreamingUx";

describe("shouldShowPendingAssistantIndicator", () => {
  it("mantem o indicador visivel enquanto a resposta do assistente ainda nao tem conteudo renderizavel", () => {
    expect(
      shouldShowPendingAssistantIndicator({
        isTyping: true,
        activeStreamingMessageId: "assistant-1",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            content: "",
          },
        ],
      }),
    ).toBe(true);
  });

  it("remove o indicador quando a resposta do assistente ja ficou visivel", () => {
    expect(
      shouldShowPendingAssistantIndicator({
        isTyping: true,
        activeStreamingMessageId: "assistant-1",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            content: "Primeiras palavras da resposta",
          },
        ],
      }),
    ).toBe(false);
  });

  it("mantem o indicador enquanto a requisicao segue em andamento e a bolha ainda nao foi criada", () => {
    expect(
      shouldShowPendingAssistantIndicator({
        isTyping: true,
        activeStreamingMessageId: null,
        messages: [],
      }),
    ).toBe(true);
  });
});
