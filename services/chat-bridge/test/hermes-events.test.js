import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHermesRunSessionId,
  parseHermesEventBlock,
  parseHermesStatusPayload,
} from "../src/hermes-events.js";

const context = {
  requestId: "req_123",
  runId: "run_123",
  sessionId: "nexus:session-1",
  streamedText: "",
  tenantId: "ens",
  userId: "user-1",
};

test("buildHermesRunSessionId creates stable short ids", () => {
  const raw = "a4447dba-b3be-4123-9e27-48d21384b3e9";
  const first = buildHermesRunSessionId(raw);
  const second = buildHermesRunSessionId(raw);

  assert.equal(first, second);
  assert.equal(first.startsWith("nexus:"), true);
  assert.equal(first.length <= 64, true);
});

test("parseHermesEventBlock emits delta for assistant delta events", () => {
  const parsed = parseHermesEventBlock(
    'data: {"event":"assistant.delta","run_id":"run_123","delta":"Oi"}',
    context,
  );

  assert.deepEqual(parsed.events, [{ event: "delta", data: { delta: "Oi" } }]);
  assert.equal(parsed.streamedText, "Oi");
  assert.equal(parsed.completed, false);
});

test("parseHermesEventBlock emits delta for Responses API text delta events", () => {
  const parsed = parseHermesEventBlock(
    'event: response.output_text.delta\ndata: {"delta":"Oi pelo responses"}',
    context,
  );

  assert.deepEqual(parsed.events, [{ event: "delta", data: { delta: "Oi pelo responses" } }]);
  assert.equal(parsed.streamedText, "Oi pelo responses");
  assert.equal(parsed.completed, false);
});

test("parseHermesEventBlock completes Responses API events and exposes response id", () => {
  const parsed = parseHermesEventBlock(
    'event: response.completed\ndata: {"id":"resp_123","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Pronto"}]}]}',
    context,
  );

  assert.equal(parsed.responseId, "resp_123");
  assert.equal(parsed.completed, true);
  assert.equal(parsed.events.at(-1).event, "done");
  assert.equal(parsed.events[0].data.delta, "Pronto");
});

test("parseHermesEventBlock emits missing final text, files and done on run.completed", () => {
  const parsed = parseHermesEventBlock(
    'data: {"event":"run.completed","run_id":"run_123","session_id":"session-1","output":"Imagem pronta.","files":[{"url":"https://cdn.example/image.png","name":"image.png","mimeType":"image/png"}]}',
    context,
  );

  assert.deepEqual(parsed.events, [
    { event: "delta", data: { delta: "Imagem pronta." } },
    {
      event: "files",
      data: {
        files: [{
          name: "image.png",
          url: "https://cdn.example/image.png",
          kind: "image",
          mimeType: "image/png",
        }],
      },
    },
    {
      event: "meta",
      data: {
        provider: "hermes",
        event: "run.completed",
        run_id: "run_123",
        session_id: "session-1",
      },
    },
    { event: "done", data: { request_id: "req_123" } },
  ]);
  assert.equal(parsed.completed, true);
});

test("parseHermesEventBlock exposes Supabase-generated image metadata", () => {
  const parsed = parseHermesEventBlock(
    'data: {"event":"run.completed","run_id":"run_123","session_id":"session-1","output":"Imagem pronta.","result":{"type":"image","image_url":"https://project.supabase.co/storage/v1/object/sign/image-gen-outputs/hermes-chat-images/nexus-chat-1/openai.png?token=abc","name":"openai.png","mime_type":"image/png","storage_path":"hermes-chat-images/nexus-chat-1/openai.png","storage_bucket":"image-gen-outputs","signed_url_expires_at":"2026-06-18T12:00:00Z"}}',
    context,
  );

  const filesEvent = parsed.events.find((event) => event.event === "files");
  assert.deepEqual(filesEvent?.data.files, [{
    name: "openai.png",
    url: "https://project.supabase.co/storage/v1/object/sign/image-gen-outputs/hermes-chat-images/nexus-chat-1/openai.png?token=abc",
    kind: "image",
    mimeType: "image/png",
    storage_path: "hermes-chat-images/nexus-chat-1/openai.png",
    storage_bucket: "image-gen-outputs",
    signed_url_expires_at: "2026-06-18T12:00:00Z",
  }]);
  assert.equal(parsed.completed, true);
});

