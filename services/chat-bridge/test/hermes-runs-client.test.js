import assert from "node:assert/strict";
import test from "node:test";

import {
  HermesRunsCapabilityError,
  HermesRunsClient,
  HermesRunsRequestError,
  REQUIRED_RUN_FEATURES,
} from "../src/hermes-runs-client.js";

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json" },
});

test("HermesRunsClient accepts the pinned Runs capability contract", async () => {
  const calls = [];
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642/",
    apiKey: "test-key",
    defaultHeaders: {
      "X-Tenant-Id": "ens",
      "X-User-Id": "user-1",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return json({ features: [...REQUIRED_RUN_FEATURES, "run_steer"] });
    },
  });

  await assert.doesNotReject(() => client.assertCapabilities());
  await assert.doesNotReject(() => client.assertCapabilities());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://hermes:8642/v1/capabilities");
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer test-key");
  assert.equal(new Headers(calls[0].init.headers).get("x-tenant-id"), "ens");
  assert.equal(new Headers(calls[0].init.headers).get("x-user-id"), "user-1");
});

test("HermesRunsClient accepts object dictionary format for features from Hermes API server", async () => {
  const featureMap = Object.fromEntries(
    [...REQUIRED_RUN_FEATURES, "run_steer"].map((f) => [f, true]),
  );
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642/",
    apiKey: "test-key",
    fetchImpl: async () => json({ features: featureMap }),
  });

  await assert.doesNotReject(() => client.assertCapabilities());
});

test("HermesRunsClient fails closed when a required capability is missing", async () => {
  const available = REQUIRED_RUN_FEATURES.filter((feature) => feature !== "run_stop");
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642",
    apiKey: "do-not-leak",
    fetchImpl: async () => json({ features: available }),
  });

  await assert.rejects(
    client.assertCapabilities(),
    (error) => (
      error instanceof HermesRunsCapabilityError
      && error.code === "hermes_capability_missing"
      && error.missingFeatures.includes("run_stop")
      && !error.message.includes("do-not-leak")
    ),
  );
});

test("HermesRunsClient maps a capabilities network failure to a safe unavailable error", async () => {
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642",
    apiKey: "do-not-leak",
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED http://hermes:8642?token=do-not-leak");
    },
  });

  await assert.rejects(
    client.assertCapabilities(),
    (error) => (
      error instanceof HermesRunsCapabilityError
      && error.code === "hermes_unavailable"
      && !error.message.includes("do-not-leak")
      && !error.message.includes("ECONNREFUSED")
    ),
  );
});

test("HermesRunsClient creates an official Run with Bridge idempotency", async () => {
  const calls = [];
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642",
    apiKey: "internal-key",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/capabilities")) {
        return json({ features: REQUIRED_RUN_FEATURES });
      }
      return json({ run_id: "run_123", status: "queued", session_id: "nexus:session-1" }, 202);
    },
  });
  const payload = { session_id: "nexus:session-1", input: "Ola" };

  const created = await client.createRun({ bridgeRunId: "bridge-run-1", payload });

  assert.equal(created.runId, "run_123");
  assert.equal(calls[1].url, "http://hermes:8642/v1/runs");
  assert.equal(calls[1].init.method, "POST");
  const headers = new Headers(calls[1].init.headers);
  assert.equal(headers.get("authorization"), "Bearer internal-key");
  assert.equal(headers.get("idempotency-key"), "bridge-run-1");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(calls[1].init.body), payload);
});

test("HermesRunsClient rejects a create response without run_id", async () => {
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642",
    apiKey: "do-not-leak",
    fetchImpl: async (url) => (
      String(url).endsWith("/v1/capabilities")
        ? json({ features: REQUIRED_RUN_FEATURES })
        : json({ status: "queued" }, 202)
    ),
  });

  await assert.rejects(
    client.createRun({ bridgeRunId: "bridge-1", payload: { input: "Oi" } }),
    (error) => (
      error instanceof HermesRunsRequestError
      && error.code === "hermes_invalid_response"
      && !error.message.includes("do-not-leak")
    ),
  );
});

test("HermesRunsClient maps idempotency conflicts without exposing the response body", async () => {
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642",
    apiKey: "do-not-leak",
    fetchImpl: async (url) => (
      String(url).endsWith("/v1/capabilities")
        ? json({ features: REQUIRED_RUN_FEATURES })
        : json({ detail: "secret upstream diagnostic" }, 409)
    ),
  });

  await assert.rejects(
    client.createRun({ bridgeRunId: "bridge-1", payload: { input: "Oi" } }),
    (error) => (
      error instanceof HermesRunsRequestError
      && error.code === "hermes_idempotency_conflict"
      && error.status === 409
      && !error.message.includes("secret upstream diagnostic")
      && !error.message.includes("do-not-leak")
    ),
  );
});

test("HermesRunsClient uses official events and status endpoints", async () => {
  const calls = [];
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/events")) {
        return new Response("event: run.started\ndata: {}\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      }
      return json({ run_id: "run/with space", status: "running" });
    },
  });

  const events = await client.getEvents("run/with space");
  const run = await client.getRun("run/with space");

  assert.equal(await events.text(), "event: run.started\ndata: {}\n\n");
  assert.equal(run.status, "running");
  assert.deepEqual(calls.map(({ url, init }) => [url, new Headers(init.headers).get("accept")]), [
    ["http://hermes:8642/v1/runs/run%2Fwith%20space/events", "text/event-stream"],
    ["http://hermes:8642/v1/runs/run%2Fwith%20space", "application/json"],
  ]);
});

test("HermesRunsClient maps a request network failure to a safe unavailable error", async () => {
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642",
    apiKey: "do-not-leak",
    fetchImpl: async () => {
      throw new Error("socket closed with do-not-leak");
    },
  });

  await assert.rejects(
    client.getRun("run_1"),
    (error) => (
      error instanceof HermesRunsRequestError
      && error.code === "hermes_unavailable"
      && error.status === null
      && !error.message.includes("do-not-leak")
      && !error.message.includes("socket closed")
    ),
  );
});

test("HermesRunsClient responds to approval and stops through official Run endpoints", async () => {
  const calls = [];
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return json({ run_id: "run_1", status: String(url).endsWith("/stop") ? "stopping" : "running" });
    },
  });

  await client.respondApproval("run_1", { choice: "once" });
  await client.stopRun("run_1");

  assert.deepEqual(calls.map(({ url, init }) => [url, init.method, init.body ? JSON.parse(init.body) : null]), [
    ["http://hermes:8642/v1/runs/run_1/approval", "POST", { choice: "once" }],
    ["http://hermes:8642/v1/runs/run_1/stop", "POST", null],
  ]);
});

test("HermesRunsClient rejects an unsupported approval choice before fetch", async () => {
  let called = false;
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642",
    fetchImpl: async () => {
      called = true;
      return json({});
    },
  });

  await assert.rejects(
    client.respondApproval("run_1", { choice: "approve-everything" }),
    (error) => error instanceof HermesRunsRequestError && error.code === "hermes_invalid_approval_choice",
  );
  assert.equal(called, false);
});
