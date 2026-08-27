// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PictureWorkspaceFile } from "@/lib/pictureWorkspace/types";
import { PictureFilesPanel } from "./PictureFilesPanel";

afterEach(() => cleanup());

const file = (overrides: Partial<PictureWorkspaceFile>): PictureWorkspaceFile => ({
  id: "file-1", filename: "brief.json", relative_path: "brief/brief.json", category: "brief",
  content_type: "application/json", lifecycle: "workspace", ...overrides,
});

describe("PictureFilesPanel", () => {
  it("groups categories and previews JSON/text, images and unknown downloads", async () => {
    const files = [
      file({ id: "json", filename: "brief.json", category: "brief" }),
      file({ id: "text", filename: "prompt.txt", relative_path: "prompt/prompt.txt", category: "prompt", content_type: "text/plain" }),
      file({ id: "image", filename: "peca.png", relative_path: "final/peca.png", category: "final", content_type: "image/png" }),
      file({ id: "zip", filename: "pacote.zip", relative_path: "intermediate/pacote.zip", category: "intermediate", content_type: "application/zip" }),
    ];
    const resolveAccessUrl = vi.fn(async (selected: PictureWorkspaceFile) => ({ url: `https://files/${selected.id}`, expiresAt: "2099-01-01T00:00:00Z" }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.endsWith("/json") ? '{"course":"graduação"}' : "prompt final")));
    const user = userEvent.setup();
    render(<PictureFilesPanel files={files} candidateArtifactId="image" resolveAccessUrl={resolveAccessUrl} />);

    expect(screen.getByText("Briefing")).toBeTruthy();
    expect(screen.getByText("Peça final")).toBeTruthy();
    await user.click(screen.getByText("brief.json"));
    await waitFor(() => expect(screen.getByText(/"course": "graduação"/)).toBeTruthy());
    await user.click(screen.getByText("prompt.txt"));
    await waitFor(() => expect(screen.getByText("prompt final")).toBeTruthy());
    await user.click(screen.getByText("peca.png"));
    expect((await screen.findByRole("img", { name: "peca.png" })).getAttribute("src")).toBe("https://files/image");
    await user.click(screen.getByText("pacote.zip"));
    expect((await screen.findByRole("link", { name: /Abrir arquivo/ })).getAttribute("href")).toBe("https://files/zip");
  });

  it("refreshes an expired image URL and renders loading and errors", async () => {
    const resolveAccessUrl = vi.fn()
      .mockResolvedValueOnce({ url: "https://files/expired", expiresAt: "2020-01-01T00:00:00Z" })
      .mockResolvedValueOnce({ url: "https://files/fresh", expiresAt: "2099-01-01T00:00:00Z" });
    const image = file({ id: "image", filename: "peca.png", category: "final", content_type: "image/png" });
    const { rerender } = render(<PictureFilesPanel files={[image]} candidateArtifactId="image" resolveAccessUrl={resolveAccessUrl} />);
    fireEvent.click(screen.getByText("peca.png"));
    const preview = await screen.findByRole("img", { name: "peca.png" });
    fireEvent.error(preview);
    await waitFor(() => expect(resolveAccessUrl).toHaveBeenLastCalledWith(image, true));

    rerender(<PictureFilesPanel files={[]} isLoading resolveAccessUrl={resolveAccessUrl} />);
    expect(screen.getByText(/Carregando arquivos/)).toBeTruthy();
    rerender(<PictureFilesPanel files={[]} error={new Error("offline")} resolveAccessUrl={resolveAccessUrl} />);
    expect(screen.getByText(/Não foi possível carregar/)).toBeTruthy();
  });

  it("selects the newest candidate when a revision changes candidateArtifactId", async () => {
    const first = file({
      id: "final-v1",
      artifact_id: "artifact-v1",
      filename: "peca.png",
      relative_path: "final/peca.png",
      category: "final",
      content_type: "image/png",
      created_at: "2026-07-29T12:00:00.000Z",
    });
    const second = file({
      id: "final-v2",
      artifact_id: "artifact-v2",
      filename: "peca.png",
      relative_path: "final/peca.png",
      category: "final",
      content_type: "image/png",
      created_at: "2026-07-29T12:05:00.000Z",
    });
    const resolveAccessUrl = vi.fn(async (selected: PictureWorkspaceFile) => ({
      url: `https://files/${selected.id}`,
      expiresAt: "2099-01-01T00:00:00Z",
    }));
    const { rerender } = render(
      <PictureFilesPanel
        files={[first]}
        candidateArtifactId="artifact-v1"
        resolveAccessUrl={resolveAccessUrl}
      />,
    );
    expect((await screen.findByRole("img", { name: "peca.png" })).getAttribute("src"))
      .toBe("https://files/final-v1");

    rerender(
      <PictureFilesPanel
        files={[first, second]}
        candidateArtifactId="artifact-v2"
        resolveAccessUrl={resolveAccessUrl}
      />,
    );

    await waitFor(() => expect(
      screen.getByRole("img", { name: "peca.png" }).getAttribute("src"),
    ).toBe("https://files/final-v2"));
  });

  it("adds stable version labels to files with duplicate names", () => {
    const resolveAccessUrl = vi.fn();
    render(<PictureFilesPanel
      files={[
        file({
          id: "plan-v2",
          filename: "composition-plan.json",
          category: "plan",
          created_at: "2026-07-29T12:05:00.000Z",
        }),
        file({
          id: "plan-v1",
          filename: "composition-plan.json",
          category: "plan",
          created_at: "2026-07-29T12:00:00.000Z",
        }),
      ]}
      resolveAccessUrl={resolveAccessUrl}
    />);

    expect(screen.getByText("composition-plan.json (v1)")).toBeTruthy();
    expect(screen.getByText("composition-plan.json (v2)")).toBeTruthy();
    expect(screen.queryByText("Peça final")).toBeNull();
  });
});
