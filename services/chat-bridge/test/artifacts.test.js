import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  ARTIFACT_STORAGE_BUCKET,
  collectArtifactUrlReplacements,
  importHermesFileToArtifact,
  importHermesFilesToArtifacts,
  replaceArtifactUrls,
  toBridgeArtifactPath,
} from "../src/artifacts.js";

test("importHermesFileToArtifact uploads remote Hermes file and returns signed artifact metadata", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });

    if (String(url) === "https://signed.example/render.png") {
      return new Response("png-bytes", {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }

    if (String(url) === "http://artifact.test/v1/artifacts") {
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, "Bearer internal-key");
      assert.equal(init.headers["X-Nexus-Owner-Id"], "user-1");
      assert.equal(init.headers["X-Nexus-Session-Id"], "session-1");
      assert.equal(init.headers["X-Nexus-Filename"], "render.png");
      assert.equal(init.headers["X-Nexus-Content-Type"], "image/png");
      assert.equal(await new Response(init.body).text(), "png-bytes");
      return Response.json({
        id: "artifact-1",
        filename: "render.png",
        content_type: "image/png",
        size: 9,
      }, { status: 201 });
    }

    if (String(url) === "http://artifact.test/v1/artifacts/artifact-1/access-link") {
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, "Bearer internal-key");
      assert.deepEqual(JSON.parse(init.body), { owner_id: "user-1", expires_in_seconds: 900 });
      return Response.json({
        url: "https://arquivos.example/v1/artifacts/artifact-1/content?token=abc",
        expires_at: "2026-06-19T12:15:00.000Z",
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  };

  const imported = await importHermesFileToArtifact({
    file: {
      name: "render.png",
      url: "https://signed.example/render.png",
      kind: "image",
      mimeType: "image/png",
    },
    ownerId: "user-1",
    sessionId: "session-1",
    artifactBaseUrl: "http://artifact.test",
    artifactInternalKey: "internal-key",
    fetchImpl,
  });

  assert.equal(imported.url, "https://arquivos.example/v1/artifacts/artifact-1/content?token=abc");
  assert.equal(imported.artifact_id, "artifact-1");
  assert.equal(imported.storage_bucket, ARTIFACT_STORAGE_BUCKET);
  assert.equal(imported.storage_path, "artifact-1");
  assert.equal(imported.signed_url_expires_at, "2026-06-19T12:15:00.000Z");
  assert.equal(imported.mimeType, "image/png");
  assert.equal(calls.length, 3);
});

