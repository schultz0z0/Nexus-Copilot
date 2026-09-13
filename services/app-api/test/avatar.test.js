import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../src/server.js";

function createMockDb(user = null) {
  let userAvatar = null;
  return {
    getAvatar: () => userAvatar,
    query: async (sql, params = []) => {
      const text = typeof sql === "string" ? sql : sql.text || "";
      if (text.includes("iam.resolve_session") || text.includes("FROM iam.sessions")) {
        if (!user) return { rows: [] };
        return {
          rows: [
            {
              session_id: "session-uuid-1",
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
      if (text.includes("SELECT avatar_url FROM iam.principals")) {
        return { rows: [{ avatar_url: userAvatar }] };
      }
      if (text.includes("UPDATE iam.principals SET avatar_url")) {
        userAvatar = params[0];
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
  };
}

test("Avatar API - Upload own avatar updates profile and returns avatar_url", async (t) => {
  const mockArtifactServer = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/v1/artifacts") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "avatar-art-1",
          owner_id: "user-1",
          filename: "avatar.png",
          content_type: "image/png",
          size: 100,
          sha256: "sha-avatar",
        })
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/artifacts/avatar-art-1/access-link") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          artifact_id: "avatar-art-1",
          url: "http://localhost:8095/v1/artifacts/avatar-art-1/content?token=av-token",
          token: "av-token",
          expires_at: "2027-01-01T00:00:00.000Z",
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => mockArtifactServer.listen(0, "127.0.0.1", resolve));
  t.after(() => mockArtifactServer.close());
  const port = mockArtifactServer.address().port;

  const user = { id: "user-1", tenant_id: "tenant-1", role: "member", email: "u@test.com", full_name: "Test" };
  const db = createMockDb(user);

  const app = await createApp({
    db,
    config: {
      artifactInternalUrl: `http://127.0.0.1:${port}`,
      artifactInternalKey: "key-123",
      artifactAccessTokenTtlSeconds: 3600 * 24 * 365,
    },
  });

  const boundary = "----WebKitFormBoundaryAvatar";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="avatar.png"',
    "Content-Type: image/png",
    "",
    "image-data",
    `--${boundary}--`,
  ].join("\r\n");

  const res = await app.inject({
    method: "POST",
    url: "/api/users/me/avatar",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      authorization: "Bearer my-token",
    },
    payload: body,
  });

  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.avatar_url, "/api/artifacts/avatar-art-1/content?token=av-token");
  assert.equal(db.getAvatar(), "/api/artifacts/avatar-art-1/content?token=av-token");
});

test("Avatar API - Delete avatar clears profile", async () => {
  const user = { id: "user-1", tenant_id: "tenant-1", role: "member", email: "u@test.com", full_name: "Test" };
  const db = createMockDb(user);

  const app = await createApp({ db });

  const res = await app.inject({
    method: "DELETE",
    url: "/api/users/me/avatar",
    headers: {
      authorization: "Bearer my-token",
    },
  });

  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.avatar_url, null);
  assert.equal(db.getAvatar(), null);
});
