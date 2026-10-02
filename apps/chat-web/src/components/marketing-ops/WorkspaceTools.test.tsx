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
import {
  WorkspaceCalendar,
  WorkspaceSheets,
  WorkspaceFiles,
} from "./WorkspaceTools";
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
  it("browses the Sheets library and opens different previews without replacing the integration", async () => {
    const resources = vi.fn().mockResolvedValue({
      data: {
        items: [
          { id: "sheet1", name: "Leads", kind: "spreadsheet", url: null },
          { id: "sheet2", name: "Resultados", kind: "spreadsheet", url: null },
        ],
        nextPage: null,
        truncated: false,
      },
    });
    const sheet = vi.fn(async (id: string) => ({
      data: {
        name: id === "sheet1" ? "Leads" : "Resultados",
        headers: ["Nome"],
        rows: [["Exemplo"]],
        truncated: false,
      },
    }));
    const selectResource = vi.fn();
    mount(
      <WorkspaceSheets
        connection={{
          ...connection,
          service: "google_sheets",
          selectedResource: {
            id: "root",
            name: "Todas as planilhas",
            kind: "folder",
            url: null,
          },
        }}
        api={{ resources, sheet, selectResource } as unknown as WorkspaceClient}
        canManage
      />,
    );
    expect(sheet).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Abrir planilha Leads" }),
    );
    await screen.findByRole("region", { name: "Prévia da planilha" });
    expect(sheet).toHaveBeenLastCalledWith("sheet1");
    await user.click(
      screen.getByRole("button", { name: "Todas as planilhas", exact: true }),
    );
    expect(
      screen.queryByRole("region", { name: "Prévia da planilha" }),
    ).toBeNull();
    await user.click(
      await screen.findByRole("button", { name: "Abrir planilha Resultados" }),
    );
    await screen.findByRole("region", { name: "Prévia da planilha" });
    expect(sheet).toHaveBeenLastCalledWith("sheet2");
    expect(selectResource).not.toHaveBeenCalled();
  });
  it("browses whole Drive with nested folder breadcrumbs and clears the search when changing folders", async () => {
    const files = vi.fn(
      async (
        _service: string,
        query: { parentId?: string; search?: string; page?: string },
      ) => ({
        data: {
          items:
            query.parentId === "nested"
              ? [
                  {
                    id: "doc",
                    name: "Brief.pdf",
                    kind: "file",
                    url: "https://drive.google.com/file/d/doc/view",
                  },
                ]
              : [
                  {
                    id: query.parentId === "marketing" ? "nested" : "marketing",
                    name:
                      query.parentId === "marketing"
                        ? "Criativos"
                        : "Marketing",
                    kind: "folder",
                    url: null,
                  },
                ],
          nextPage: "next",
          truncated: false,
        },
      }),
    );
    mount(
      <WorkspaceFiles
        connection={{
          ...connection,
          service: "google_drive",
          selectedResource: {
            id: "root",
            name: "Meu Drive inteiro",
            kind: "folder",
            url: null,
          },
        }}
        api={{ files } as unknown as WorkspaceClient}
        canManage
      />,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Abrir pasta" }),
    );
    await screen.findByText("Criativos");
    await user.type(screen.getByLabelText("Buscar arquivos"), "Criativos");
    await user.click(
      screen.getByRole("button", { name: "Buscar", exact: true }),
    );
    await waitFor(() =>
      expect(files).toHaveBeenLastCalledWith(
        "google_drive",
        expect.objectContaining({ parentId: "marketing", search: "Criativos" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Abrir pasta" }));
    await screen.findByText("Brief.pdf");
    expect(
      (screen.getByLabelText("Buscar arquivos") as HTMLInputElement).value,
    ).toBe("");
    const path = screen.getByRole("navigation", {
      name: "Caminho dos arquivos",
    });
    expect(path.textContent).toContain("Meu Drive inteiro");
    expect(path.textContent).toContain("Marketing");
    expect(path.textContent).toContain("Criativos");
    await user.click(
      screen.getByRole("button", { name: "Voltar para Marketing" }),
    );
    await waitFor(() =>
      expect(files).toHaveBeenLastCalledWith("google_drive", {
        parentId: "marketing",
        search: "",
        page: undefined,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Próxima página" }));
    await waitFor(() =>
      expect(files).toHaveBeenLastCalledWith(
        "google_drive",
        expect.objectContaining({ parentId: "marketing", page: "next" }),
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Voltar para Meu Drive inteiro" }),
    );
    await waitFor(() =>
      expect(files).toHaveBeenLastCalledWith("google_drive", {
        parentId: undefined,
        search: "",
        page: undefined,
      }),
    );
  });
  it("publishes a calendar commitment only after preview and explicit confirmation", async () => {
    const api = {
      events: vi.fn().mockResolvedValue({
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
      sheet: vi.fn().mockResolvedValue({
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
        connection={{
          ...connection,
          service: "google_sheets",
          selectedResource: {
            id: "sheet1",
            name: "Relatório semanal",
            kind: "spreadsheet",
            url: null,
          },
        }}
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