test("importHermesFileToArtifact uploads local files only from configured shared root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bridge-artifacts-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "bridge-outside-"));
  try {
    const localPath = path.join(root, "site.zip");
    await writeFile(localPath, "zip-bytes");
    await writeFile(path.join(outside, "secret.txt"), "secret");

    const fetchImpl = async (url, init = {}) => {
      if (String(url) === "http://artifact.test/v1/artifacts") {
        assert.equal(init.headers["X-Nexus-Filename"], "site.zip");
        assert.equal(await readFile(localPath, "utf8"), await new Response(init.body).text());
        return Response.json({
          id: "artifact-local",
          filename: "site.zip",
          content_type: "application/zip",
          size: 9,
        }, { status: 201 });
      }
      if (String(url) === "http://artifact.test/v1/artifacts/artifact-local/access-link") {
        return Response.json({
          url: "https://arquivos.example/v1/artifacts/artifact-local/content?token=abc",
          expires_at: "2026-06-19T12:15:00.000Z",
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const imported = await importHermesFileToArtifact({
      file: {
        name: "site.zip",
        url: localPath,
        kind: "file",
        mimeType: "application/zip",
      },
      ownerId: "user-1",
      sessionId: "session-1",
      artifactBaseUrl: "http://artifact.test",
      artifactInternalKey: "internal-key",
      allowedLocalRoots: [root],
      fetchImpl,
    });

    assert.equal(imported.artifact_id, "artifact-local");

    await assert.rejects(
      () => importHermesFileToArtifact({
        file: { name: "secret.txt", url: path.join(outside, "secret.txt"), kind: "file" },
        ownerId: "user-1",
        sessionId: "session-1",
        artifactBaseUrl: "http://artifact.test",
        artifactInternalKey: "internal-key",
        allowedLocalRoots: [root],
        fetchImpl,
      }),
      /artifact_local_path_not_allowed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("toBridgeArtifactPath maps Hermes shared artifact paths into Bridge mount", () => {
  assert.equal(
    toBridgeArtifactPath({
      hermesPath: "/opt/data/nexus-artifacts/run-1/app.zip",
      hermesRoot: "/opt/data/nexus-artifacts",
      bridgeRoot: "/app/data/hermes-artifacts",
    }),
    path.join("/app/data/hermes-artifacts", "run-1", "app.zip"),
  );

  assert.equal(toBridgeArtifactPath({
    hermesPath: "/tmp/outside.zip",
    hermesRoot: "/opt/data/nexus-artifacts",
    bridgeRoot: "/app/data/hermes-artifacts",
  }), null);
});

test("importHermesFilesToArtifacts restores original URL when mapped local import fails", async () => {
  const files = await importHermesFilesToArtifacts({
    files: [{
      name: "app.zip",
      url: path.join(os.tmpdir(), "missing-nexus-artifact.zip"),
      original_url: "/opt/data/nexus-artifacts/run-1/app.zip",
      kind: "file",
      mimeType: "application/zip",
    }],
    ownerId: "user-1",
    sessionId: "session-1",
    artifactBaseUrl: "http://artifact.test",
    artifactInternalKey: "internal-key",
    allowedLocalRoots: [os.tmpdir()],
    fetchImpl: async () => {
      throw new Error("fetch should not be reached");
    },
    logger: { warn() {} },
  });

  assert.equal(files[0].url, "/opt/data/nexus-artifacts/run-1/app.zip");
});

test("importHermesFilesToArtifacts restores original URL when local artifact is unreadable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bridge-unreadable-artifacts-"));
  try {
    const localPath = path.join(root, "render.png");
    await writeFile(localPath, "png-bytes");
    let uploadAttempted = false;

    const files = await importHermesFilesToArtifacts({
      files: [{
        name: "render.png",
        url: localPath,
        original_url: "/opt/data/nexus-artifacts/render.png",
        kind: "image",
        mimeType: "image/png",
      }],
      ownerId: "user-1",
      sessionId: "session-1",
      artifactBaseUrl: "http://artifact.test",
      artifactInternalKey: "internal-key",
      allowedLocalRoots: [root],
      accessImpl: async () => {
        const error = new Error(`EACCES: permission denied, open '${localPath}'`);
        error.code = "EACCES";
        throw error;
      },
      fetchImpl: async () => {
        uploadAttempted = true;
        throw new Error("fetch should not be reached");
      },
      logger: { warn() {} },
    });

    assert.equal(files[0].url, "/opt/data/nexus-artifacts/render.png");
    assert.equal(uploadAttempted, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replaceArtifactUrls swaps Hermes original URLs for artifact URLs in assistant text", () => {
  const supabaseUrl = "https://project.supabase.co/storage/v1/object/sign/image-gen-outputs/render.png?token=abc";
  const artifactUrl = "https://arquivos.solucoes-nexus.tech/v1/artifacts/artifact-1/content?token=xyz";
  const replacements = collectArtifactUrlReplacements(
    [{
      name: "render.png",
      url: "/app/data/hermes-artifacts/render.png",
      original_url: supabaseUrl,
    }],
    [{
      name: "render.png",
      url: artifactUrl,
      original_url: supabaseUrl,
      artifact_id: "artifact-1",
    }],
  );

  assert.equal(
    replaceArtifactUrls(`Imagem pronta:\n![preview](${supabaseUrl})`, replacements),
    `Imagem pronta:\n![preview](${artifactUrl})`,
  );
});
