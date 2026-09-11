import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
  listMessages: vi.fn(),
  createMessage: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock("./api", () => ({
  api: {
    chat: {
      createSession: mocks.createSession,
      listSessions: mocks.listSessions,
      listMessages: mocks.listMessages,
      createMessage: mocks.createMessage,
      updateSession: mocks.updateSession,
      deleteSession: mocks.deleteSession,
    },
  },
}));

import { chatService } from "./chatService";

describe("chatService session isolation and operations", () => {
  beforeEach(() => {
    mocks.createSession.mockReset();
    mocks.listSessions.mockReset();
    mocks.listMessages.mockReset();
    mocks.createMessage.mockReset();
    mocks.updateSession.mockReset();
    mocks.deleteSession.mockReset();
  });

  it("creates normal sessions through api.chat", async () => {
    mocks.createSession.mockResolvedValue({
      session: {
        id: "normal-1",
        user_id: "user-1",
        title: "Conversa",
        session_kind: "normal",
        user_message_count: 0,
        created_at: "now",
        updated_at: "now",
      },
    });

    const session = await chatService.createSession("user-1", "Conversa");

    expect(mocks.createSession).toHaveBeenCalledWith({ title: "Conversa", session_kind: "normal" });
    expect(session.session_kind).toBe("normal");
  });

  it("lists only normal sessions so Picture never appears in chat history", async () => {
    mocks.listSessions.mockResolvedValue({ sessions: [] });

    await chatService.listSessions("user-1");

    expect(mocks.listSessions).toHaveBeenCalledWith({ session_kind: "normal" });
  });

  it("delegates getMessages, addMessage, updateSessionTitle, and deleteSession to api.chat", async () => {
    mocks.listMessages.mockResolvedValue({
      messages: [{ id: "m-1", session_id: "s-1", role: "user", content: "Hi", created_at: "now" }],
      hasMore: false,
    });
    mocks.createMessage.mockResolvedValue({
      message: { id: "m-2", session_id: "s-1", role: "assistant", content: "Hello", created_at: "now" },
    });
    mocks.updateSession.mockResolvedValue({
      session: { id: "s-1", title: "New Title" },
    });
    mocks.deleteSession.mockResolvedValue({ ok: true });

    const msgs = await chatService.getMessages("s-1");
    expect(msgs).toHaveLength(1);
    expect(mocks.listMessages).toHaveBeenCalledWith("s-1");

    const newMsg = await chatService.addMessage("s-1", "assistant", "Hello");
    expect(newMsg.content).toBe("Hello");
    expect(mocks.createMessage).toHaveBeenCalledWith("s-1", { role: "assistant", content: "Hello" });

    await chatService.updateSessionTitle("s-1", "New Title");
    expect(mocks.updateSession).toHaveBeenCalledWith("s-1", { title: "New Title" });

    await chatService.deleteSession("s-1");
    expect(mocks.deleteSession).toHaveBeenCalledWith("s-1");
  });
});
