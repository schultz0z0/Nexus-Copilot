import { api, type ChatSession, type ChatMessage } from "./api";

export type { ChatSession, ChatMessage };

export interface ChatMessagesPage {
  messages: ChatMessage[];
  hasMore: boolean;
}

export const resolveChatbotProxyBaseUrl = () => {
  const raw = (import.meta.env.VITE_CHATBOT_PROXY_URL || "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

export const chatService = {
  resolveChatbotProxyBaseUrl,

  // Criar uma nova sessão
  async createSession(userId: string, title: string = "Nova Conversa"): Promise<ChatSession> {
    const { session } = await api.chat.createSession({ title, session_kind: "normal" });
    return session;
  },

  // Listar sessões do usuário
  async listSessions(userId: string): Promise<ChatSession[]> {
    const { sessions } = await api.chat.listSessions({ session_kind: "normal" });
    return sessions;
  },

  // Obter mensagens de uma sessão
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const { messages } = await api.chat.listMessages(sessionId);
    return messages;
  },

  async getMessagesPage(
    sessionId: string,
    options?: { limit?: number; before?: { created_at: string; id: string } }
  ): Promise<ChatMessagesPage> {
    return await api.chat.listMessages(sessionId, options);
  },

  // Adicionar mensagem
  async addMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<ChatMessage> {
    const { message } = await api.chat.createMessage(sessionId, { role, content });
    return message;
  },

  // Atualizar título da sessão (ex: baseado na primeira pergunta)
  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await api.chat.updateSession(sessionId, { title });
  },

  // Deletar sessão e suas mensagens
  async deleteSession(sessionId: string): Promise<void> {
    await api.chat.deleteSession(sessionId);
  },
};
