// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMail } from "./WorkspaceTools";
import type {
  WorkspaceClient,
  WorkspaceConnection,
} from "@/lib/marketingOps/workspace";
const connection: WorkspaceConnection = {
  service: "google_gmail",
  configured: true,
  status: "connected",
  version: 4,
  generation: 1,
  identity: { id: "1", email: "me@example.com", name: "Me" },
  selectedResource: {
    id: "me",
    name: "Minha caixa",
    kind: "mailbox",
    url: null,
  },
  resources: [],
  safeError: null,
  lastSyncAt: null,
};
afterEach(cleanup);
describe("Reviewed mail sends", () => {
  it("creates an editable reviewed draft, then requires a separate explicit send", async () => {
    const api = {
      messages: vi
        .fn()
        .mockResolvedValue({
          data: { items: [], nextPage: null, truncated: false },
        }),
      createDraft: vi
        .fn()
        .mockResolvedValue({
          data: {
            id: "draft1",
            to: ["client@example.com"],
            subject: "Briefing",
            text: "Confira o briefing.",
          },
        }),
      sendDraft: vi
        .fn()
        .mockResolvedValue({ data: { status: "uncertain", id: "receipt1" } }),
    } as unknown as WorkspaceClient;
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <WorkspaceMail connection={connection} api={api} canManage />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Nova mensagem" }));
    await user.type(
      screen.getByLabelText("Destinatários"),
      "client@example.com",
    );
    await user.type(screen.getByLabelText("Assunto"), "Briefing");
    await user.type(screen.getByLabelText("Mensagem"), "Confira o briefing.");
    await user.click(screen.getByRole("button", { name: "Revisar rascunho" }));
    expect(api.createDraft).not.toHaveBeenCalled();
    expect(api.sendDraft).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Salvar rascunho no provedor" }),
    );
    await screen.findByRole("button", { name: "Confirmar envio agora" });
    expect(api.sendDraft).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Confirmar envio agora" }),
    );
    await waitFor(() =>
      expect(api.sendDraft).toHaveBeenCalledWith(
        "google_gmail",
        "draft1",
        4,
        expect.any(String),
        undefined,
      ),
    );
    await screen.findByText(/Não repita o envio/);
    expect(
      screen.queryByRole("button", { name: "Confirmar envio agora" }),
    ).toBeNull();
  });
});
