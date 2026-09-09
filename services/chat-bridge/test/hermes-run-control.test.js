import assert from "node:assert/strict";
import test from "node:test";

import {
  HermesRunControlError,
  assertStoppableHermesRun,
} from "../src/hermes-run-control.js";

const activeRun = {
  id: "bridge-1",
  user_id: "user-1",
  mode: "runs",
  status: "running",
  hermes_run_id: "hermes-1",
};

test("assertStoppableHermesRun accepts an owned active Runs execution", () => {
  assert.equal(assertStoppableHermesRun(activeRun, "user-1"), activeRun);
});

test("assertStoppableHermesRun hides missing and cross-user runs", () => {
  for (const run of [null, { ...activeRun, user_id: "user-2" }]) {
    assert.throws(
      () => assertStoppableHermesRun(run, "user-1"),
      (error) => error instanceof HermesRunControlError && error.code === "run_not_found" && error.status === 404,
    );
  }
});

test("assertStoppableHermesRun rejects terminal runs including cancelled", () => {
  for (const status of ["completed", "failed", "cancelled", "canceled", "expired", "interrupted"]) {
    assert.throws(
      () => assertStoppableHermesRun({ ...activeRun, status }, "user-1"),
      (error) => error instanceof HermesRunControlError && error.code === "run_not_active" && error.status === 409,
    );
  }
});

test("assertStoppableHermesRun rejects duplicate stopping and non-Runs transports", () => {
  assert.throws(
    () => assertStoppableHermesRun({ ...activeRun, status: "stopping" }, "user-1"),
    (error) => error instanceof HermesRunControlError && error.code === "run_already_stopping" && error.status === 409,
  );
  assert.throws(
    () => assertStoppableHermesRun({ ...activeRun, mode: "session", hermes_run_id: null }, "user-1"),
    (error) => error instanceof HermesRunControlError && error.code === "run_not_stoppable" && error.status === 409,
  );
});
