// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceCalendar, WorkspaceSheets } from "./WorkspaceTools";
import type {
  WorkspaceClient,
  WorkspaceConnection,
} from "@/lib/marketingOps/workspace";
import type { MarketingOpsCampaign } from "@/lib/marketingOps/types";
import { leadClient } from "@/lib/marketingOps/leads";
import { marketingOpsClient } from "@/lib/marketingOps/runtime";
const connection: WorkspaceConnection = {
  service: "google_calendar",
  configured: true,
  status: "connected",
  version: 4,
  generation: 1,
  identity: { id: "1", email: "me@example.com", name: "Me" },
  selectedResource: {
    id: "calendar",
    name: "Marketing",
    kind: "calendar",
    url: null,
    writable: true,
  },
  resources: [],
  safeError: null,
  lastSyncAt: null,
};
const campaign = {
  id: "e2d1b350-4a6d-4e07-b27e-85cf0b000001",
  name: "Lançamento",
  status: "active",
} as MarketingOpsCampaign;
const mount = (element: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {element}
    </QueryClientProvider>,
  );
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("Workspace human review", () => {
  it("publishes a calendar commitment only after preview and explicit confirmation", async () => {
    const api = {
      events: vi
        .fn()
        .mockResolvedValue({
          data: { items: [], nextPage: null, truncated: false },
        }),
      publishEvent: vi
        .fn()
        .mockResolvedValue({ data: { status: "completed", id: "receipt1" } }),
    } as unknown as WorkspaceClient;
    mount(<WorkspaceCalendar connection={connection} api={api} canManage />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Novo compromisso" }));
    await user.type(
      screen.getByLabelText("Título do compromisso"),
      "Revisão de criativos",
    );
    fireEvent.change(screen.getByLabelText("Início"), {
      target: { value: "2026-10-10T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Término"), {
      target: { value: "2026-10-10T10:00" },
    });
    await user.click(
      screen.getByRole("button", { name: "Revisar compromisso" }),
    );
    expect(api.publishEvent).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Confirmar publicação" }),
    );
    await waitFor(() =>
      expect(api.publishEvent).toHaveBeenCalledWith(
        "google_calendar",
        expect.objectContaining({
          title: "Revisão de criativos",
          timeZone: expect.any(String),
        }),
        4,
        expect.any(String),
      ),
    );
    await screen.findByText("Compromisso publicado");
  });
  it("prefills a Brazilian currency result for review without registering a report", async () => {
    vi.spyOn(leadClient, "reports").mockResolvedValue({ data: [] });
    vi.spyOn(leadClient, "sources").mockResolvedValue({ data: [] });
    const create = vi.spyOn(leadClient, "createReport");
    vi.spyOn(marketingOpsClient, "listProductionSchedule").mockResolvedValue({
      data: [],
    });
    const api = {
      sheet: vi
        .fn()
        .mockResolvedValue({
          data: {
            name: "Relatório semanal",
            headers: ["Receita", "Enviados"],
            rows: [["R$ 1.234,56", "100"]],
            truncated: false,
          },
        }),
    } as unknown as WorkspaceClient;
    mount(
      <WorkspaceSheets
        connection={{ ...connection, service: "google_sheets" }}
        api={api}
        canManage
        campaign={campaign}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Mapear resultado semanal" }),
    );
    await user.selectOptions(screen.getByLabelText("Receita"), "1");
    await user.click(
      screen.getByRole("button", {
        name: "Continuar para revisão do relatório",
      }),
    );
    await screen.findByRole("heading", { name: "Novo relatório" });
    expect((screen.getByLabelText("Receita") as HTMLInputElement).value).toBe(
      "1234.56",
    );
    expect(create).not.toHaveBeenCalled();
  });
});
