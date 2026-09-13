import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../src/server.js";

// Mock database helper for auth
function createMockDb(user = null) {
  return {
    query: async (sql, params = []) => {
      const text = typeof sql === "string" ? sql : sql.text || "";
      if (text.includes("iam.resolve_session") || text.includes("FROM iam.sessions")) {
        if (!user) return { rows: [] };
        return {
          rows: [
            {
              id: "session-uuid-1",
              user_id: user.id,
              tenant_id: user.tenant_id,
              role: user.role,
              email: user.email,
              full_name: user.full_name,
              session_expires_at: new Date(Date.now() + 3600_000),
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
}

test("Attachments API - Authentication", async () => {
  const db = createMockDb(null);
  const app = await createApp({ db });

  const res = await app.inject({
    method: "POST",
    url: "/api/attachments",
  });

  assert.equal(res.statusCode, 401);
});

test("Attachments API - Upload via Artifact Server", async () => {
  let artifactServerReceived = false;
  let accessLinkReceived = false;

  // Spin up a mock Artifact Server
  const mockArtifactServer = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/v1/artifacts") {
      artifactServerReceived = true;
      assert.equal(req.headers["authorization"], "Bearer test-internal-key");
      assert.equal(req.headers["x-nexus-owner-id"], "user-123");
      assert.equal(req.headers["x-nexus-filename"], "test.png");

      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "artifact-uuid-123",
          owner_id: "user-123",
          filename: "test.png",
          content_type: "image/png",
          size: 11,
          sha256: "fake-sha",
          content_url: "http://localhost:8095/v1/artifacts/artifact-uuid-123/content",
        })
      );
      return;
    }

    if (req.method === "POST" && req.url === "/v1/artifacts/artifact-uuid-123/access-link") {
      accessLinkReceived = true;
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      assert.equal(parsed.owner_id, "user-123");

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          artifact_id: "artifact-uuid-123",
          url: "http://localhost:8095/v1/artifacts/artifact-uuid-123/content?token=fake-token",
          token: "fake-token",
          expires_at: "2026-09-13T05:00:00.000Z",
        })
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => mockArtifactServer.listen(0, "127.0.0.1", resolve));
  const port = mockArtifactServer.address().port;

  const testUser = {
    id: "user-123",
    tenant_id: "tenant-abc",
    role: "member",
    email: "user@example.com",
    full_name: "Test User",
  };
  const db = createMockDb(testUser);

  const app = await createApp({
    db,
    config: {
      artifactInternalUrl: `http://127.0.0.1:${port}`,
      artifactInternalKey: "test-internal-key",
      artifactAccessTokenTtlSeconds: 900,
    },
  });

  // Construct multipart body
  const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="test.png"',
    "Content-Type: image/png",
    "",
    "hello world",
    `--${boundary}--`,
  ].join("\r\n");

  const res = await app.inject({
    method: "POST",
    url: "/api/attachments",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      authorization: "Bearer valid-token",
    },
    payload: body,
  });

  mockArtifactServer.close();

  assert.equal(res.statusCode, 201);
  const json = JSON.parse(res.body);
  assert.equal(json.attachment.id, "artifact-uuid-123");
  assert.equal(json.attachment.filename, "test.png");
  assert.equal(json.attachment.url, "/api/artifacts/artifact-uuid-123/content?token=fake-token");
  assert.equal(artifactServerReceived, true);
  assert.equal(accessLinkReceived, true);
});

test("Attachments API - Content Proxy", async () => {
  let proxyRequested = false;
  const mockArtifactServer = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/artifacts/art-1/content?token=xyz") {
      proxyRequested = true;
      res.writeHead(200, {
        "content-type": "image/png",
        "content-disposition": 'inline; filename="test.png"',
      });
      res.end("image-bytes");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => mockArtifactServer.listen(0, "127.0.0.1", resolve));
  const port = mockArtifactServer.address().port;

  const app = await createApp({
    db: createMockDb(null),
    config: {
      artifactInternalUrl: `http://127.0.0.1:${port}`,
    },
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/artifacts/art-1/content?token=xyz",
  });

  mockArtifactServer.close();

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.equal(res.body, "image-bytes");
  assert.equal(proxyRequested, true);
});
