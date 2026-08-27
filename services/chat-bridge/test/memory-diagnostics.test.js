import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMemoryDiagnosticEvent,
  createInitialMemoryDiagnostics,
} from "../src/memory-diagnostics.js";

test("memory diagnostics starts with Hermes native memory active", () => {
  const diagnostics = createInitialMemoryDiagnostics({
    tenantId: "ens",
    userId: "user-1",
    routingContractEnabled: true,
  });

  assert.deepEqual(diagnostics.layers_used, ["hermes_memory"]);
  assert.equal(diagnostics.tenant_id, "ens");
  assert.equal(diagnostics.routing_contract_enabled, true);
});

test("memory diagnostics records RAG and Graph tool usage without losing Hermes memory", () => {
  const diagnostics = createInitialMemoryDiagnostics({
    tenantId: "ens",
    userId: "user-1",
    routingContractEnabled: true,
  });

  applyMemoryDiagnosticEvent(diagnostics, {
    event: "meta",
    data: {
      event: "memory.tool",
      tool_name: "ens_rag_search",
      tool_namespace: "ens_rag",
      memory_layer: "rag",
    },
  });
  applyMemoryDiagnosticEvent(diagnostics, {
    event: "meta",
    data: {
      event: "memory.tool",
      tool_name: "nexus_graph_search",
      tool_namespace: "nexus_graph",
      memory_layer: "graph",
      failure: true,
      error_excerpt: "Neo4j search failed",
    },
  });

  assert.deepEqual(diagnostics.layers_used, ["hermes_memory", "rag", "graph"]);
  assert.deepEqual(diagnostics.tool_names, ["ens_rag_search", "nexus_graph_search"]);
  assert.equal(diagnostics.rag.status, "used");
  assert.equal(diagnostics.graph.status, "degraded");
  assert.equal(diagnostics.graph.search_failures.length, 1);
});
