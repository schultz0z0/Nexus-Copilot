import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

const extractBlock = (text, marker, nextMarker) => {
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `${marker} not found`);
  const end = nextMarker ? text.indexOf(nextMarker, start + marker.length) : text.length;
  assert.notEqual(end, -1, `${nextMarker} not found after ${marker}`);
  return text.slice(start, end);
};

test("executeRun does not use chat-delete scoped session variables", () => {
  const executeRunBlock = extractBlock(source, "async executeRun(runId)", "const store = new RunStore");

  assert.equal(executeRunBlock.includes("buildHermesRunSessionId(sessionId)"), false);
  assert.equal(executeRunBlock.includes("state?.hermes_session_id"), false);
  assert.equal(executeRunBlock.includes("user.id"), false);
});

test("chat delete route collects Hermes session ids before storage cleanup", () => {
  const deleteRouteBlock = extractBlock(
    source,
    'url.pathname === "/api/chat/session/delete"',
    'url.pathname === "/api/chat/runs"',
  );

  assert.match(deleteRouteBlock, /const hermesSessionIds = new Set/);
  assert.match(deleteRouteBlock, /buildHermesRunSessionId\(sessionId\)/);
  assert.match(deleteRouteBlock, /deleteChatSessionData\(\{/);
  assert.match(deleteRouteBlock, /hermesSessionIds: Array\.from\(hermesSessionIds\)/);
});

test("approval stream bridges the Hermes approval websocket instead of dashboard event SSE", () => {
  const approvalRouteBlock = extractBlock(
    source,
    'url.pathname === "/api/approvals/stream"',
    'jsonResponse(res, 404',
  );

  assert.match(approvalRouteBlock, /\/api\/approvals\/ws/);
  assert.doesNotMatch(approvalRouteBlock, /\/api\/events\?channel=approvals/);
  assert.doesNotMatch(approvalRouteBlock, /Accept: "text\/event-stream"/);
});

test("Hermes headers forward tenant and user context for memory MCP routing", () => {
  const headersBlock = extractBlock(
    source,
    "buildHermesHeaders(accept, run)",
    "async fetchHermesEvents",
  );

  assert.match(headersBlock, /"X-Tenant-Id": run\.tenant_id/);
  assert.match(headersBlock, /"X-User-Id": run\.user_id/);
  assert.match(headersBlock, /"X-Nexus-User-Id": run\.user_id/);
  assert.match(headersBlock, /"X-Nexus-User-Role": run\.user_role/);
});

test("created chat runs preserve trusted tenant context for downstream memory tools", () => {
  const createRunBlock = extractBlock(
    source,
    "async createRun({ user, payload })",
    "async ensureHermesSessionBinding",
  );

  assert.match(createRunBlock, /tenant_id: user\.tenant_id/);
  assert.match(createRunBlock, /user_id: user\.id/);
  assert.match(createRunBlock, /user_role: user\.role/);
  assert.match(createRunBlock, /user_name: user\.name/);
});

test("Hermes request builders receive Nexus role context", () => {
  assert.match(source, /const buildRunNexusContext = \(run\) =>/);
  assert.match(source, /nexusContext: buildRunNexusContext\(run\)/);
  assert.match(source, /userRole: run\.user_role/);
});

test("Bridge gets the contextual decision before signing a Marketing Ops delegation", () => {
  const executeRunBlock = extractBlock(source, "async executeRun(runId)", "const store = new RunStore");
  const delegationBlock = extractBlock(source, "const issueRunMarketingOpsDelegation", "const issueRunPictureDelegation");

  assert.match(executeRunBlock, /resolveRunMarketingOpsDecision\(run, hermesBaseUrl\)/);
  assert.match(delegationBlock, /confirmationIntentForMarketingOpsDecision\(run\.marketing_ops_decision\)/);
  assert.match(source, /\/v1\/internal\/marketing-ops-decision/);
  assert.doesNotMatch(source, /isExplicitMarketingOpsConfirmation/);
});

test("Marketing Ops delegation can submit approval requests but never decide them", () => {
  const delegationBlock = extractBlock(source, "const issueRunMarketingOpsDelegation", "const issueRunPictureDelegation");

  assert.match(delegationBlock, /"approval:submit"/);
  assert.doesNotMatch(delegationBlock, /approval:(decide|approve|reject)/);
});

test("bridge exposes authenticated memory diagnostics with graph health", () => {
  const diagnosticsRouteBlock = extractBlock(
    source,
    'url.pathname === "/api/memory/diagnostics"',
    'const artifactAccessMatch',
  );

  assert.match(diagnosticsRouteBlock, /const user = await verifyUser\(req\)/);
  assert.match(diagnosticsRouteBlock, /const graphHealth = await fetchGraphHealth\(\)/);
  assert.match(diagnosticsRouteBlock, /memory_diagnostics: run\.memory_diagnostics/);
});

test("bridge exposes an authenticated delegation refresh only for active stored runs", () => {
  const refreshRouteBlock = extractBlock(
    source,
    'url.pathname === "/internal/marketing-ops/delegations/refresh"',
    'url.pathname === "/api/memory/diagnostics"',
  );

  assert.match(refreshRouteBlock, /isValidDelegationRefreshKey/);
  assert.match(refreshRouteBlock, /req\.headers\["x-internal-key"\]/);
  assert.match(refreshRouteBlock, /store\.get\(claims\.run_id\)/);
  assert.match(refreshRouteBlock, /refreshMarketingOpsDelegation/);
  assert.match(refreshRouteBlock, /delegation_token: refreshed/);
});

test("run events update memory diagnostics from Hermes tool metadata", () => {
  const appendEventBlock = extractBlock(
    source,
    "appendEvent(run, event)",
    "async importFilesEventArtifacts",
  );

  assert.match(appendEventBlock, /applyMemoryDiagnosticEvent\(run\.memory_diagnostics, normalizedEvent\)/);
});

test("bridge exposes authenticated Picture BFF routes", () => {
  const pictureBlock = extractBlock(
    source,
    'url.pathname === "/api/picture/workspace/current"',
    'url.pathname === "/api/chat/session/delete"',
  );
  assert.match(pictureBlock, /const user = await verifyUser\(req\)/);
  assert.match(pictureBlock, /pictureModeService\.current\(user\)/);
  assert.match(pictureBlock, /pictureModeService\.approve/);
  assert.match(pictureBlock, /pictureModeService\.newPiece/);
});

test("Picture chat validates session and imports references before queueing Hermes", () => {
  const createRunBlock = extractBlock(source, "async createRun({ user, payload })", "applyArtifactUrlReplacements");
  assert.match(createRunBlock, /validateChatExperience/);
  assert.match(createRunBlock, /assertPictureSession/);
  assert.match(createRunBlock, /importPreparedReferences/);
  assert.match(createRunBlock, /picture_workspace_summary/);
});

test("validated visual artifact links resolve the original owner inside the trusted tenant", () => {
  const artifactRouteBlock = extractBlock(source, "const artifactAccessMatch", 'url.pathname === "/api/picture/workspace/current"');
  assert.match(artifactRouteBlock, /resolveArtifactAccessOwner/);
  assert.match(source, /tenant_id: `eq\.\$\{user\.tenant_id\}`/);
  assert.match(source, /artifact_type: "eq\.peca_visual"/);
});
