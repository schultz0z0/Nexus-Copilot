export const REQUIRED_RUN_FEATURES = Object.freeze([
  "run_submission",
  "run_status",
  "run_events_sse",
  "run_stop",
  "run_approval_response",
  "approval_events",
]);

export class HermesRunsCapabilityError extends Error {
  constructor(message, { code = "hermes_capability_invalid", missingFeatures = [] } = {}) {
    super(message);
    this.name = "HermesRunsCapabilityError";
    this.code = code;
    this.missingFeatures = missingFeatures;
  }
}

export class HermesRunsRequestError extends Error {
  constructor(message, { code = "hermes_request_failed", status = null } = {}) {
    super(message);
    this.name = "HermesRunsRequestError";
    this.code = code;
    this.status = status;
  }
}

const APPROVAL_CHOICES = new Set(["once", "session", "always", "deny"]);

const requestErrorCode = (status) => {
  if (status === 401 || status === 403) return "hermes_auth_failed";
  if (status === 404) return "hermes_run_not_found";
  if (status === 409) return "hermes_idempotency_conflict";
  if (status >= 500) return "hermes_unavailable";
  return "hermes_request_failed";
};

export class HermesRunsClient {
  constructor({ baseUrl, apiKey = "", defaultHeaders = {}, fetchImpl = fetch }) {
    this.baseUrl = new URL(String(baseUrl));
    this.apiKey = apiKey;
    this.defaultHeaders = { ...defaultHeaders };
    this.fetchImpl = fetchImpl;
    this.capabilitiesVerified = false;
  }

  buildHeaders(accept = "application/json") {
    return {
      ...this.defaultHeaders,
      Accept: accept,
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async request(path, { method = "GET", body, accept = "application/json", headers = {}, parseJson = true } = {}) {
    let response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers: {
          ...this.buildHeaders(accept),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new HermesRunsRequestError(
        "Hermes is unavailable.",
        { code: "hermes_unavailable" },
      );
    }

    if (!response.ok) {
      throw new HermesRunsRequestError(
        `Hermes request failed with HTTP ${response.status}.`,
        { code: requestErrorCode(response.status), status: response.status },
      );
    }
    if (!parseJson) return response;

    try {
      return await response.json();
    } catch {
      throw new HermesRunsRequestError(
        "Hermes returned an invalid JSON response.",
        { code: "hermes_invalid_response", status: response.status },
      );
    }
  }

  async assertCapabilities() {
    if (this.capabilitiesVerified) return;

    let response;
    try {
      response = await this.fetchImpl(
        new URL("/v1/capabilities", this.baseUrl),
        { headers: this.buildHeaders() },
      );
    } catch {
      throw new HermesRunsCapabilityError(
        "Hermes capabilities are unavailable.",
        { code: "hermes_unavailable" },
      );
    }
    if (!response.ok) {
      throw new HermesRunsCapabilityError(
        `Hermes capabilities request failed with HTTP ${response.status}.`,
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new HermesRunsCapabilityError("Hermes capabilities response is not valid JSON.");
    }

    if (!Array.isArray(payload?.features)) {
      throw new HermesRunsCapabilityError("Hermes capabilities response has no feature list.");
    }

    const available = new Set(payload.features);
    const missingFeatures = REQUIRED_RUN_FEATURES.filter((feature) => !available.has(feature));
    if (missingFeatures.length > 0) {
      throw new HermesRunsCapabilityError(
        `Hermes is missing required Runs capabilities: ${missingFeatures.join(", ")}.`,
        { code: "hermes_capability_missing", missingFeatures },
      );
    }

    this.capabilitiesVerified = true;
  }

  async createRun({ bridgeRunId, payload }) {
    await this.assertCapabilities();
    const response = await this.request("/v1/runs", {
      method: "POST",
      body: payload,
      headers: { "Idempotency-Key": bridgeRunId },
    });
    if (typeof response?.run_id !== "string" || !response.run_id.trim()) {
      throw new HermesRunsRequestError(
        "Hermes create Run response has no run_id.",
        { code: "hermes_invalid_response" },
      );
    }
    return { runId: response.run_id, response };
  }

  async getEvents(runId) {
    return await this.request(`/v1/runs/${encodeURIComponent(runId)}/events`, {
      accept: "text/event-stream",
      parseJson: false,
    });
  }

  async getRun(runId) {
    return await this.request(`/v1/runs/${encodeURIComponent(runId)}`);
  }

  async respondApproval(runId, { choice }) {
    if (!APPROVAL_CHOICES.has(choice)) {
      throw new HermesRunsRequestError(
        "Unsupported Hermes approval choice.",
        { code: "hermes_invalid_approval_choice" },
      );
    }
    return await this.request(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: "POST",
      body: { choice },
    });
  }

  async stopRun(runId) {
    return await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, {
      method: "POST",
    });
  }
}
