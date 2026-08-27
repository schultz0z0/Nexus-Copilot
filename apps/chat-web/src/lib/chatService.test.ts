import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    from: mocks.from,
    auth: { getSession: vi.fn() },
  },
}));

import { chatService } from "./chatService";

describe("chatService session isolation", () => {
  beforeEach(() => mocks.from.mockReset());

  it("creates normal sessions through the protected database default", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: "normal-1", title: "Conversa", session_kind: "normal", created_at: "now", updated_at: "now" },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mocks.from.mockReturnValue({ insert });

    const session = await chatService.createSession("user-1", "Conversa");

    expect(insert).toHaveBeenCalledWith({ user_id: "user-1", title: "Conversa" });
    expect(session.session_kind).toBe("normal");
  });

  it("lists only normal sessions so Picture never appears in chat history", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eqKind = vi.fn(() => ({ order }));
    const eqUser = vi.fn(() => ({ eq: eqKind }));
    const select = vi.fn(() => ({ eq: eqUser }));
    mocks.from.mockReturnValue({ select });

    await chatService.listSessions("user-1");

    expect(eqUser).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqKind).toHaveBeenCalledWith("session_kind", "normal");
  });
});
