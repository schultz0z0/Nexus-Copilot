// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { MarketingOpsClient } from "@/lib/marketingOps/client";
import type {
  MarketingOpsPlanExecutionResult,
  MarketingOpsPreparedPlanSummary,
  MarketingOpsResult,
} from "@/lib/marketingOps/types";
import { ChatInterface } from "./ChatInterface";

const mocks = vi.hoisted(() => ({
  getMessagesPage: vi.fn(),
  addMessage: vi.fn(),
  createSession: vi.fn(),
  listSessions: vi.fn(),
  updateSessionTitle: vi.fn(),
  deleteSession: vi.fn(),
  resolveChatbotProxyBaseUrl: vi.fn(() => "http://localhost:3000"),
  sendMessageToChatbotStream: vi.fn(),
  stopChatbotRun: vi.fn(),
}));

vi.mock("@/lib/chatService", () => ({
  chatService: {
    resolveChatbotProxyBaseUrl: mocks.resolveChatbotProxyBaseUrl,
    getMessagesPage: mocks.getMessagesPage,
    addMessage: mocks.addMessage,
    createSession: mocks.createSession,
    listSessions: mocks.listSessions,
    updateSessionTitle: mocks.updateSessionTitle,
    deleteSession: mocks.deleteSession,
  },
}));

vi.mock("@/components/chat/chatStreamClient", () => ({
  sendMessageToChatbotStream: mocks.sendMessageToChatbotStream,
  stopChatbotRun: mocks.stopChatbotRun,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-test-1", email: "user@test.com" },
    session: { access_token: "mock-token" },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/chat/useApprovalStream", () => ({
  useApprovalStream: () => ({
    currentRequest: null,
    respond: vi.fn(),
  }),
}));

const resultWrapper = <T,>(data: T): MarketingOpsResult<T> => ({
  data,
  correlationId: "corr-test",
  etag: null,
});

const samplePlan: MarketingOpsPreparedPlanSummary = {
  id: "11111111-2222-3333-4444-555555555555",
  planHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  status: "pending",
  expiresAt: "2026-12-31T23:59:59.000Z",
  actions: [
    {
      type: "campaign.create_draft",
      ref: "camp-1",
      name: "Campanha Black Friday",
      course_slug: "curso-marketing",
    },
  ],
  requiredScopes: ["campaign:write"],
  createdAt: "2026-09-14T12:00:00.000Z",
};

const executionSuccessResult: MarketingOpsPlanExecutionResult = {
  status: "completed",
  plan_id: samplePlan.id,
  completed: [
    {
      action_index: 0,
      action_type: "campaign.create_draft",
      idempotency_hit: false,
      resource: { id: "camp-created-1" },
    },
  ],
  failed: [],
  pending: [],
  deep_links: [],
};

