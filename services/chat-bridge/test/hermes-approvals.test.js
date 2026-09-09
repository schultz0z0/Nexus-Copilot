import assert from "node:assert/strict";
import test from "node:test";

import {
  HermesApprovalRegistry,
  HermesApprovalRegistryError,
  toOfficialApprovalChoice,
} from "../src/hermes-approvals.js";

const request = {
  userId: "user-1",
  bridgeRunId: "bridge-1",
  hermesRunId: "hermes-1",
  requestId: "approval-1",
  choices: ["once", "session", "always", "deny"],
  summary: "Executar a ferramenta de publicação",
};

test("HermesApprovalRegistry binds an approval to its user and both run ids", () => {
  const registry = new HermesApprovalRegistry();

  const stored = registry.register(request);

  assert.deepEqual(stored, {
    ...request,
    status: "pending",
    choice: null,
  });
  assert.deepEqual(registry.pendingForUser("user-1"), [stored]);
  assert.deepEqual(registry.pendingForUser("user-2"), []);
});

test("HermesApprovalRegistry claims a request only once and can complete it", () => {
  const registry = new HermesApprovalRegistry();
  registry.register(request);

  const claimed = registry.claim({ userId: "user-1", requestId: "approval-1", choice: "session" });
  assert.equal(claimed.status, "resolving");
  assert.equal(claimed.choice, "session");

  assert.throws(
    () => registry.claim({ userId: "user-1", requestId: "approval-1", choice: "session" }),
    (error) => error instanceof HermesApprovalRegistryError && error.code === "approval_already_resolving",
  );

  registry.complete("approval-1", "session");
  assert.deepEqual(registry.pendingForUser("user-1"), []);
  assert.throws(
    () => registry.claim({ userId: "user-1", requestId: "approval-1", choice: "session" }),
    (error) => error instanceof HermesApprovalRegistryError && error.code === "approval_already_resolved",
  );
});

test("HermesApprovalRegistry denies cross-user and unsupported choices", () => {
  const registry = new HermesApprovalRegistry();
  registry.register({ ...request, choices: ["once", "deny"] });

  assert.throws(
    () => registry.claim({ userId: "user-2", requestId: "approval-1", choice: "once" }),
    (error) => error instanceof HermesApprovalRegistryError && error.code === "approval_not_found" && error.status === 404,
  );
  assert.throws(
    () => registry.claim({ userId: "user-1", requestId: "approval-1", choice: "always" }),
    (error) => error instanceof HermesApprovalRegistryError && error.code === "approval_choice_not_allowed" && error.status === 400,
  );
});

test("HermesApprovalRegistry releases a failed upstream attempt for safe retry", () => {
  const registry = new HermesApprovalRegistry();
  registry.register(request);
  registry.claim({ userId: "user-1", requestId: "approval-1", choice: "once" });

  registry.release("approval-1");

  const retried = registry.claim({ userId: "user-1", requestId: "approval-1", choice: "deny" });
  assert.equal(retried.status, "resolving");
  assert.equal(retried.choice, "deny");
});

test("HermesApprovalRegistry replays pending requests and publishes new ones", () => {
  const registry = new HermesApprovalRegistry();
  registry.register(request);
  const received = [];

  const unsubscribe = registry.subscribe("user-1", (record) => received.push(record.requestId));
  registry.register({ ...request, requestId: "approval-2" });
  unsubscribe();
  registry.register({ ...request, requestId: "approval-3" });

  assert.deepEqual(received, ["approval-1", "approval-2"]);
});

test("toOfficialApprovalChoice preserves the frontend contract", () => {
  assert.equal(toOfficialApprovalChoice({ decision: "deny", trust_scope: "always" }), "deny");
  assert.equal(toOfficialApprovalChoice({ decision: "approve", trust_scope: "always" }), "always");
  assert.equal(toOfficialApprovalChoice({ decision: "approve", trust_scope: "session" }), "session");
  assert.equal(toOfficialApprovalChoice({ choice: "once" }), "once");
  assert.throws(
    () => toOfficialApprovalChoice({ decision: "approve", trust_scope: "unknown" }),
    (error) => error instanceof HermesApprovalRegistryError && error.code === "approval_choice_invalid",
  );
});
