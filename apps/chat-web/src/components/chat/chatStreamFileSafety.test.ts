import { describe, expect, it } from "vitest";

import {
  isAllowedStreamFileUrl,
  isSafeRenderableImage,
  isSafeRenderableVideo,
  parseAllowedStreamFileHosts,
} from "./chatStreamFileSafety";

describe("isAllowedStreamFileUrl", () => {
  it("aceita arquivo do host permitido", () => {
    expect(
      isAllowedStreamFileUrl("https://murxwqdevpwjtnnuzzxi.supabase.co/storage/v1/object/sign/chat-attachments/file.png", [
        "murxwqdevpwjtnnuzzxi.supabase.co",
      ]),
    ).toBe(true);
  });

  it("rejeita url externa fora da allowlist", () => {
    expect(
      isAllowedStreamFileUrl("https://evil.example/file.png", ["murxwqdevpwjtnnuzzxi.supabase.co"]),
    ).toBe(false);
  });

  it("aceita http apenas para hosts locais permitidos", () => {
    expect(isAllowedStreamFileUrl("http://127.0.0.1:8095/v1/artifacts/file/content?token=abc", ["127.0.0.1"])).toBe(
      true,
    );
    expect(isAllowedStreamFileUrl("http://cdn.example/file.png", ["cdn.example"])).toBe(false);
  });
});

describe("parseAllowedStreamFileHosts", () => {
  it("aceita hosts extras configurados como urls completas ou hosts puros", () => {
    expect(
      parseAllowedStreamFileHosts(
        "https://jhbakzkqamgddphwakjj.supabase.co, nexus-ai-ens.vercel.app https://cdn.example/assets",
      ),
    ).toEqual(["jhbakzkqamgddphwakjj.supabase.co", "nexus-ai-ens.vercel.app", "cdn.example"]);
  });
});

describe("isSafeRenderableImage", () => {
  it("nao renderiza svg remoto diretamente", () => {
    expect(isSafeRenderableImage({ kind: "image", name: "vector.svg", mimeType: "image/svg+xml" })).toBe(false);
  });
});

describe("isSafeRenderableVideo", () => {
  it("renderiza formatos de video comuns", () => {
    expect(isSafeRenderableVideo({ name: "demo.mp4", mimeType: "video/mp4" })).toBe(true);
    expect(isSafeRenderableVideo({ name: "demo.webm", mimeType: "video/webm" })).toBe(true);
  });

  it("rejeita formatos nao reconhecidos como preview de video", () => {
    expect(isSafeRenderableVideo({ name: "demo.zip", mimeType: "application/zip" })).toBe(false);
  });
});
