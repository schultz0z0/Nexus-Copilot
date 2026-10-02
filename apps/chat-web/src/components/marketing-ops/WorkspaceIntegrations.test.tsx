// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceIntegrations } from "./WorkspaceIntegrations";
import type {
  WorkspaceClient,
  WorkspaceConnection,
} from "@/lib/marketingOps/workspace";
const connection: WorkspaceConnection = {
  service: "google_drive",
  status: "prepared",
  configured: true,
  version: 3,
  generation: 1,
  identity: null,
  selectedResource: null,
  resources: [],
  safeError: null,
  lastSyncAt: null,
};
const api = (overrides: Partial<WorkspaceClient> = {}) =>
  ({
    connections: vi.fn().mockResolvedValue({ data: [connection] }),
    apps: vi.fn().mockResolvedValue({ data: [] }),
    authorize: vi
      .fn()
      .mockResolvedValue({
        data: {
          url: "https://accounts.google.com/o/oauth2/v2/auth?state=opaque",
        },
      }),
    resources: vi
      .fn()
      .mockResolvedValue({
        data: {
          items: [
            { id: "folder1", name: "Marketing", kind: "folder", url: null },
          ],
          nextPage: null,
          truncated: false,
        },
      }),
    selectResource: vi.fn().mockResolvedValue({ data: {} }),
    disconnect: vi.fn().mockResolvedValue({ data: {} }),
    ...overrides,
  }) as unknown as WorkspaceClient;
function mount(client: WorkspaceClient, manage = true, redirect = vi.fn(), entry = '/') {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[entry]}>
        <WorkspaceIntegrations
          api={client}
          canManage={manage}
          canConfigure={false}
          redirect={redirect}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
describe("Workspace connections", () => {
  it('explains failed authorization callbacks even when the service is not known', async () => {
    mount(api(), true, vi.fn(), '/settings/integrations?tab=workspace&result=api_disabled');
    expect(await screen.findByText('Habilite a API deste serviço no projeto Google da empresa e conecte novamente.')).toBeTruthy();
  });
  it("opens actual consent in one click without asking end users for secrets", async () => {
    const client = api();
    const redirect = vi.fn();
    mount(client, true, redirect);
    await userEvent.click(
      await screen.findByRole("button", { name: "Conectar Google Drive" }),
    );
    expect(client.authorize).toHaveBeenCalledWith(
      "google_drive",
      3,
      expect.any(String),
      false,
    );
    expect(redirect).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Segredo do aplicativo")).toBeNull();
  });
  it("does not claim connection for unprepared services", async () => {
    mount(
      api({
        connections: vi
          .fn()
          .mockResolvedValue({
            data: [{ ...connection, configured: false, status: "unprepared" }],
          }),
      }),
    );
    await screen.findByText("Aguardando configuração");
    expect(
      screen.queryByRole("button", { name: "Conectar Google Drive" }),
    ).toBeNull();
  });
  it("requires a reviewed resource and observed version before selecting", async () => {
    const client = api({
      connections: vi
        .fn()
        .mockResolvedValue({
          data: [{ ...connection, status: "pending_resource" }],
        }),
    });
    mount(client);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Escolher recurso Google Drive",
      }),
    );
    await user.click(await screen.findByLabelText("Selecionar Marketing"));
    expect(client.selectResource).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar recurso" }));
    await waitFor(() =>
      expect(client.selectResource).toHaveBeenCalledWith(
        "google_drive",
        "folder1",
        3,
        expect.any(String),
        false,
      ),
    );
  });
  it("confirms disconnect and offers no member mutation controls", async () => {
    const client = api({
      connections: vi
        .fn()
        .mockResolvedValue({
          data: [
            {
              ...connection,
              status: "connected",
              selectedResource: {
                id: "1",
                name: "Marketing",
                kind: "folder",
                url: null,
              },
              identity: { id: "me", email: "me@example.com", name: "Me" },
            },
          ],
        }),
    });
    mount(client);
    await userEvent.click(
      await screen.findByRole("button", { name: "Desconectar Google Drive" }),
    );
    expect(client.disconnect).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar desconexão" }),
    );
    await waitFor(() => expect(client.disconnect).toHaveBeenCalledOnce());
    cleanup();
    mount(api(), false);
    await screen.findByRole("heading", { name: "Google Drive" });
    expect(
      screen.queryByRole("button", { name: /Conectar Google Drive/ }),
    ).toBeNull();
  });
});
