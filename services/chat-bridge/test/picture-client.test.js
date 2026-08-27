import assert from "node:assert/strict";
import test from "node:test";

import { PictureClient } from "../src/picture-client.js";

const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

test("Picture client scopes every request without exposing its internal key", async () => {
  const calls = [];
  const client = new PictureClient({
    baseUrl: "http://picture-it:8090/",
    internalKey: "picture-internal-secret",
    fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return json({ data: { id: "workspace-1" } }); },
  });
  await client.ensureWorkspace({ userId: "user-1", tenantId: "ens", sessionId: "session-1" });
  await client.getWorkspace({ userId: "user-1", tenantId: "ens", workspaceId: "workspace-1", sessionId: "session-1" });
  await client.getFiles({ userId: "user-1", tenantId: "ens", workspaceId: "workspace-1" });
  assert.deepEqual(calls.map((call) => [call.init.method || "GET", call.url]), [
    ["POST", "http://picture-it:8090/internal/workspaces/ensure"],
    ["GET", "http://picture-it:8090/internal/workspaces/workspace-1"],
    ["GET", "http://picture-it:8090/internal/workspaces/workspace-1/manifest"],
  ]);
  assert.equal(new Headers(calls[0].init.headers).get("authorization"), "Bearer picture-internal-secret");
  assert.equal(new Headers(calls[0].init.headers).get("x-nexus-user-id"), "user-1");
});

test("approve and reset use human-only REST endpoints and safe errors", async () => {
  const calls = [];
  const client = new PictureClient({
    baseUrl: "http://picture-it:8090",
    internalKey: "do-not-leak-key",
    fetchImpl: async (url, init) => {
      calls.push(`${init.method} ${url}`);
      if (String(url).endsWith("/approve")) return json({ data: { status: "validated" } });
      return json({ error: "picture_approval_required" }, 409);
    },
  });
  const scope = { userId: "u", tenantId: "ens", workspaceId: "w" };
  assert.equal((await client.approve(scope)).status, "validated");
  await assert.rejects(client.reset(scope), (error) => error.code === "picture_approval_required" && !error.message.includes("do-not-leak-key"));
  assert.deepEqual(calls, [
    "POST http://picture-it:8090/internal/workspaces/w/approve",
    "POST http://picture-it:8090/internal/workspaces/w/reset",
  ]);
});

test("prepared chat attachments are uploaded and registered before Hermes", async () => {
  const calls = [];
  const client = new PictureClient({
    baseUrl: "http://picture-it:8090",
    internalKey: "picture-key",
    artifactBaseUrl: "http://artifact-server:8095",
    artifactInternalKey: "artifact-key",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return String(url).includes("artifact-server") ? json({ id: "artifact-1" }, 201) : json({ data: [{ id: "reference-1" }] });
    },
  });
  const imported = await client.importPreparedReferences({
    userId: "user-1", tenantId: "ens", sessionId: "session-1", workspaceId: "workspace-1",
    attachments: [{ name: "logo.png", mime_type: "image/png", inline_data_url: "data:image/png;base64,bG9nbw==" }],
  });
  assert.equal(imported.length, 1);
  assert.equal(calls[0].url, "http://artifact-server:8095/v1/artifacts");
  assert.equal(calls[1].url, "http://picture-it:8090/internal/workspaces/workspace-1/references");
});