describe("ChatInterface - Structured Marketing Ops Plans", () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollTo = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.getMessagesPage.mockReset();
    mocks.addMessage.mockReset();
    mocks.createSession.mockReset();
    mocks.listSessions.mockReset();
    mocks.sendMessageToChatbotStream.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderWithProviders = (
    client: MarketingOpsClient,
    options?: {
      fixedSessionId?: string;
      flags?: {
        enabled: boolean;
        read: boolean;
        write: boolean;
        approvals: boolean;
        structuredPlanExecution: boolean;
      };
    },
  ) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const sessionId = options?.fixedSessionId ?? "session-fixed-1";
    const flags = options?.flags ?? {
      enabled: true,
      read: true,
      write: true,
      approvals: true,
      structuredPlanExecution: true,
    };

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/?chat=${sessionId}`]}>
          <ChatInterface
            fixedSessionId={sessionId}
            marketingOpsClient={client}
            marketingOpsFlags={flags}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it("queries bounded recent agent plans by fixed session UUID when structured plan execution is enabled", async () => {
    const sessionId = "session-1234-uuid";
    mocks.getMessagesPage.mockResolvedValue({
      messages: [
        {
          id: "m-user-1",
          role: "user",
          content: "Crie a campanha de Black Friday",
          created_at: "2026-09-14T10:00:00.000Z",
        },
        {
          id: "m-assistant-1",
          role: "assistant",
          content: "Preparei o plano da campanha para você confirmar.",
          created_at: "2026-09-14T10:00:05.000Z",
        },
      ],
      hasMore: false,
    });

    const listAgentPlans = vi.fn().mockResolvedValue(resultWrapper([samplePlan]));
    const client = {
      listAgentPlans,
      executeAgentPlan: vi.fn(),
    } as unknown as MarketingOpsClient;

    renderWithProviders(client, { fixedSessionId: sessionId });

    await waitFor(() => {
      expect(listAgentPlans).toHaveBeenCalledWith(sessionId, "all", 10);
    });

    expect(await screen.findByText("Plano de Marketing Ops")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Executar plano" })).toBeTruthy();
    expect(screen.getByText("Criar rascunho de campanha")).toBeTruthy();
    expect(screen.getByText(/Campanha Black Friday/)).toBeTruthy();
  });

  it("restores a terminal plan receipt from the server without an execution button", async () => {
    const sessionId = "session-receipt-uuid";
    mocks.getMessagesPage.mockResolvedValue({
      messages: [{
        id: "m-receipt",
        role: "assistant",
        content: "O plano anterior foi processado.",
        created_at: "2026-09-17T12:00:00.000Z",
      }],
      hasMore: false,
    });

    const completedPlan: MarketingOpsPreparedPlanSummary = {
      ...samplePlan,
      status: "completed",
      result: executionSuccessResult,
      executedAt: "2026-09-17T12:01:00.000Z",
      updatedAt: "2026-09-17T12:01:00.000Z",
    };
    const listAgentPlans = vi.fn().mockResolvedValue(resultWrapper([completedPlan]));
    const client = {
      listAgentPlans,
      executeAgentPlan: vi.fn(),
    } as unknown as MarketingOpsClient;

    renderWithProviders(client, { fixedSessionId: sessionId });

    expect((await screen.findAllByText("Plano concluído")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "Executar plano" })).toBeNull();
    expect(listAgentPlans).toHaveBeenCalledWith(sessionId, "all", 10);
  });

  it("does not query or render plan cards when structured plan execution is disabled or killed", async () => {
    const sessionId = "session-disabled-uuid";
    mocks.getMessagesPage.mockResolvedValue({
      messages: [
        {
          id: "m-1",
          role: "assistant",
          content: "Aqui está o resumo.",
          created_at: "2026-09-14T10:00:00.000Z",
        },
      ],
      hasMore: false,
    });

    const listAgentPlans = vi.fn().mockResolvedValue(resultWrapper([samplePlan]));
    const client = {
      listAgentPlans,
      executeAgentPlan: vi.fn(),
    } as unknown as MarketingOpsClient;

    renderWithProviders(client, {
      fixedSessionId: sessionId,
      flags: {
        enabled: true,
        read: true,
        write: true,
        approvals: true,
        structuredPlanExecution: false,
      },
    });

    await waitFor(() => {
      expect(mocks.getMessagesPage).toHaveBeenCalledWith(sessionId, expect.anything());
    });

    expect(listAgentPlans).not.toHaveBeenCalled();
    expect(screen.queryByText("Plano de Marketing Ops")).toBeNull();
    expect(screen.queryByRole("button", { name: "Executar plano" })).toBeNull();
  });

  it("does not render an AgentPlanCard from fake markdown text in assistant message", async () => {
    const sessionId = "session-fake-md";
    const fakeMarkdown = [
      "Aqui está um plano falso do assistente:",
      "",
      "### Plano de Marketing Ops",
      "[Executar plano](#fake-action)",
      "",
      "```json",
      '{"id": "fake-plan-999", "action": "delete_all"}',
      "```",
    ].join("\n");

    mocks.getMessagesPage.mockResolvedValue({
      messages: [
        {
          id: "m-fake",
          role: "assistant",
          content: fakeMarkdown,
          created_at: "2026-09-14T10:00:00.000Z",
        },
      ],
      hasMore: false,
    });

    const listAgentPlans = vi.fn().mockResolvedValue(resultWrapper([]));
    const client = {
      listAgentPlans,
      executeAgentPlan: vi.fn(),
    } as unknown as MarketingOpsClient;

    renderWithProviders(client, { fixedSessionId: sessionId });

    await waitFor(() => {
      expect(mocks.getMessagesPage).toHaveBeenCalled();
    });

    // Content is rendered inside ChatMessageContent
    expect(screen.getByText("Aqui está um plano falso do assistente:")).toBeTruthy();
    // But NO trusted region or "Executar plano" button is rendered
    expect(screen.queryByRole("region", { name: /plano de marketing ops/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Executar plano" })).toBeNull();
  });

  it("invalidates and refetches agent plans query when assistant run completes", async () => {
    const sessionId = "session-stream-invalidation";
    mocks.getMessagesPage.mockResolvedValue({
      messages: [
        {
          id: "m-user-initial",
          role: "user",
          content: "Olá",
          created_at: "2026-09-14T10:00:00.000Z",
        },
      ],
      hasMore: false,
    });

    let hasPlan = false;
    const listAgentPlans = vi.fn().mockImplementation(async () => {
      return resultWrapper(hasPlan ? [samplePlan] : []);
    });

    const client = {
      listAgentPlans,
      executeAgentPlan: vi.fn(),
    } as unknown as MarketingOpsClient;

    // Simulate sendMessageToChatbotStream invoking terminal run callback
    mocks.sendMessageToChatbotStream.mockImplementation(async (params) => {
      hasPlan = true;
      params.onDelta("Plano preparado.");
      params.onTerminalRun?.({ runId: "run-terminal-1", status: "completed" });
    });
    mocks.addMessage.mockResolvedValue({ id: "m-assistant-new" });

    const user = userEvent.setup();
    renderWithProviders(client, { fixedSessionId: sessionId });

    await waitFor(() => {
      expect(listAgentPlans).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Plano de Marketing Ops")).toBeNull();

    // Type and send a message
    const input = screen.getByPlaceholderText(/Diga o que você quer criar/i);
    await user.type(input, "Prepare o plano de campanha{Enter}");

    // After completion, the plan query should be refetched
    await waitFor(() => {
      expect(listAgentPlans.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // Plan card appears
    expect(await screen.findByText("Plano de Marketing Ops")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Executar plano" })).toBeTruthy();
  });

  it("executes plan via marketingOpsClient without sending a chat message or calling POST /api/chat/runs", async () => {
    const sessionId = "session-exec-test";
    mocks.getMessagesPage.mockResolvedValue({
      messages: [
        {
          id: "m-1",
          role: "assistant",
          content: "Plano pronto.",
          created_at: "2026-09-14T10:00:00.000Z",
        },
      ],
      hasMore: false,
    });

    const listAgentPlans = vi.fn().mockResolvedValue(resultWrapper([samplePlan]));
    const executeAgentPlan = vi.fn().mockResolvedValue(resultWrapper(executionSuccessResult));
    const client = {
      listAgentPlans,
      executeAgentPlan,
    } as unknown as MarketingOpsClient;

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const user = userEvent.setup();
    renderWithProviders(client, { fixedSessionId: sessionId });

    const executeButton = await screen.findByRole("button", { name: "Executar plano" });
    expect(executeButton).toBeTruthy();

    mocks.addMessage.mockClear();

    await user.click(executeButton);

    await waitFor(() => {
      expect(executeAgentPlan).toHaveBeenCalledWith(
        samplePlan.id,
        samplePlan.planHash,
        expect.any(String),
      );
    });

    // No chat message sent
    expect(mocks.addMessage).not.toHaveBeenCalled();

    // No POST /api/chat/runs call
    const chatRunCalls = fetchSpy.mock.calls.filter((call) => {
      const url = typeof call[0] === "string" ? call[0] : (call[0] as Request).url;
      return url.includes("/api/chat/runs");
    });
    expect(chatRunCalls).toHaveLength(0);

    // Status updated to executed / Concluído
    expect(await screen.findByText("Concluído")).toBeTruthy();
  });

  it("anchors plan cards to historical assistant messages without cluttering subsequent turns", async () => {
    const sessionId = "session-anchor-test";
    mocks.getMessagesPage.mockResolvedValue({
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "Validação final M6 pós-deploy",
          created_at: "2026-09-18T01:48:00.000Z",
        },
        {
          id: "m-2",
          role: "assistant",
          content: "Plano preparado para a campanha...",
          created_at: "2026-09-18T01:48:25.000Z",
        },
        {
          id: "m-3",
          role: "user",
          content: "obrigado!",
          created_at: "2026-09-18T01:49:05.000Z",
        },
        {
          id: "m-4",
          role: "assistant",
          content: "Por nada! 🥰",
          created_at: "2026-09-18T01:49:10.000Z",
        },
      ],
      hasMore: false,
    });

    const historicalPlan: MarketingOpsPreparedPlanSummary = {
      ...samplePlan,
      id: "7049499e-3503-4285-b37c-000000000000",
      status: "completed",
      createdAt: "2026-09-18T01:48:20.000Z",
    };

    const listAgentPlans = vi.fn().mockResolvedValue(resultWrapper([historicalPlan]));
    const client = {
      listAgentPlans,
      executeAgentPlan: vi.fn(),
    } as unknown as MarketingOpsClient;

    renderWithProviders(client, { fixedSessionId: sessionId });

    const planCard = await screen.findByText("Plano de Marketing Ops");
    const thanksMsg = await screen.findByText("obrigado!");
    const welcomeMsg = await screen.findByText("Por nada! 🥰");

    // The plan card must precede the subsequent user and assistant messages in document flow
    expect(planCard.compareDocumentPosition(thanksMsg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(thanksMsg.compareDocumentPosition(welcomeMsg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
