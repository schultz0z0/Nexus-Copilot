// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PictureWorkspace, PictureWorkspaceClient } from "@/lib/pictureWorkspace/types";
import { usePictureWorkspace } from "./usePictureWorkspace";

const makeWorkspace = (id: string, status: PictureWorkspace["status"]): PictureWorkspace => ({
  id, status, chat_session_id: `session-${id}`, tenant_id: "ens", user_id: "user-1", title: "Peça",
  active: true, version: 1, candidate_artifact_id: null, validated_artifact_id: null,
  validated_work_id: null, created_at: "2026-07-21T00:00:00Z", updated_at: "2026-07-21T00:00:00Z",
});

const setup = (status: PictureWorkspace["status"] = "drafting") => {
  let current = makeWorkspace("one", status);
  const client: PictureWorkspaceClient = {
    current: vi.fn(async () => current),
    details: vi.fn(async () => current),
    files: vi.fn(async () => [{ id: "file-1", filename: "brief.json", relative_path: "brief/brief.json", category: "brief", content_type: "application/json", lifecycle: "workspace" }]),
    approve: vi.fn(async () => { current = { ...current, status: "validated" }; return current; }),
    newPiece: vi.fn(async () => { current = makeWorkspace("two", "drafting"); return current; }),
    accessFile: vi.fn(async () => ({ url: "https://files/test", expiresAt: "2099-01-01T00:00:00Z" })),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { client, wrapper };
};

describe("usePictureWorkspace", () => {
  it.each(["drafting", "review", "validated"] as const)("hydrates files without polling the stable %s state", async (status) => {
    const { client, wrapper } = setup(status);
    const { result } = renderHook(() => usePictureWorkspace({ client, pollingMs: 10 }), { wrapper });
    await waitFor(() => expect(result.current.workspace?.id).toBe("one"));
    await waitFor(() => expect(result.current.files).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(client.details).toHaveBeenCalledTimes(1);
  });

  it("polls while generating and refreshes after chat activity", async () => {
    const { client, wrapper } = setup("generating");
    const { result } = renderHook(() => usePictureWorkspace({ client, pollingMs: 10 }), { wrapper });
    await waitFor(() => expect(result.current.workspace?.status).toBe("generating"));
    await waitFor(() => expect(vi.mocked(client.details).mock.calls.length).toBeGreaterThanOrEqual(2));
    const before = vi.mocked(client.files).mock.calls.length;
    await act(async () => { await result.current.refresh(); });
    expect(vi.mocked(client.files).mock.calls.length).toBeGreaterThan(before);
  });

  it("updates approval and swaps workspace while clearing selection", async () => {
    const { client, wrapper } = setup("review");
    const { result } = renderHook(() => usePictureWorkspace({ client, pollingMs: 10 }), { wrapper });
    await waitFor(() => expect(result.current.workspace?.status).toBe("review"));
    act(() => result.current.setSelectedFileId("file-1"));
    await act(async () => { await result.current.approve(); });
    await waitFor(() => expect(result.current.workspace?.status).toBe("validated"));
    await act(async () => { await result.current.newPiece(); });
    await waitFor(() => expect(result.current.workspace?.id).toBe("two"));
    expect(result.current.selectedFileId).toBeNull();
  });

  it("keeps previous data when a refresh fails", async () => {
    const { client, wrapper } = setup("review");
    const { result } = renderHook(() => usePictureWorkspace({ client, pollingMs: 10 }), { wrapper });
    await waitFor(() => expect(result.current.workspace?.id).toBe("one"));
    vi.mocked(client.details).mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.workspace?.id).toBe("one");
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
