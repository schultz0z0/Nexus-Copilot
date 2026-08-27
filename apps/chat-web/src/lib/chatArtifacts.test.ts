import { describe, expect, it } from "vitest";

import { createFilePart } from "./chatMessageParts";
import { refreshArtifactFileUrl } from "./chatArtifacts";

describe("chatArtifacts", () => {
  it("mantem artifact com URL assinada ainda valida", async () => {
    const part = createFilePart({
      kind: "image",
      name: "banner.png",
      url: "https://arquivos.example/v1/artifacts/artifact-1/content?token=old",
      artifactId: "artifact-1",
      signedUrlExpiresAt: "2026-06-19T12:30:00.000Z",
    });

    const refreshed = await refreshArtifactFileUrl(part, {
      now: Date.parse("2026-06-19T12:00:00.000Z"),
      fetchImpl: async () => {
        throw new Error("fetch should not be reached");
      },
      getAccessToken: async () => "token",
      chatbotProxyBaseUrl: "https://bridge.example",
    });

    expect(refreshed).toBe(part);
  });

  it("renova artifact expirado pela bridge autenticada", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const part = createFilePart({
      kind: "file",
      name: "app.zip",
      url: "https://arquivos.example/v1/artifacts/artifact-1/content?token=old",
      artifactId: "artifact-1",
      signedUrlExpiresAt: "2026-06-19T12:00:30.000Z",
    });

    const refreshed = await refreshArtifactFileUrl(part, {
      now: Date.parse("2026-06-19T12:00:00.000Z"),
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json({
          url: "https://arquivos.example/v1/artifacts/artifact-1/content?token=new",
          expires_at: "2026-06-19T12:15:00.000Z",
        });
      },
      getAccessToken: async () => "user-token",
      chatbotProxyBaseUrl: "https://bridge.example/",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://bridge.example/api/artifacts/artifact-1/access-link");
    expect(requests[0].init?.method).toBe("POST");
    expect((requests[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
    expect(refreshed.url).toBe("https://arquivos.example/v1/artifacts/artifact-1/content?token=new");
    expect(refreshed.signedUrlExpiresAt).toBe("2026-06-19T12:15:00.000Z");
  });
});
