// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ValidatedWork } from "@/lib/validatedWorks";
import { ValidatedVisualWorkCard } from "./ValidatedVisualWorkCard";

afterEach(() => cleanup());

const work: ValidatedWork = {
  id: "work-1", tenant_id: "ens", artifact_type: "peca_visual", title: "Graduação ENS",
  content: '{"artifact_id":"artifact-1","internal":"não renderizar"}', status: "validated",
  artifact_id: "artifact-1", artifact_filename: "graduacao.png", artifact_mime_type: "image/png",
  artifact_width: 1080, artifact_height: 1350, validated_by_name: "Raphael", validated_at: "2026-07-21T00:00:00Z",
};

describe("ValidatedVisualWorkCard", () => {
  it("requests a signed Bridge URL, shows thumbnail/dimensions, preview and download without rendering content", async () => {
    const fetchMock = vi.fn(async () => Response.json({ url: "https://files/graduacao", expires_at: "2099-01-01T00:00:00Z" }));
    const user = userEvent.setup();
    render(<ValidatedVisualWorkCard work={work} bridgeBaseUrl="https://bridge.example/" accessToken="supabase-token" fetchImpl={fetchMock} />);

    const thumbnail = await screen.findByRole("img", { name: "Graduação ENS" });
    expect(thumbnail.getAttribute("src")).toBe("https://files/graduacao");
    expect(screen.getByText("1080 × 1350 px")).toBeTruthy();
    expect(screen.queryByText(/não renderizar/)).toBeNull();
    expect((await screen.findByRole("link", { name: /Baixar/ })).getAttribute("download")).toBe("graduacao.png");
    expect(new Headers(vi.mocked(fetchMock).mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer supabase-token");

    await user.click(thumbnail);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByRole("img", { name: "Graduação ENS" })).toBeTruthy();
  });

  it("renews expired URLs and falls back safely when the artifact is unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ url: "https://files/expired", expires_at: "2020-01-01T00:00:00Z" }))
      .mockResolvedValueOnce(Response.json({ url: "https://files/fresh", expires_at: "2099-01-01T00:00:00Z" }));
    const { rerender } = render(<ValidatedVisualWorkCard work={work} bridgeBaseUrl="https://bridge.example" accessToken="token" fetchImpl={fetchMock} />);
    const image = await screen.findByRole("img", { name: "Graduação ENS" });
    await waitFor(() => expect(image.getAttribute("src")).toBe("https://files/fresh"));
    fireEvent.error(image);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3));

    const unavailable = vi.fn(async () => Response.json({ error: "artifact_not_found" }, { status: 404 }));
    rerender(<ValidatedVisualWorkCard work={{ ...work, id: "work-2" }} bridgeBaseUrl="https://bridge.example" accessToken="token" fetchImpl={unavailable} />);
    await waitFor(() => expect(screen.getByText(/Peça indisponível/)).toBeTruthy());
  });
});
