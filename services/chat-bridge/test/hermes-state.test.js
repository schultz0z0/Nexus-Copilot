import assert from "node:assert/strict";
import test from "node:test";

import {
  bindHermesSessionFromResponse,
  buildInitialHermesConversationState,
  createMemoryHermesStateRepository,
} from "../src/hermes-state.js";

test("bindHermesSessionFromResponse persists the real Responses API Hermes session id", async () => {
  const repository = createMemoryHermesStateRepository();
  let state = await repository.upsert(buildInitialHermesConversationState({
    chatSessionId: "session-1",
    userId: "user-1",
  }));
  const run = { hermes_session_id: "nexus:session-1" };
  const response = new Response(null, {
    headers: {
      "X-Hermes-Session-Id": "actual-hermes-session",
    },
  });

  state = await bindHermesSessionFromResponse({ repository, state, run, response });

  assert.equal(state.hermes_session_id, "actual-hermes-session");
  assert.equal(run.hermes_session_id, "actual-hermes-session");

  const persisted = await repository.get("session-1", "user-1");
  assert.equal(persisted.hermes_session_id, "actual-hermes-session");
});

test("bindHermesSessionFromResponse keeps state unchanged when header is absent", async () => {
  const repository = createMemoryHermesStateRepository();
  const state = await repository.upsert({
    ...buildInitialHermesConversationState({ chatSessionId: "session-1", userId: "user-1" }),
    hermes_session_id: "existing-session",
  });
  const run = { hermes_session_id: "existing-session" };
  const response = new Response(null);

  const next = await bindHermesSessionFromResponse({ repository, state, run, response });

  assert.equal(next, state);
  assert.equal(run.hermes_session_id, "existing-session");
});
