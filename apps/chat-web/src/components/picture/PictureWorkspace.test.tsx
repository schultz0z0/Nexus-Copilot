// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspace: null as null | Record<string, unknown>,
  files: [] as Array<Record<string, unknown>>,
  approve: vi.fn(),
  newPiece: vi.fn(),
  refresh: vi.fn(),
  selectedFileId: null as string | null,
  setSelectedFileId: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { access_token: "token" } }) }));
vi.mock("@/hooks/usePictureWorkspace", () => ({
  usePictureWorkspace: () => ({
    ...state,
    isLoading: false,
    isFilesLoading: false,
    isApproving: false,
    isCreatingNewPiece: false,
    error: null,
  }),
}));
vi.mock("@/components/ChatInterface", () => ({
  ChatInterface: (props: Record<string, unknown>) => {
    const [draft, setDraft] = useState("");
    return (
      <div data-testid="picture-chat">
        chat:{String(props.experience)}:{String(props.fixedSessionId)}
        <input
          aria-label="Rascunho do chat Picture"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
    );
  },
}));

import { PictureWorkspace } from "./PictureWorkspace";
import { PictureWorkspaceActions } from "./PictureWorkspaceActions";

afterEach(() => cleanup());

const workspace = (status: string) => ({
  id: "workspace-1", chat_session_id: "session-1", status, title: "Peça graduação",
  candidate_artifact_id: status === "drafting" ? null : "candidate-1",
});

describe("PictureWorkspace", () => {
  beforeEach(() => {
    state.workspace = workspace("drafting");
    state.files = [];
    state.approve.mockReset();
    state.newPiece.mockReset();
  });

  it("shows the dedicated chat and files panel with concise empty guidance, never a Designer form", () => {
    render(<PictureWorkspace />);
    expect(screen.getByTestId("picture-chat").textContent).toContain("chat:picture:session-1");
    expect(screen.getAllByText("Arquivos da peça").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Converse com o Hermes e envie suas referências/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/modo de geração/i)).toBeNull();
  });
  it("starts a clean chat immediately when a new workspace replaces the current session", async () => {
    const user = userEvent.setup();
    const view = render(<PictureWorkspace />);
    const draft = screen.getByRole("textbox", { name: "Rascunho do chat Picture" });
    await user.type(draft, "mensagem da peça anterior");

    state.workspace = {
      ...workspace("drafting"),
      id: "workspace-2",
      chat_session_id: "session-2",
      title: "Nova peça",
    };
    view.rerender(<PictureWorkspace />);

    expect(screen.getByTestId("picture-chat").textContent).toContain("session-2");
    expect((screen.getByRole("textbox", { name: "Rascunho do chat Picture" }) as HTMLInputElement).value).toBe("");
  });
});

describe("PictureWorkspaceActions", () => {
  it("only enables approve in review and allows a new piece outside resetting", () => {
    const { rerender } = render(<PictureWorkspaceActions workspace={workspace("drafting") as never} onApprove={state.approve} onNewPiece={state.newPiece} />);
    expect(screen.getByRole("button", { name: /Aprovar peça/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /Criar nova peça/ }).hasAttribute("disabled")).toBe(false);
    rerender(<PictureWorkspaceActions workspace={workspace("review") as never} onApprove={state.approve} onNewPiece={state.newPiece} />);
    expect(screen.getByRole("button", { name: /Aprovar peça/ }).hasAttribute("disabled")).toBe(false);
    rerender(<PictureWorkspaceActions workspace={workspace("resetting") as never} onApprove={state.approve} onNewPiece={state.newPiece} />);
    expect(screen.getByRole("button", { name: /Criar nova peça/ }).hasAttribute("disabled")).toBe(true);
  });

  it("explains cleanup, cancels safely and confirms new piece once while pending", async () => {
    let resolve!: () => void;
    state.newPiece.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const user = userEvent.setup();
    render(<PictureWorkspaceActions workspace={workspace("validated") as never} onApprove={state.approve} onNewPiece={state.newPiece} />);
    await user.click(screen.getByRole("button", { name: /Criar nova peça/ }));
    expect(screen.getByText(/chat, briefing, arquivos auxiliares, JSONs e versões intermediárias/)).toBeTruthy();
    expect(screen.getByText(/Se a peça final tiver sido aprovada/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(state.newPiece).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Criar nova peça/ }));
    const confirm = screen.getByRole("button", { name: "Confirmar e criar" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(state.newPiece).toHaveBeenCalledTimes(1);
    expect(confirm.hasAttribute("disabled")).toBe(true);
    resolve();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmar e criar" })).toBeNull());
  });
});
