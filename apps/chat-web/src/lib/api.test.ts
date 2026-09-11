import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./api";

describe("api client", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("api.auth", () => {
    it("login sends POST /api/auth/login with credentials and body", async () => {
      const mockUser = { id: "u-1", email: "user@example.com", full_name: "Test User", role: "member" };
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ user: mockUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.auth.login({ email: "user@example.com", password: "password123" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/auth/login");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(JSON.parse(init.body)).toEqual({ email: "user@example.com", password: "password123" });
      expect(res).toEqual({ user: mockUser });
    });

    it("logout sends POST /api/auth/logout", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.auth.logout();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/auth/logout");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(res).toEqual({ ok: true });
    });

    it("me sends GET /api/auth/me", async () => {
      const mockUser = { id: "u-1", email: "user@example.com" };
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ user: mockUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.auth.me();

      expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", expect.objectContaining({
        method: "GET",
        credentials: "include",
      }));
      expect(res).toEqual({ user: mockUser });
    });

    it("session sends GET /api/auth/session", async () => {
      const mockUser = { id: "u-1", email: "user@example.com" };
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ user: mockUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.auth.session();

      expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({
        method: "GET",
        credentials: "include",
      }));
      expect(res).toEqual({ user: mockUser });
    });

    it("throws error with error message from server on failure", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      await expect(api.auth.login({ email: "bad@example.com", password: "wrong" }))
        .rejects.toThrow("Invalid credentials");
    });
  });

  describe("api.chat", () => {
    it("listSessions sends GET /api/chat/sessions with query params", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ sessions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      await api.chat.listSessions({ session_kind: "normal", limit: 20 });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat/sessions?session_kind=normal&limit=20",
        expect.objectContaining({ method: "GET", credentials: "include" })
      );
    });

    it("createSession sends POST /api/chat/sessions", async () => {
      const mockSession = { id: "s-1", title: "Nova Conversa" };
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ session: mockSession }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.chat.createSession({ title: "Nova Conversa", session_kind: "normal" });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat/sessions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ title: "Nova Conversa", session_kind: "normal" }),
        })
      );
      expect(res).toEqual({ session: mockSession });
    });

    it("getSession sends GET /api/chat/sessions/:id", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ session: { id: "s-1" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.chat.getSession("s-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/chat/sessions/s-1", expect.anything());
      expect(res).toEqual({ session: { id: "s-1" } });
    });

    it("updateSession sends PATCH /api/chat/sessions/:id", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ session: { id: "s-1", title: "Updated" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.chat.updateSession("s-1", { title: "Updated" });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat/sessions/s-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ title: "Updated" }),
        })
      );
      expect(res).toEqual({ session: { id: "s-1", title: "Updated" } });
    });

    it("deleteSession sends DELETE /api/chat/sessions/:id", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.chat.deleteSession("s-1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat/sessions/s-1",
        expect.objectContaining({ method: "DELETE" })
      );
      expect(res).toEqual({ ok: true });
    });

    it("listMessages sends GET /api/chat/sessions/:id/messages with before pagination", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [], hasMore: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      await api.chat.listMessages("s-1", {
        limit: 50,
        before: { created_at: "2026-09-11T12:00:00Z", id: "m-50" },
      });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain("/api/chat/sessions/s-1/messages?");
      expect(url).toContain("limit=50");
      expect(url).toContain("before_created_at=2026-09-11T12%3A00%3A00Z");
      expect(url).toContain("before_id=m-50");
    });

    it("createMessage sends POST /api/chat/sessions/:id/messages", async () => {
      const mockMsg = { id: "m-1", role: "user", content: "Hello" };
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: mockMsg }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.chat.createMessage("s-1", { role: "user", content: "Hello" });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat/sessions/s-1/messages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ role: "user", content: "Hello" }),
        })
      );
      expect(res).toEqual({ message: mockMsg });
    });

    it("createRun sends POST /api/chat/runs", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ run_id: "r-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.chat.createRun({ prompt: "hi" });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat/runs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ prompt: "hi" }),
        })
      );
      expect(res).toEqual({ run_id: "r-1" });
    });

    it("getRun sends GET /api/chat/runs/:id", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ state: "running" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.chat.getRun("r-1");
      expect(fetchMock).toHaveBeenCalledWith("/api/chat/runs/r-1", expect.anything());
      expect(res).toEqual({ state: "running" });
    });

    it("stopRun sends POST /api/chat/runs/:id/stop", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ stopped: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await api.chat.stopRun("r-1");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat/runs/r-1/stop",
        expect.objectContaining({ method: "POST" })
      );
      expect(res).toEqual({ stopped: true });
    });

    it("getRunEventsUrl builds correct SSE URL", () => {
      expect(api.chat.getRunEventsUrl("r-1")).toBe("/api/chat/runs/r-1/events");
      expect(api.chat.getRunEventsUrl("r-1", 5)).toBe("/api/chat/runs/r-1/events?cursor=5");
    });
  });
});
