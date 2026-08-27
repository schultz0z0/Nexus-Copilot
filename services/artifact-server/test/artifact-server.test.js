import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createArtifactServer } from "../src/server.js";

const listen = async (handler) => {
  const server = handler.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

const withServer = async (fn, options = {}) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "nexus-artifacts-"));
  const app = createArtifactServer({
    dataDir,
    internalKey: "internal-test-key",
    accessTokenSecret: "access-test-secret",
    publicBaseUrl: "https://arquivos.example.test",
    maxUploadBytes: options.maxUploadBytes ?? 1024 * 1024,
    now: () => new Date("2026-06-19T12:00:00.000Z"),
  });
  const runtime = await listen(app);

  try {
    await fn({ ...runtime, dataDir });
  } finally {
    await runtime.close();
    await rm(dataDir, { recursive: true, force: true });
  }
};

const uploadArtifact = async ({ baseUrl, ownerId = "user-1", body = "hello artifact" }) => {
  const response = await fetch(`${baseUrl}/v1/artifacts`, {
    method: "POST",
    headers: {
      Authorization: "Bearer internal-test-key",
      "Content-Type": "text/plain",
      "X-Nexus-Owner-Id": ownerId,
      "X-Nexus-Session-Id": "session-1",
      "X-Nexus-Filename": "relatorio final.txt",
    },
    body,
  });

  return {
    response,
    payload: await response.json().catch(() => ({})),
  };
};

test("health endpoint is public", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test("uploads bytes with internal auth and persists content-addressed object", async () => {
  await withServer(async ({ baseUrl, dataDir }) => {
    const { response, payload } = await uploadArtifact({ baseUrl });

    assert.equal(response.status, 201);
    assert.equal(payload.owner_id, "user-1");
    assert.equal(payload.session_id, "session-1");
    assert.equal(payload.filename, "relatorio final.txt");
    assert.equal(payload.content_type, "text/plain");
    assert.equal(payload.size, 14);
    assert.match(payload.id, /^[0-9a-f-]{36}$/);
    assert.match(payload.sha256, /^[a-f0-9]{64}$/);

    const objectPath = path.join(dataDir, "objects", payload.sha256.slice(0, 2), payload.sha256);
    assert.equal(await readFile(objectPath, "utf8"), "hello artifact");
  });
});

test("upload rejects missing internal bearer token", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/v1/artifacts`, {
      method: "POST",
      headers: {
        "X-Nexus-Owner-Id": "user-1",
        "X-Nexus-Filename": "arquivo.txt",
      },
      body: "private",
    });

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "unauthorized");
  });
});

test("upload limit is per artifact, not a total storage quota", async () => {
  await withServer(async ({ baseUrl }) => {
    const first = await uploadArtifact({ baseUrl, body: "1234" });
    const second = await uploadArtifact({ baseUrl, body: "5678" });
    const tooLarge = await uploadArtifact({ baseUrl, body: "123456" });

    assert.equal(first.response.status, 201);
    assert.equal(second.response.status, 201);
    assert.equal(tooLarge.response.status, 413);
    assert.equal(tooLarge.payload.error, "upload_too_large");
  }, { maxUploadBytes: 5 });
});

test("signed access link serves file bytes only for matching owner", async () => {
  await withServer(async ({ baseUrl }) => {
    const { payload: uploaded } = await uploadArtifact({ baseUrl });

    const linkResponse = await fetch(`${baseUrl}/v1/artifacts/${uploaded.id}/access-link`, {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ owner_id: "user-1", expires_in_seconds: 300 }),
    });

    assert.equal(linkResponse.status, 200);
    const linkPayload = await linkResponse.json();
    assert.match(linkPayload.url, /^https:\/\/arquivos\.example\.test\/v1\/artifacts\/[0-9a-f-]+\/content\?token=/);
    assert.equal(linkPayload.expires_at, "2026-06-19T12:05:00.000Z");

    const localUrl = linkPayload.url.replace("https://arquivos.example.test", baseUrl);
    const fileResponse = await fetch(localUrl);
    assert.equal(fileResponse.status, 200);
    assert.equal(fileResponse.headers.get("content-type"), "text/plain");
    assert.equal(fileResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await fileResponse.text(), "hello artifact");
  });
});

test("content endpoint supports byte ranges for previews", async () => {
  await withServer(async ({ baseUrl }) => {
    const { payload: uploaded } = await uploadArtifact({ baseUrl, body: "hello artifact" });
    const linkResponse = await fetch(`${baseUrl}/v1/artifacts/${uploaded.id}/access-link`, {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ owner_id: "user-1", expires_in_seconds: 300 }),
    });
    const linkPayload = await linkResponse.json();

    const localUrl = linkPayload.url.replace("https://arquivos.example.test", baseUrl);
    const rangeResponse = await fetch(localUrl, {
      headers: { Range: "bytes=0-4" },
    });

    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get("accept-ranges"), "bytes");
    assert.equal(rangeResponse.headers.get("content-range"), "bytes 0-4/14");
    assert.equal(rangeResponse.headers.get("content-length"), "5");
    assert.equal(await rangeResponse.text(), "hello");
  });
});

test("access link refuses owner mismatch", async () => {
  await withServer(async ({ baseUrl }) => {
    const { payload: uploaded } = await uploadArtifact({ baseUrl, ownerId: "user-1" });
    const response = await fetch(`${baseUrl}/v1/artifacts/${uploaded.id}/access-link`, {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ owner_id: "user-2", expires_in_seconds: 300 }),
    });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "forbidden");
  });
});

test("content endpoint refuses missing or invalid signed token", async () => {
  await withServer(async ({ baseUrl }) => {
    const { payload: uploaded } = await uploadArtifact({ baseUrl });

    const missing = await fetch(`${baseUrl}/v1/artifacts/${uploaded.id}/content`);
    assert.equal(missing.status, 401);

    const invalid = await fetch(`${baseUrl}/v1/artifacts/${uploaded.id}/content?token=bad`);
    assert.equal(invalid.status, 401);
  });
});
