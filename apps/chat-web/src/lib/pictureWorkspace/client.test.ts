import { describe, expect, it, vi } from "vitest";

import { createPictureWorkspaceClient, PictureWorkspaceApiError } from "./client";

const workspace = { id: "workspace-1", chat_session_id: "session-1", status: "drafting" };

describe("Picture workspace client", () => {
  it("covers current, details, files, approve and new piece with Supabase bearer", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/files")) return Response.json({ files: [{ id: "file-1" }] });
      if (String(url).endsWith("/access-link")) return Response.json({ url: "https://files/file-1", expires_at: "2099-01-01T00:00:00Z" });
      return Response.json({ workspace });
    });
    const client = createPictureWorkspaceClient({
      baseUrl: "https://bridge.example/",
      getAccessToken: async () => "supabase-token",
      fetch: fetchMock,
    });
    const signal = new AbortController().signal;

    await client.current(signal);
    await client.details("workspace-1", signal);
    await client.files("workspace-1", signal);
    await client.approve("workspace-1", signal);
    await client.newPiece("workspace-1", signal);
    await client.accessFile("file-1", signal);

    expect(calls.map(({ url, init }) => [init.method ?? "GET", url])).toEqual([
      ["POST", "https://bridge.example/api/picture/workspace/current"],
      ["GET", "https://bridge.example/api/picture/workspaces/workspace-1"],
      ["GET", "https://bridge.example/api/picture/workspaces/workspace-1/files"],
      ["POST", "https://bridge.example/api/picture/workspaces/workspace-1/approve"],
      ["POST", "https://bridge.example/api/picture/workspaces/workspace-1/new-piece"],
      ["POST", "https://bridge.example/api/artifacts/file-1/access-link"],
    ]);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer supabase-token");
    expect(calls.every(({ init }) => init.signal === signal)).toBe(true);
  });

  it("maps known codes to safe Portuguese messages", async () => {
    const client = createPictureWorkspaceClient({
      baseUrl: "https://bridge.example",
      getAccessToken: async () => "token",
      fetch: async () => Response.json({ error: "picture_approval_required" }, { status: 409 }),
    });

    await expect(client.newPiece("workspace-1")).rejects.toMatchObject<Partial<PictureWorkspaceApiError>>({
      code: "picture_approval_required",
      status: 409,
      message: "Aprove a peça final antes de criar uma nova.",
    });
  });

  it("fails before fetch when there is no authenticated session", async () => {
    const fetchMock = vi.fn();
    const client = createPictureWorkspaceClient({ baseUrl: "https://bridge.example", getAccessToken: async () => null, fetch: fetchMock });
    await expect(client.current()).rejects.toMatchObject({ code: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
