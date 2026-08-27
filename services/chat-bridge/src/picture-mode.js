const asString = (value) => typeof value === "string" ? value.trim() : "";

export const validateChatExperience = (payload = {}) => {
  const experience = payload.experience === "picture" ? "picture" : "normal";
  const pictureWorkspaceId = experience === "picture" ? asString(payload.picture_workspace_id) : null;
  if (experience === "picture" && !pictureWorkspaceId) {
    const error = new Error("missing_picture_workspace_id");
    error.status = 400;
    throw error;
  }
  return { experience, pictureWorkspaceId };
};

export const buildPictureWorkspaceSummary = ({ workspace, files }) => ({
  id: workspace.id,
  status: workspace.status,
  title: workspace.title,
  candidate_artifact_id: workspace.candidate_artifact_id ?? null,
  files: (files || []).map((file) => ({
    artifact_id: file.id ?? file.artifact_id,
    relative_path: file.relative_path,
    category: file.category,
    content_type: file.content_type,
    lifecycle: file.lifecycle,
  })),
});

export const createPictureModeService = ({ sessions, picture, hermes }) => {
  const scope = (user, workspaceId) => ({ userId: user.id, tenantId: user.tenant_id, workspaceId });

  const get = async (user, workspaceId) => {
    const workspace = await picture.getWorkspace(scope(user, workspaceId));
    const session = await sessions.assertPictureSession({ sessionId: workspace.chat_session_id, userId: user.id });
    if (session.session_kind !== "picture") {
      const error = new Error("picture_session_kind_invalid"); error.status = 409; throw error;
    }
    return workspace;
  };

  const current = async (user) => {
    const active = await sessions.findActiveWorkspace({ userId: user.id, tenantId: user.tenant_id });
    if (active) return get(user, active.id);
    let session = await sessions.findPictureSession({ userId: user.id });
    if (!session) session = await sessions.createPictureSession({ userId: user.id, title: "Nova peça" });
    return picture.ensureWorkspace({ userId: user.id, tenantId: user.tenant_id, sessionId: session.id, title: "Nova peça" });
  };

  return {
    current,
    get,
    async files(user, workspaceId) {
      await get(user, workspaceId);
      return picture.getFiles(scope(user, workspaceId));
    },
    async approve(user, workspaceId) {
      await get(user, workspaceId);
      return picture.approve(scope(user, workspaceId));
    },
    async newPiece(user, workspaceId) {
      const workspace = await get(user, workspaceId);
      await picture.reset(scope(user, workspaceId));
      await hermes.deleteSession({ userId: user.id, sessionId: workspace.chat_session_id });
      await sessions.deletePictureSession({ userId: user.id, sessionId: workspace.chat_session_id });
      const session = await sessions.createPictureSession({ userId: user.id, title: "Nova peça" });
      return picture.ensureWorkspace({ userId: user.id, tenantId: user.tenant_id, sessionId: session.id, title: "Nova peça" });
    },
  };
};

const restHeaders = (serviceRoleKey) => ({
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
});

export const createSupabasePictureSessionRepository = ({ supabaseUrl, serviceRoleKey, fetchImpl = fetch }) => {
  const baseUrl = String(supabaseUrl || "").replace(/\/+$/, "");
  const headers = restHeaders(serviceRoleKey);
  const rows = async (path, init = {}) => {
    const response = await fetchImpl(`${baseUrl}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    const payload = await response.json().catch(() => []);
    if (!response.ok) throw Object.assign(new Error(payload?.message || `supabase_picture_failed:${response.status}`), { status: response.status });
    return Array.isArray(payload) ? payload : [payload];
  };
  return {
    async findActiveWorkspace({ userId, tenantId }) {
      const query = new URLSearchParams({ user_id: `eq.${userId}`, tenant_id: `eq.${tenantId}`, active: "eq.true", select: "*", limit: "1" });
      return (await rows(`picture_workspaces?${query}`))[0] ?? null;
    },
    async findPictureSession({ userId }) {
      const query = new URLSearchParams({ user_id: `eq.${userId}`, session_kind: "eq.picture", select: "*", order: "created_at.desc", limit: "1" });
      return (await rows(`chat_sessions?${query}`))[0] ?? null;
    },
    async assertPictureSession({ sessionId, userId }) {
      const query = new URLSearchParams({ id: `eq.${sessionId}`, user_id: `eq.${userId}`, session_kind: "eq.picture", select: "*", limit: "1" });
      const session = (await rows(`chat_sessions?${query}`))[0];
      if (!session) throw Object.assign(new Error("picture_session_not_found"), { status: 404 });
      return session;
    },
    async createPictureSession({ userId, title }) {
      const result = await rows("chat_sessions", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ user_id: userId, title, session_kind: "picture" }),
      });
      if (!result[0]) throw new Error("picture_session_create_failed");
      return result[0];
    },
    async deletePictureSession({ userId, sessionId }) {
      for (const [table, filters] of [
        ["chat_messages", { session_id: `eq.${sessionId}` }],
        ["chat_session_hermes_state", { chat_session_id: `eq.${sessionId}`, user_id: `eq.${userId}` }],
        ["chat_sessions", { id: `eq.${sessionId}`, user_id: `eq.${userId}`, session_kind: "eq.picture" }],
      ]) {
        const query = new URLSearchParams(filters);
        await rows(`${table}?${query}`, { method: "DELETE" });
      }
    },
  };
};