test("parseHermesEventBlock extracts generated image files from tool completed JSON strings", () => {
  const toolResult = JSON.stringify({
    success: true,
    image: "https://project.supabase.co/storage/v1/object/sign/image-gen-outputs/hermes-chat-images/nexus-chat-1/openai-tool.png?token=abc",
    image_url: "https://project.supabase.co/storage/v1/object/sign/image-gen-outputs/hermes-chat-images/nexus-chat-1/openai-tool.png?token=abc",
    download_url: "https://project.supabase.co/storage/v1/object/sign/image-gen-outputs/hermes-chat-images/nexus-chat-1/openai-tool.png?token=abc",
    filename: "openai-tool.png",
    mime_type: "image/png",
    storage_path: "hermes-chat-images/nexus-chat-1/openai-tool.png",
    storage_bucket: "image-gen-outputs",
    signed_url_expires_at: "2026-06-18T12:00:00Z",
  });
  const parsed = parseHermesEventBlock(
    `data: ${JSON.stringify({
      event: "tool.completed",
      tool_name: "image_generate",
      result: toolResult,
    })}`,
    context,
  );

  const filesEvent = parsed.events.find((event) => event.event === "files");
  assert.deepEqual(filesEvent?.data.files, [{
    name: "openai-tool.png",
    url: "https://project.supabase.co/storage/v1/object/sign/image-gen-outputs/hermes-chat-images/nexus-chat-1/openai-tool.png?token=abc",
    kind: "image",
    mimeType: "image/png",
    storage_path: "hermes-chat-images/nexus-chat-1/openai-tool.png",
    storage_bucket: "image-gen-outputs",
    signed_url_expires_at: "2026-06-18T12:00:00Z",
  }]);
  assert.equal(parsed.completed, false);
});

test("parseHermesEventBlock extracts local artifact paths from tool completed JSON strings", () => {
  const toolResult = JSON.stringify({
    success: true,
    host_image: "/opt/data/nexus-artifacts/run-1/banner.png",
    filename: "banner.png",
    mime_type: "image/png",
  });
  const parsed = parseHermesEventBlock(
    `data: ${JSON.stringify({
      event: "tool.completed",
      tool_name: "image_generate",
      result: toolResult,
    })}`,
    context,
  );

  const filesEvent = parsed.events.find((event) => event.event === "files");
  assert.deepEqual(filesEvent?.data.files, [{
    name: "banner.png",
    url: "/opt/data/nexus-artifacts/run-1/banner.png",
    kind: "image",
    mimeType: "image/png",
  }]);
  assert.equal(parsed.completed, false);
});

test("parseHermesEventBlock emits memory diagnostics for RAG and Graph tools", () => {
  const rag = parseHermesEventBlock(
    'data: {"event":"tool.started","tool_name":"ens_rag_search"}',
    context,
  );
  const graph = parseHermesEventBlock(
    'data: {"event":"tool.failed","tool_name":"nexus_graph_search","error":{"message":"Neo4j search failed"}}',
    context,
  );

  assert.deepEqual(rag.events.find((event) => event.data?.event === "memory.tool")?.data, {
    provider: "hermes",
    event: "memory.tool",
    tool_name: "ens_rag_search",
    tool_namespace: "ens_rag",
    memory_layer: "rag",
    tenant_id: "ens",
    user_id: "user-1",
    run_id: "run_123",
    session_id: "nexus:session-1",
    failure: false,
  });
  assert.equal(graph.events.find((event) => event.data?.event === "memory.tool")?.data.memory_layer, "graph");
  assert.equal(graph.events.find((event) => event.data?.event === "memory.tool")?.data.failure, true);
  assert.match(graph.events.find((event) => event.data?.event === "memory.tool")?.data.error_excerpt, /Neo4j/);
});

test("parseHermesEventBlock preserves original download URL for staged image artifacts", () => {
  const toolResult = JSON.stringify({
    success: true,
    download_url: "/opt/data/nexus-artifacts/run-1/render.png",
    original_download_url: "https://project.supabase.co/storage/v1/object/sign/image-gen-outputs/render.png?token=abc",
    filename: "render.png",
    mime_type: "image/png",
  });
  const parsed = parseHermesEventBlock(
    `data: ${JSON.stringify({
      event: "tool.completed",
      tool_name: "image_generate",
      result: toolResult,
    })}`,
    context,
  );

  const filesEvent = parsed.events.find((event) => event.event === "files");
  assert.deepEqual(filesEvent?.data.files, [{
    name: "render.png",
    url: "/opt/data/nexus-artifacts/run-1/render.png",
    original_url: "https://project.supabase.co/storage/v1/object/sign/image-gen-outputs/render.png?token=abc",
    kind: "image",
    mimeType: "image/png",
  }]);
});

test("parseHermesStatusPayload keeps running runs open and completes terminal runs", () => {
  assert.deepEqual(parseHermesStatusPayload({ status: "running" }, context), {
    terminal: false,
    parsed: null,
  });

  const completed = parseHermesStatusPayload({
    status: "completed",
    output: "Terminei pelo status.",
  }, context);

  assert.equal(completed.terminal, true);
  assert.equal(completed.parsed.completed, true);
  assert.equal(completed.parsed.events[0].data.delta, "Terminei pelo status.");
});
