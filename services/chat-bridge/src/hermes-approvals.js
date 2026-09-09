const OFFICIAL_CHOICES = new Set(["once", "session", "always", "deny"]);

export class HermesApprovalRegistryError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "HermesApprovalRegistryError";
    this.code = code;
    this.status = status;
  }
}

const clone = (record) => ({ ...record, choices: [...record.choices] });

export const toOfficialApprovalChoice = (payload = {}) => {
  if (OFFICIAL_CHOICES.has(payload.choice)) return payload.choice;
  if (payload.decision === "deny") return "deny";
  if (payload.decision === "approve" && payload.trust_scope === "always") return "always";
  if (payload.decision === "approve" && payload.trust_scope === "session") return "session";
  throw new HermesApprovalRegistryError("approval_choice_invalid", 400);
};

export const toApprovalStreamPayload = (record) => ({
  type: "approval_request",
  request_id: record.requestId,
  event: "hermes.run.approval",
  command: "",
  description: record.summary,
  expires_in: 30,
  choices: [...record.choices],
  bridge_run_id: record.bridgeRunId,
});

export class HermesApprovalRegistry {
  constructor() {
    this.records = new Map();
    this.subscribers = new Map();
  }

  register({ userId, bridgeRunId, hermesRunId, requestId, choices, summary = "" }) {
    const existing = this.records.get(requestId);
    if (existing) return clone(existing);

    const allowedChoices = Array.isArray(choices)
      ? choices.filter((choice) => OFFICIAL_CHOICES.has(choice))
      : [];
    if (!userId || !bridgeRunId || !hermesRunId || !requestId || allowedChoices.length === 0) {
      throw new HermesApprovalRegistryError("approval_request_invalid", 400);
    }

    const record = {
      userId,
      bridgeRunId,
      hermesRunId,
      requestId,
      choices: [...new Set(allowedChoices)],
      summary: String(summary).slice(0, 500),
      status: "pending",
      choice: null,
    };
    this.records.set(requestId, record);
    this.notify(record);
    return clone(record);
  }

  pendingForUser(userId) {
    return [...this.records.values()]
      .filter((record) => record.userId === userId && record.status === "pending")
      .map(clone);
  }

  claim({ userId, requestId, choice }) {
    const record = this.records.get(requestId);
    if (!record || record.userId !== userId) {
      throw new HermesApprovalRegistryError("approval_not_found", 404);
    }
    if (record.status === "resolved") {
      throw new HermesApprovalRegistryError("approval_already_resolved", 409);
    }
    if (record.status === "resolving") {
      throw new HermesApprovalRegistryError("approval_already_resolving", 409);
    }
    if (!OFFICIAL_CHOICES.has(choice) || !record.choices.includes(choice)) {
      throw new HermesApprovalRegistryError("approval_choice_not_allowed", 400);
    }

    record.status = "resolving";
    record.choice = choice;
    return clone(record);
  }

  complete(requestId, choice = null) {
    const record = this.records.get(requestId);
    if (!record) return null;
    record.status = "resolved";
    record.choice = OFFICIAL_CHOICES.has(choice) ? choice : record.choice;
    return clone(record);
  }

  release(requestId) {
    const record = this.records.get(requestId);
    if (!record || record.status !== "resolving") return null;
    record.status = "pending";
    record.choice = null;
    return clone(record);
  }

  subscribe(userId, listener) {
    const listeners = this.subscribers.get(userId) ?? new Set();
    listeners.add(listener);
    this.subscribers.set(userId, listeners);
    this.pendingForUser(userId).forEach(listener);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.subscribers.delete(userId);
    };
  }

  notify(record) {
    if (record.status !== "pending") return;
    this.subscribers.get(record.userId)?.forEach((listener) => listener(clone(record)));
  }
}
