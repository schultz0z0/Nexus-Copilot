import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createArtifactServer } from "../src/server.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const INTERNAL_KEY = "internal-test-key";

const listen = async (handler) => {
  const server = handler.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

const withServer = async (fn) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "nexus-artifact-workspaces-"));
  const app = createArtifactServer({
    dataDir,
    internalKey: INTERNAL_KEY,
    accessTokenSecret: "access-test-secret",
    publicBaseUrl: "https://artifacts.example.test",
    now: () => new Date("2026-07-21T19:45:00.000Z"),
  });
  const runtime = await listen(app);
  try {
    await fn({ ...runtime, dataDir });
  } finally {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  }
};

const internalHeaders = {
  Authorization: `Bearer ${INTERNAL_KEY}`,
  "Content-Type": "application/json",
};

const upload = async ({
  baseUrl,
  ownerId = "user-1",
  workspaceId = WORKSPACE_ID,
  relativePath = "planning/steps.json",
  category = "planning",
  lifecycle = "workspace",
  body = "{}",
}) => {
  const response = await fetch(`${baseUrl}/v1/artifacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${INTERNAL_KEY}`,
      "Content-Type": relativePath.endsWith(".png") ? "image/png" : "application/json",
      "X-Nexus-Owner-Id": ownerId,
      "X-Nexus-Filename": relativePath.split("/").at(-1),
      "X-Nexus-Workspace-Id": workspaceId,
      "X-Nexus-Relative-Path": relativePath,
      "X-Nexus-Artifact-Category": category,
      "X-Nexus-Artifact-Lifecycle": lifecycle,
      "X-Nexus-Source": "picture-hermes",
    },
    body,
  });
  return { response, payload: await response.json().catch(() => ({})) };
};

test("workspace upload persists lifecycle metadata without breaking artifact fields", async () => {
  await withServer(async ({ baseUrl }) => {
    const { response, payload } = await upload({ baseUrl });
    assert.equal(response.status, 201);
    assert.equal(payload.workspace_id, WORKSPACE_ID);
    assert.equal(payload.relative_path, "planning/steps.json");
    assert.equal(payload.category, "planning");
    assert.equal(payload.lifecycle, "workspace");
    assert.equal(payload.owner_id, "user-1");
    assert.match(payload.id, /^[0-9a-f-]{36}$/);
  });
});

test("workspace upload rejects traversal and invalid metadata", async () => {
  await withServer(async ({ baseUrl }) => {
    for (const invalid of [
      { relativePath: "../secret.json" },
      { relativePath: "C:/Windows/win.ini" },
      { category: "secret" },
      { lifecycle: "forever" },
      { workspaceId: "not-a-uuid" },
    ]) {
      const { response } = await upload({ baseUrl, ...invalid });
      assert.equal(response.status, 400, JSON.stringify(invalid));
    }
  });
});

test("workspace manifest is owner scoped and ordered", async () => {
  await withServer(async ({ baseUrl }) => {
    await upload({ baseUrl, relativePath: "final/piece.png", category: "final", body: "png" });
    await upload({ baseUrl, relativePath: "brief/brief.json", category: "brief" });
    await upload({ baseUrl, ownerId: "user-2", relativePath: "planning/private.json" });
    await upload({ baseUrl, workspaceId: OTHER_WORKSPACE_ID, relativePath: "planning/other.json" });

    const response = await fetch(
      `${baseUrl}/v1/workspaces/${WORKSPACE_ID}/artifacts?owner_id=user-1`,
      { headers: { Authorization: `Bearer ${INTERNAL_KEY}` } },
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.artifacts.map((item) => item.relative_path), [
      "brief/brief.json",
      "final/piece.png",
    ]);

    const forbidden = await fetch(
      `${baseUrl}/v1/workspaces/${WORKSPACE_ID}/artifacts?owner_id=user-3`,
      { headers: { Authorization: `Bearer ${INTERNAL_KEY}` } },
    );
    assert.equal(forbidden.status, 200);
    assert.deepEqual((await forbidden.json()).artifacts, []);
  });
});

test("only a final artifact can be promoted and promotion is idempotent", async () => {
  await withServer(async ({ baseUrl }) => {
    const { payload: planning } = await upload({ baseUrl });
    const invalid = await fetch(`${baseUrl}/v1/artifacts/${planning.id}/promote`, {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({ owner_id: "user-1", workspace_id: WORKSPACE_ID }),
    });
    assert.equal(invalid.status, 409);

    const { payload: final } = await upload({
      baseUrl,
      relativePath: "final/piece.png",
      category: "final",
      body: "same bytes",
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${baseUrl}/v1/artifacts/${final.id}/promote`, {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({ owner_id: "user-1", workspace_id: WORKSPACE_ID }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).lifecycle, "validated");
    }
  });
});

test("workspace cleanup removes temporary metadata and preserves promoted bytes", async () => {
  await withServer(async ({ baseUrl }) => {
    const { payload: temporary } = await upload({ baseUrl, body: "same bytes" });
    const { payload: final } = await upload({
      baseUrl,
      relativePath: "final/piece.png",
      category: "final",
      body: "same bytes",
    });
    await fetch(`${baseUrl}/v1/artifacts/${final.id}/promote`, {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({ owner_id: "user-1", workspace_id: WORKSPACE_ID }),
    });

    for (const expectedDeleted of [1, 0]) {
      const response = await fetch(
        `${baseUrl}/v1/workspaces/${WORKSPACE_ID}/artifacts?owner_id=user-1`,
        { method: "DELETE", headers: { Authorization: `Bearer ${INTERNAL_KEY}` } },
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).deleted_count, expectedDeleted);
    }

    const removed = await fetch(`${baseUrl}/v1/artifacts/${temporary.id}`, {
      headers: { Authorization: `Bearer ${INTERNAL_KEY}` },
    });
    assert.equal(removed.status, 404);

    const kept = await fetch(`${baseUrl}/v1/artifacts/${final.id}`, {
      headers: { Authorization: `Bearer ${INTERNAL_KEY}` },
    });
    assert.equal(kept.status, 200);
    assert.equal((await kept.json()).lifecycle, "validated");
  });
});
