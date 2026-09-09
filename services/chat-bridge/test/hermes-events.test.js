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

test("parseHermesEventBlock normalizes approval.request", () => {
  const parsed = parseHermesEventBlock(
    'event: approval.request\ndata: {"run_id":"run_1","request_id":"approval_1","choices":["once","deny"],"command":"rm example"}',
    context,
  );

  assert.deepEqual(parsed.events, [{
    event: "approval",
    data: {
      run_id: "run_1",
      request_id: "approval_1",
      choices: ["once", "deny"],
      summary: "rm example",
    },
  }]);
  assert.equal(parsed.completed, false);
});

test("parseHermesEventBlock fails closed for incomplete approval requests", () => {
  const missingRequestId = parseHermesEventBlock(
    'event: approval.request\ndata: {"run_id":"run_1","choices":["once","deny"],"command":"unsafe command"}',
    context,
  );
  const unsupportedChoices = parseHermesEventBlock(
    'event: approval.request\ndata: {"run_id":"run_1","request_id":"approval_1","choices":["approve-everything"]}',
    context,
  );

  assert.deepEqual(missingRequestId.events, []);
  assert.deepEqual(unsupportedChoices.events, []);
});

test("parseHermesEventBlock records approval.resolved without reopening approval UI", () => {
  const parsed = parseHermesEventBlock(
    'event: approval.resolved\ndata: {"run_id":"run_1","request_id":"approval_1","choice":"once"}',
    context,
  );

  assert.deepEqual(parsed.events, [{
    event: "meta",
    data: {
      provider: "hermes",
      event: "approval.resolved",
      run_id: "run_1",
      session_id: "nexus:session-1",
      request_id: "approval_1",
      choice: "once",
    },
  }]);
});

test("parseHermesEventBlock keeps run.stopping non-terminal", () => {
  const parsed = parseHermesEventBlock(
    'event: run.stopping\ndata: {"run_id":"run_1"}',
    context,
  );

  assert.deepEqual(parsed.events, [
    {
      event: "meta",
      data: {
        provider: "hermes",
        event: "run.stopping",
        run_id: "run_1",
        session_id: "nexus:session-1",
      },
    },
    {
      event: "status",
      data: { text: "Hermes está interrompendo a execução do agente.", tone: "info" },
    },
  ]);
  assert.equal(parsed.completed, false);
  assert.equal(parsed.failed, false);
});

test("parseHermesEventBlock preserves run.cancelled as cancellation", () => {
  const parsed = parseHermesEventBlock(
    'event: run.cancelled\ndata: {"run_id":"run_1"}',
    context,
  );

  assert.deepEqual(parsed.events, [
    {
      event: "meta",
      data: {
        provider: "hermes",
        event: "run.cancelled",
        run_id: "run_1",
        session_id: "nexus:session-1",
      },
    },
    { event: "done", data: { request_id: "req_123" } },
  ]);
  assert.equal(parsed.completed, false);
  assert.equal(parsed.failed, false);
  assert.equal(parsed.cancelled, true);
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

test("parseHermesStatusPayload preserves cancelled as cancellation", () => {
  const cancelled = parseHermesStatusPayload({
    run_id: "run_1",
    status: "cancelled",
  }, context);

  assert.equal(cancelled.terminal, true);
  assert.equal(cancelled.parsed.cancelled, true);
  assert.equal(cancelled.parsed.failed, false);
  assert.equal(cancelled.parsed.events[0].data.event, "run.cancelled");
  assert.equal(cancelled.parsed.events.at(-1).event, "done");
});
