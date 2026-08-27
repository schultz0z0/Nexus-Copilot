import { supabase } from "./supabase";

export interface ChatSession {
  id: string;
  title: string;
  session_kind: "normal" | "picture";
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

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

const deleteSessionThroughBridge = async (sessionId: string) => {
  const baseUrl = resolveChatbotProxyBaseUrl();
  if (!baseUrl) return false;

  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) return false;

  const response = await fetch(`${baseUrl}/api/chat/session/delete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session_id: sessionId }),
  });

  if (!response.ok) {
    throw new Error(await response.text().catch(() => "Falha ao apagar conversa pela bridge."));
  }

  return true;
};

export const chatService = {
  resolveChatbotProxyBaseUrl,
  // Criar uma nova sessão
  async createSession(userId: string, title: string = "Nova Conversa") {
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: userId, title })
      .select()
      .single();

    if (error) throw error;
    return data as ChatSession;
  },

  // Listar sessões do usuário
  async listSessions(userId: string) {
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("session_kind", "normal")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return data as ChatSession[];
  },

  // Obter mensagens de uma sessão
  async getMessages(sessionId: string) {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data as ChatMessage[];
  },

  async getMessagesPage(
    sessionId: string,
    options?: { limit?: number; before?: { created_at: string; id: string } }
  ): Promise<ChatMessagesPage> {
    const limit = options?.limit ?? 50;
    const before = options?.before;
    let query = supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (before) {
      const createdAt = encodeURIComponent(before.created_at);
      query = query.or(
        `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${before.id})`
      );
    }

    const { data, error } = await query;

    if (error) throw error;

    const rows = (data || []) as ChatMessage[];
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    return { messages: sliced.reverse(), hasMore };
  },

  // Adicionar mensagem
  async addMessage(sessionId: string, role: "user" | "assistant", content: string) {
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ session_id: sessionId, role, content })
      .select()
      .single();

    if (error) throw error;

    // Atualizar updated_at da sessão
    await supabase
      .from("chat_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    return data as ChatMessage;
  },

  // Atualizar título da sessão (ex: baseado na primeira pergunta)
  async updateSessionTitle(sessionId: string, title: string) {
    const { error } = await supabase
      .from("chat_sessions")
      .update({ title })
      .eq("id", sessionId);

    if (error) throw error;
  },
  
  // Deletar sessão e suas mensagens, priorizando a bridge para limpar o estado Hermes.
  async deleteSession(sessionId: string) {
    if (await deleteSessionThroughBridge(sessionId)) {
      return;
    }

    // Primeiro deleta as mensagens da sessão
    const { error: messagesError } = await supabase
      .from("chat_messages")
      .delete()
      .eq("session_id", sessionId);

    if (messagesError) throw messagesError;

    // Depois deleta a sessão
    const { error: sessionError } = await supabase
      .from("chat_sessions")
      .delete()
      .eq("id", sessionId);

    if (sessionError) throw sessionError;
  },
};
