const normalizeBaseUrl = (value) => String(value ?? "").trim().replace(/\/+$/, "");

export class PictureClientError extends Error {
  constructor(code, message, status = 500, options) {
    super(message, options);
    this.name = "PictureClientError";
    this.code = code;
    this.status = status;
  }
}

const dataUrlBytes = (value) => {
  const match = String(value ?? "").match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new PictureClientError("picture_reference_bytes_missing", "Anexo Picture sem bytes materializados.", 422);
  return { contentType: match[1].toLowerCase(), bytes: Buffer.from(match[2], "base64") };
};

export class PictureClient {
  constructor({
    baseUrl,
    internalKey,
    artifactBaseUrl = "",
    artifactInternalKey = "",
    timeoutMs = 30_000,
    fetchImpl = fetch,
  }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.internalKey = String(internalKey ?? "");
    this.artifactBaseUrl = normalizeBaseUrl(artifactBaseUrl);
    this.artifactInternalKey = String(artifactInternalKey ?? "");
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async request(path, { userId, tenantId, sessionId, method = "GET", body } = {}) {
    if (!this.baseUrl || !this.internalKey) {
      throw new PictureClientError("picture_not_configured", "Picture-Hermes não está configurado.", 503);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.internalKey}`,
          "Content-Type": "application/json",
          "X-Nexus-User-Id": userId,
          "X-Nexus-Tenant-Id": tenantId,
          ...(sessionId ? { "X-Nexus-Session-Id": sessionId } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = typeof payload?.error === "string" ? payload.error : "picture_upstream_failed";
        throw new PictureClientError(code, `Picture request failed (${response.status}).`, response.status);
      }
      return payload?.data ?? payload;
    } catch (error) {
      if (error instanceof PictureClientError) throw error;
      if (controller.signal.aborted) throw new PictureClientError("picture_timeout", "Picture-Hermes demorou para responder.", 504);
      throw new PictureClientError("picture_unavailable", "Picture-Hermes está indisponível.", 503, { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  ensureWorkspace({ userId, tenantId, sessionId, title }) {
    return this.request("/internal/workspaces/ensure", {
      userId, tenantId, sessionId, method: "POST", body: { chat_session_id: sessionId, ...(title ? { title } : {}) },
    });
  }

  getWorkspace({ userId, tenantId, workspaceId, sessionId }) {
    return this.request(`/internal/workspaces/${encodeURIComponent(workspaceId)}`, { userId, tenantId, sessionId });
  }

  getFiles({ userId, tenantId, workspaceId }) {
    return this.request(`/internal/workspaces/${encodeURIComponent(workspaceId)}/manifest`, { userId, tenantId });
  }

  approve({ userId, tenantId, workspaceId }) {
    return this.request(`/internal/workspaces/${encodeURIComponent(workspaceId)}/approve`, { userId, tenantId, method: "POST", body: {} });
  }

  reset({ userId, tenantId, workspaceId }) {
    return this.request(`/internal/workspaces/${encodeURIComponent(workspaceId)}/reset`, { userId, tenantId, method: "POST", body: {} });
  }

  async uploadAttachment({ userId, sessionId, attachment }) {
    if (!this.artifactBaseUrl || !this.artifactInternalKey) {
      throw new PictureClientError("picture_artifact_not_configured", "Armazenamento de referências Picture não configurado.", 503);
    }
    const source = dataUrlBytes(attachment.inline_data_url);
    const response = await this.fetchImpl(`${this.artifactBaseUrl}/v1/artifacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.artifactInternalKey}`,
        "Content-Type": attachment.mime_type || source.contentType,
        "X-Nexus-Owner-Id": userId,
        "X-Nexus-Session-Id": sessionId,
        "X-Nexus-Filename": attachment.name || "referencia.bin",
        "X-Nexus-Content-Type": attachment.mime_type || source.contentType,
        "X-Nexus-Source": "picture-hermes-bridge",
      },
      body: source.bytes,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.id) {
      throw new PictureClientError("picture_reference_upload_failed", `Falha ao importar referência (${response.status}).`, response.status || 502);
    }
    return payload;
  }

  async importPreparedReferences({ userId, tenantId, sessionId, workspaceId, attachments }) {
    if (!Array.isArray(attachments) || attachments.length === 0) return [];
    const uploaded = [];
    for (const attachment of attachments) {
      uploaded.push(await this.uploadAttachment({ userId, sessionId, attachment }));
    }
    return this.request(`/internal/workspaces/${encodeURIComponent(workspaceId)}/references`, {
      userId,
      tenantId,
      sessionId,
      method: "POST",
      body: { artifact_ids: uploaded.map((artifact) => artifact.id) },
    });
  }
}
