import { buildHermesConversationId } from "./hermes-payloads.js";

const stateTable = "chat_session_hermes_state";

const nowIso = () => new Date().toISOString();

export const buildInitialHermesConversationState = ({ chatSessionId, userId }) => ({
  chat_session_id: chatSessionId,
  user_id: userId,
  hermes_session_id: null,
  hermes_conversation_id: buildHermesConversationId(userId, chatSessionId),
  last_response_id: null,
  last_good_response_id: null,
  chain_health: "healthy",
  last_error_code: null,
  last_error_at: null,
});

const buildRestHeaders = ({ serviceRoleKey }) => {
  if (!serviceRoleKey) throw new Error("missing_SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
};

const encodeEq = (value) => encodeURIComponent(`eq.${value}`);

const stateRowUrl = ({ supabaseUrl, chatSessionId, userId }) =>
  `${supabaseUrl}/rest/v1/${stateTable}?chat_session_id=${encodeEq(chatSessionId)}&user_id=${encodeEq(userId)}&select=*`;

const parseSingleRow = async (response, action) => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message ?? payload?.error ?? response.status;
    throw new Error(`chat_session_hermes_state.${action}_failed:${message}`);
  }

  if (Array.isArray(payload)) return payload[0] ?? null;
  return payload;
};

export const createSupabaseHermesStateRepository = ({
  supabaseUrl,
  supabaseServiceRoleKey,
  fetchImpl = fetch,
}) => {
  const normalizedSupabaseUrl = String(supabaseUrl ?? "").replace(/\/$/, "");
  const headers = buildRestHeaders({ serviceRoleKey: supabaseServiceRoleKey });

  return {
    async get(chatSessionId, userId) {
      const response = await fetchImpl(stateRowUrl({
        supabaseUrl: normalizedSupabaseUrl,
        chatSessionId,
        userId,
      }), { headers });

      return await parseSingleRow(response, "get");
    },

    async upsert(record) {
      const response = await fetchImpl(`${normalizedSupabaseUrl}/rest/v1/${stateTable}?on_conflict=chat_session_id`, {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(record),
      });

      const row = await parseSingleRow(response, "upsert");
      if (!row) throw new Error("chat_session_hermes_state.upsert_failed:empty_response");
      return row;
    },

    async patch(chatSessionId, userId, changes) {
      const response = await fetchImpl(stateRowUrl({
        supabaseUrl: normalizedSupabaseUrl,
        chatSessionId,
        userId,
      }), {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=representation",
        },
        body: JSON.stringify(changes),
      });

      const row = await parseSingleRow(response, "patch");
      if (!row) throw new Error("chat_session_hermes_state.patch_failed:empty_response");
      return row;
    },

    async delete(chatSessionId, userId) {
      const response = await fetchImpl(stateRowUrl({
        supabaseUrl: normalizedSupabaseUrl,
        chatSessionId,
        userId,
      }), {
        method: "DELETE",
        headers,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(`chat_session_hermes_state.delete_failed:${payload?.message ?? response.status}`);
      }
    },
  };
};

export const createMemoryHermesStateRepository = () => {
  const states = new Map();
  const key = (chatSessionId, userId) => `${userId}:${chatSessionId}`;

  return {
    async get(chatSessionId, userId) {
      return states.get(key(chatSessionId, userId)) ?? null;
    },
    async upsert(record) {
      states.set(key(record.chat_session_id, record.user_id), record);
      return record;
    },
    async patch(chatSessionId, userId, changes) {
      const current = states.get(key(chatSessionId, userId)) ?? buildInitialHermesConversationState({ chatSessionId, userId });
      const next = { ...current, ...changes };
      states.set(key(chatSessionId, userId), next);
      return next;
    },
    async delete(chatSessionId, userId) {
      states.delete(key(chatSessionId, userId));
    },
  };
};

export const ensureHermesConversationState = async ({ repository, chatSessionId, userId }) => {
  const existing = await repository.get(chatSessionId, userId);
  if (existing) return existing;
  return await repository.upsert(buildInitialHermesConversationState({ chatSessionId, userId }));
};

export const markHermesResponseCompleted = async ({ repository, state, responseId }) =>
  await repository.patch(state.chat_session_id, state.user_id, {
    last_response_id: responseId,
    last_good_response_id: responseId,
    chain_health: "healthy",
    last_error_code: null,
    last_error_at: null,
  });

export const markHermesResponseRecovered = async ({ repository, state, responseId, errorCode }) =>
  await repository.patch(state.chat_session_id, state.user_id, {
    last_response_id: responseId,
    last_good_response_id: state.last_good_response_id,
    chain_health: "degraded",
    last_error_code: errorCode,
    last_error_at: nowIso(),
  });

export const markHermesChainDegraded = async ({ repository, state, errorCode }) =>
  await repository.patch(state.chat_session_id, state.user_id, {
    chain_health: "degraded",
    last_error_code: errorCode,
    last_error_at: nowIso(),
  });

export const bindHermesSessionToState = async ({ repository, state, hermesSessionId }) =>
  await repository.patch(state.chat_session_id, state.user_id, {
    hermes_session_id: hermesSessionId,
  });

export const buildHermesResponseRoutingState = ({ state, previousResponseId }) => ({
  conversationId: state.hermes_conversation_id,
  previousResponseId: previousResponseId ?? state.last_good_response_id,
  hermesSessionId: state.hermes_session_id,
});

export const getHermesSessionIdFromResponse = (response) => {
  const raw = response?.headers?.get?.("X-Hermes-Session-Id") ?? response?.headers?.get?.("x-hermes-session-id") ?? "";
  return typeof raw === "string" ? raw.trim() : "";
};

export const bindHermesSessionFromResponse = async ({ repository, state, run, response }) => {
  const hermesSessionId = getHermesSessionIdFromResponse(response);
  if (!hermesSessionId || hermesSessionId === state.hermes_session_id) {
    return state;
  }

  const nextState = await bindHermesSessionToState({
    repository,
    state,
    hermesSessionId,
  });

  if (run && typeof run === "object") {
    run.hermes_session_id = hermesSessionId;
  }

  return nextState;
};
