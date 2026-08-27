const buildHermesSessionHeaders = (hermesApiKey) => ({
  ...(hermesApiKey ? { Authorization: `Bearer ${hermesApiKey}` } : {}),
  Accept: "application/json",
  "Content-Type": "application/json",
});

export const isHermesSessionApiUnavailableError = (error) => (
  error instanceof Error && /hermes_session_create_failed:(404|405|501)/.test(error.message)
);

const parseSessionResponse = async (response) => {
  const payload = await response.json().catch(() => ({}));
  const id =
    typeof payload.id === "string"
      ? payload.id
      : payload.session && typeof payload.session === "object" && typeof payload.session.id === "string"
        ? payload.session.id
        : null;

  if (!id) throw new Error("hermes_session_invalid_response");

  return {
    id,
    title:
      typeof payload.title === "string"
        ? payload.title
        : payload.session && typeof payload.session === "object" && typeof payload.session.title === "string"
          ? payload.session.title
          : null,
  };
};

export const createHermesSession = async ({
  hermesBaseUrl,
  hermesApiKey,
  sessionId,
  title,
  fetchImpl = fetch,
}) => {
  const trimmedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  const body = {
    ...(trimmedSessionId ? { id: trimmedSessionId } : {}),
    ...(trimmedTitle ? { title: trimmedTitle } : {}),
  };

  const response = await fetchImpl(new URL("/api/sessions", hermesBaseUrl.origin), {
    method: "POST",
    headers: buildHermesSessionHeaders(hermesApiKey),
    body: JSON.stringify(body),
  });

  if (response.status === 409 && trimmedSessionId) {
    return { id: trimmedSessionId, title: trimmedTitle || null, existed: true };
  }

  if (!response.ok) {
    throw new Error(`hermes_session_create_failed:${response.status}`);
  }

  return await parseSessionResponse(response);
};

export const deleteHermesSession = async ({
  hermesBaseUrl,
  hermesApiKey,
  hermesSessionId,
  fetchImpl = fetch,
}) => {
  const response = await fetchImpl(new URL(`/api/sessions/${encodeURIComponent(hermesSessionId)}`, hermesBaseUrl.origin), {
    method: "DELETE",
    headers: buildHermesSessionHeaders(hermesApiKey),
  });

  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`hermes_session_delete_failed:${response.status}`);
  return true;
};
