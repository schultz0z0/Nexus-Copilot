const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "expired",
  "interrupted",
]);

export class HermesRunControlError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "HermesRunControlError";
    this.code = code;
    this.status = status;
  }
}

export const assertStoppableHermesRun = (run, userId) => {
  if (!run || run.user_id !== userId) {
    throw new HermesRunControlError("run_not_found", 404);
  }
  if (TERMINAL_STATUSES.has(run.status)) {
    throw new HermesRunControlError("run_not_active", 409);
  }
  if (run.status === "stopping") {
    throw new HermesRunControlError("run_already_stopping", 409);
  }
  if (run.mode !== "runs" || typeof run.hermes_run_id !== "string" || !run.hermes_run_id.trim()) {
    throw new HermesRunControlError("run_not_stoppable", 409);
  }
  return run;
};
