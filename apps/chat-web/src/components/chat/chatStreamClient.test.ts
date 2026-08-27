import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-id", () => ({
  getTenantContext: vi.fn(async () => ({
    "X-Tenant-Id": "ens",
    "X-User-Id": "user-1",
  })),
}));

import { sendMessageToChatbotStream } from "./chatStreamClient";

const jsonResponse = (payload: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

describe("sendMessageToChatbotStream", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("recovers completed run events from snapshot when the events stream fetch fails", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_CHAT_STREAM_FILE_HOSTS", "arquivos.solucoes-nexus.tech");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ run: { id: "run-1" } }, { status: 202 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        jsonResponse({
          run: {
            status: "completed",
            events: [
              { event: "delta", data: "Imagem pronta." },
              {
                event: "files",
                data: {
                  files: [
                    {
                      name: "render.png",
                      url: "https://arquivos.solucoes-nexus.tech/v1/artifacts/artifact-1/content?token=abc",
                      kind: "image",
                      mimeType: "image/png",
                      artifact_id: "artifact-1",
                    },
                  ],
                },
              },
              { event: "done", data: {} },
            ],
          },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    const files: unknown[] = [];

    const promise = sendMessageToChatbotStream({
      payload: { session_id: "chat-1", message_text: "gere uma imagem" },
      getAccessToken: async () => "token-1",
      refreshAccessToken: async () => null,
      signOut: async () => {},
      resolveChatbotProxyBaseUrl: () => "https://bridge.solucoes-nexus.tech",
      onDelta: (delta) => deltas.push(delta),
      onFiles: (items) => files.push(...items),
    });

    await vi.runAllTimersAsync();
    await promise;

    expect(deltas).toEqual(["Imagem pronta."]);
    expect(files).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("adds tenant and user context headers to chat run requests", async () => {
    const doneStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: done\ndata: {}\n\n"));
        controller.close();
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ run: { id: "run-1" } }, { status: 202 }))
      .mockResolvedValueOnce(new Response(doneStream, { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    await sendMessageToChatbotStream({
      payload: { session_id: "chat-1", message_text: "teste" },
      getAccessToken: async () => "token-1",
      refreshAccessToken: async () => null,
      signOut: async () => {},
      resolveChatbotProxyBaseUrl: () => "https://bridge.solucoes-nexus.tech",
      onDelta: () => {},
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer token-1",
      "Content-Type": "application/json",
      "X-Tenant-Id": "ens",
      "X-User-Id": "user-1",
    });
  });
});
