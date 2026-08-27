import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareHermesAttachments } from "../src/attachments.js";

const textEncoder = new TextEncoder();

const createJsonResponse = (payload, init = {}) => new Response(JSON.stringify(payload), {
  status: init.status ?? 200,
  headers: { "Content-Type": "application/json" },
});

test("prepareHermesAttachments downloads private storage files and extracts text", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/storage/v1/object/sign/chat-attachments/user-1/session-1/brief.txt")) {
      return createJsonResponse({ signedURL: "/storage/v1/object/sign/chat-attachments/user-1/session-1/brief.txt?token=abc" });
    }
    if (String(url).includes("/storage/v1/object/chat-attachments/user-1/session-1/brief.txt")) {
      return new Response(textEncoder.encode("conteudo do brief"), {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return createJsonResponse({ error: "unexpected" }, { status: 500 });
  };

  const prepared = await prepareHermesAttachments({
    attachments: [{
      kind: "file",
      name: "brief.txt",
      mime_type: "text/plain",
      storage_path: "user-1/session-1/brief.txt",
    }],
    userId: "user-1",
    sessionId: "session-1",
    supabaseUrl: "https://project.supabase.co",
    supabaseServiceRoleKey: "service-role",
    fetchImpl,
  });

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].extracted_text, "conteudo do brief");
  assert.equal(
    prepared[0].signed_url,
    "https://project.supabase.co/storage/v1/object/sign/chat-attachments/user-1/session-1/brief.txt?token=abc",
  );
  assert.equal(calls.length, 2);
});

test("prepareHermesAttachments rejects storage paths outside the authenticated chat session", async () => {
  await assert.rejects(
    prepareHermesAttachments({
      attachments: [{
        kind: "image",
        name: "image.png",
        mime_type: "image/png",
        storage_path: "user-2/session-1/image.png",
      }],
      userId: "user-1",
      sessionId: "session-1",
      supabaseUrl: "https://project.supabase.co",
      supabaseServiceRoleKey: "service-role",
      fetchImpl: async () => new Response(),
    }),
    /forbidden_attachment/,
  );
});

test("prepareHermesAttachments materializes image inputs into a Hermes-readable shared path", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "bridge-hermes-images-"));
  try {
    const fetchImpl = async (url) => {
      if (String(url).includes("/storage/v1/object/sign/chat-attachments/user-1/session-1/ref.png")) {
        return createJsonResponse({ signedURL: "/storage/v1/object/sign/chat-attachments/user-1/session-1/ref.png?token=abc" });
      }
      if (String(url).includes("/storage/v1/object/chat-attachments/user-1/session-1/ref.png")) {
        return new Response(Uint8Array.from([137, 80, 78, 71]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      return createJsonResponse({ error: "unexpected" }, { status: 500 });
    };

    const prepared = await prepareHermesAttachments({
      attachments: [{
        kind: "image",
        name: "ref.png",
        mime_type: "image/png",
        storage_path: "user-1/session-1/ref.png",
      }],
      userId: "user-1",
      sessionId: "session-1",
      supabaseUrl: "https://project.supabase.co",
      supabaseServiceRoleKey: "service-role",
      sharedImageBridgeDir: tmpDir,
      sharedImageHermesDir: "/opt/data/nexus-image-inputs",
      fetchImpl,
    });

    assert.equal(prepared.length, 1);
    assert.match(prepared[0].hermes_image_path, /^\/opt\/data\/nexus-image-inputs\/session-1\//);
    assert.match(prepared[0].hermes_image_path, /ref\.png$/);
    assert.deepEqual(
      Array.from(await readFile(path.join(tmpDir, "session-1", path.basename(prepared[0].hermes_image_path)))),
      [137, 80, 78, 71],
    );
  } finally {
    await rm(tmpDir, { force: true, recursive: true });
  }
});
