const MEMORY_LAYER_ORDER = ["hermes_memory", "rag", "graph", "external_tool"];

const addUnique = (items, value) => {
  if (!value || items.includes(value)) return;
  items.push(value);
};

const sortLayers = (layers) => layers.sort((a, b) => {
  const ai = MEMORY_LAYER_ORDER.indexOf(a);
  const bi = MEMORY_LAYER_ORDER.indexOf(b);
  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
});

export const createInitialMemoryDiagnostics = ({
  tenantId,
  userId,
  routingContractEnabled,
} = {}) => ({
  tenant_id: tenantId ?? "ens",
  user_id: userId ?? "anonymous",
  routing_contract_enabled: Boolean(routingContractEnabled),
  layers_used: ["hermes_memory"],
  tool_names: [],
  tool_namespaces: [],
  hermes_memory: {
    status: "active",
    role: "native_persistent_continuity",
  },
  rag: {
    status: "not_observed",
  },
  graph: {
    status: "not_observed",
    search_failures: [],
  },
  updated_at: new Date().toISOString(),
});

export const applyMemoryDiagnosticEvent = (diagnostics, event) => {
  if (!diagnostics || event?.event !== "meta" || event.data?.event !== "memory.tool") {
    return diagnostics;
  }

  const layer = event.data.memory_layer || "external_tool";
  const namespace = event.data.tool_namespace || "unknown";
  const toolName = event.data.tool_name || "unknown";

  addUnique(diagnostics.layers_used, layer);
  diagnostics.layers_used = sortLayers(diagnostics.layers_used);
  addUnique(diagnostics.tool_names, toolName);
  addUnique(diagnostics.tool_namespaces, namespace);

  if (layer === "rag") {
    diagnostics.rag.status = event.data.failure ? "degraded" : "used";
  }

  if (layer === "graph") {
    diagnostics.graph.status = event.data.failure ? "degraded" : "used";
    if (event.data.failure && toolName === "nexus_graph_search") {
      diagnostics.graph.search_failures.push({
        tool_name: toolName,
        error_excerpt: event.data.error_excerpt ?? "Graph search failed",
        observed_at: new Date().toISOString(),
      });
    }
  }

  diagnostics.updated_at = new Date().toISOString();
  return diagnostics;
};
