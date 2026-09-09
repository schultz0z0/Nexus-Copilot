import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { decodeJwt } from "jose";

import { HermesRunsClient } from "./hermes-runs-client.js";
import {
  HermesApprovalRegistry,
  toApprovalStreamPayload,
  toOfficialApprovalChoice,
} from "./hermes-approvals.js";
import { assertStoppableHermesRun } from "./hermes-run-control.js";

import {
  buildHermesRunSessionId,
  parseHermesEventBlock,
  parseHermesStatusPayload,
} from "./hermes-events.js";
import {
  applyMemoryDiagnosticEvent,
  createInitialMemoryDiagnostics,
} from "./memory-diagnostics.js";
import {
  resolveTrustedTenantId,
} from "./tenant-context.js";
import { validateBridgeRuntimeConfig } from "./runtime-config.js";
import { PictureClient } from "./picture-client.js";
import { issuePictureDelegation, redactPictureDelegation, refreshPictureDelegation } from "./picture-delegation.js";
import {
  buildPictureWorkspaceSummary,
  createPictureModeService,
  createSupabasePictureSessionRepository,
  validateChatExperience,
} from "./picture-mode.js";
import {
  confirmationIntentForMarketingOpsDecision,
  isValidDelegationRefreshKey,
  issueMarketingOpsDelegation,
  redactMarketingOpsDelegation,
  refreshMarketingOpsDelegation,
} from "./marketing-ops-delegation.js";
import { prepareHermesAttachments, CHAT_ATTACHMENT_BUCKET } from "./attachments.js";
import {
  collectArtifactUrlReplacements,
  createArtifactAccessLink,
  importHermesFilesToArtifacts,
  replaceArtifactUrls,
  toBridgeArtifactPath,
} from "./artifacts.js";
import {
  buildHermesRunRequest,
  buildHermesResponsesRequest,
  buildHermesSessionChatRequest,
  buildHermesSessionKey,
  isNexusMemoryRoutingContractEnabled,
  isImageAttachment,
  selectHermesBridgeMode,
} from "./hermes-payloads.js";
import {
  bindHermesSessionFromResponse,
  bindHermesSessionToState,
  buildHermesResponseRoutingState,
  createMemoryHermesStateRepository,
  createSupabaseHermesStateRepository,
  ensureHermesConversationState,
  markHermesChainDegraded,
  markHermesResponseCompleted,
  markHermesResponseRecovered,
} from "./hermes-state.js";
import {
  createHermesSession,
  deleteHermesSession,
  isHermesSessionApiUnavailableError,
} from "./hermes-sessions.js";

const runtimeConfig = validateBridgeRuntimeConfig(process.env);
const config = {
  port: Number(process.env.BRIDGE_PORT || 8080),
  dataDir: process.env.BRIDGE_DATA_DIR || "/app/data",
  allowedOrigins: (process.env.BRIDGE_ALLOWED_ORIGINS || "https://chat.solucoes-nexus.tech")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  supabaseUrl: runtimeConfig.supabaseUrl,
  supabaseAnonKey: runtimeConfig.supabaseAnonKey,
  supabaseServiceRoleKey: runtimeConfig.supabaseServiceRoleKey,
  allowInsecureLocalAuth: runtimeConfig.allowInsecureLocalAuth,
  marketingOpsDecisionTimeoutMs: runtimeConfig.marketingOpsDecisionTimeoutMs,
  attachmentBucket: process.env.CHAT_ATTACHMENTS_BUCKET || process.env.VITE_CHAT_ATTACHMENTS_BUCKET || CHAT_ATTACHMENT_BUCKET,
  supabaseOutputsBucket: process.env.SUPABASE_OUTPUTS_BUCKET || "image-gen-outputs",
  supabaseGeneratedImagesPrefix: process.env.SUPABASE_GENERATED_IMAGES_PREFIX || "hermes-chat-images",
  hermesImageInputsBridgeDir: process.env.HERMES_IMAGE_INPUTS_BRIDGE_DIR || path.join(process.env.BRIDGE_DATA_DIR || "/app/data", "hermes-image-inputs"),
  hermesImageInputsHermesDir: process.env.HERMES_IMAGE_INPUTS_HERMES_DIR || "/opt/data/nexus-image-inputs",
  hermesArtifactsBridgeDir: process.env.HERMES_ARTIFACTS_BRIDGE_DIR || path.join(process.env.BRIDGE_DATA_DIR || "/app/data", "hermes-artifacts"),
  hermesArtifactsHermesDir: process.env.HERMES_ARTIFACTS_HERMES_DIR || "/opt/data/nexus-artifacts",
  artifactInternalUrl: process.env.ARTIFACT_INTERNAL_URL || "",
  artifactInternalKey: process.env.ARTIFACT_INTERNAL_KEY || "",
  artifactAccessTokenTtlSeconds: Number(process.env.ARTIFACT_ACCESS_TOKEN_TTL_SECONDS || 900),
  hermesBaseUrl: process.env.HERMES_API_BASE_URL || "",
  hermesApiKey: process.env.HERMES_API_KEY || "",
  hermesModelName: process.env.HERMES_MODEL_NAME || "hermes-agent",
  hermesPollMs: Number(process.env.HERMES_RUN_POLL_MS || 2000),
  hermesTextTransport: process.env.HERMES_TEXT_TRANSPORT || "runs",
  hermesSessionsApiEnabled: process.env.HERMES_SESSIONS_API_ENABLED !== "false",
  defaultTenantId: process.env.NEXUS_TENANT_ID || "ens",
  graphMcpUrl: process.env.NEXUS_GRAPH_MCP_URL || "http://graph-mcp:8010/mcp",
  internalSyncKey: process.env.NEXUS_INTERNAL_SYNC_KEY || "",
  marketingOpsDelegation: {
    activeKid: process.env.MARKETING_OPS_DELEGATION_ACTIVE_KID || "",
    activeKey: process.env.MARKETING_OPS_DELEGATION_ACTIVE_KEY || "",
    previousKid: process.env.MARKETING_OPS_DELEGATION_PREVIOUS_KID || "",
    previousKey: process.env.MARKETING_OPS_DELEGATION_PREVIOUS_KEY || "",
    issuer: process.env.MARKETING_OPS_DELEGATION_ISSUER || "nexus-chat-bridge",
    audience: process.env.MARKETING_OPS_DELEGATION_AUDIENCE || "nexus-marketing-ops",
    ttlSeconds: Number(process.env.MARKETING_OPS_DELEGATION_TTL_SECONDS || 90),
    maxTtlSeconds: Number(process.env.MARKETING_OPS_DELEGATION_MAX_TTL_SECONDS || 120),
    refreshWindowSeconds: Number(process.env.MARKETING_OPS_DELEGATION_REFRESH_WINDOW_SECONDS || 900),
  },
  marketingOpsDelegationRefreshKey: process.env.MARKETING_OPS_DELEGATION_REFRESH_KEY || "",
  pictureInternalUrl: runtimeConfig.pictureInternalUrl,
  pictureInternalKey: runtimeConfig.pictureInternalKey,
  pictureDelegation: {
    activeKid: runtimeConfig.pictureDelegationActiveKid,
    activeKey: runtimeConfig.pictureDelegationActiveKey,
    issuer: runtimeConfig.pictureDelegationIssuer,
    audience: runtimeConfig.pictureDelegationAudience,
    ttlSeconds: Number(process.env.PICTURE_DELEGATION_TTL_SECONDS || 90),
    maxTtlSeconds: Number(process.env.PICTURE_DELEGATION_MAX_TTL_SECONDS || 120),
    refreshWindowSeconds: Number(process.env.PICTURE_DELEGATION_REFRESH_WINDOW_SECONDS || 900),
  },
  pictureDelegationRefreshKey: runtimeConfig.pictureDelegationRefreshKey,
};

const terminalStatuses = new Set(["completed", "failed", "cancelled", "canceled", "expired", "interrupted"]);

const nowIso = () => new Date().toISOString();

const jsonResponse = (res, status, payload, headers = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(payload));
};

const emitSse = (event, data) => (
  `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`
);

const normalizeBaseUrl = (value) => {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getCorsHeaders = (req) => {
  const origin = req.headers.origin;
  const allowAny = config.allowedOrigins.includes("*");
  const allowedOrigin = origin && (allowAny || config.allowedOrigins.includes(origin)) ? origin : "";

  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin, "Vary": "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Tenant-Id,X-User-Id",
    "Access-Control-Max-Age": "86400",
  };
};

const readJsonBody = async (req, maxBytes = 1_000_000) => {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBytes) {
      const error = new Error("payload_too_large");
      error.status = 413;
      throw error;
    }
  }

  try {
    return body ? JSON.parse(body) : {};
  } catch {
    const error = new Error("invalid_json");
    error.status = 400;
    throw error;
  }
};

const getBearerToken = (req) => {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
};

const firstHeaderValue = (value) => Array.isArray(value) ? value[0] : value;

const normalizeTenantId = (value, fallback = config.defaultTenantId) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (/^[a-z0-9_-]{3,64}$/.test(normalized)) return normalized;
  return /^[a-z0-9_-]{3,64}$/.test(fallback) ? fallback : "ens";
};

const normalizeProfileRole = (role) => {
  const normalized = String(role ?? "").trim().toLowerCase();
  if (normalized === "admin" || normalized === "broker") return "admin";
  if (normalized === "manager") return "manager";
  return "member";
};

const getProfileDisplayName = (profile) => (
  String(profile?.full_name ?? "").trim() ||
  String(profile?.email ?? "").trim() ||
  "Usuario ENS"
);

const fetchBridgeUserProfile = async (userId) => {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return null;
  const params = new URLSearchParams({
    id: `eq.${userId}`,
    select: "id,full_name,email,role,tenant_id",
    limit: "1",
  });
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/profiles?${params.toString()}`, {
    headers: buildSupabaseAdminHeaders(),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows)) {
    throw new Error(`profiles.fetch_failed:${response.status}`);
  }
  return rows[0] ?? null;
};

const verifyUser = async (req) => {
  const token = getBearerToken(req);
  const requestedTenantId = firstHeaderValue(req.headers["x-tenant-id"]);
  if (!token) {
    const error = new Error("missing_bearer_token");
    error.status = 401;
    throw error;
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    if (!config.allowInsecureLocalAuth) {
      const error = new Error("supabase_auth_not_configured");
      error.status = 503;
      throw error;
    }
    return {
      id: "authenticated",
      token,
      tenant_id: resolveTrustedTenantId({
        requestedTenantId,
        fallbackTenantId: config.defaultTenantId,
        trustClientHeader: true,
      }),
      role: "member",
      profile_role: "member",
      name: "Usuario ENS",
      email: null,
    };
  }

  const response = await fetch(new URL("/auth/v1/user", config.supabaseUrl), {
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = new Error("invalid_supabase_session");
    error.status = 401;
    throw error;
  }

  const user = await response.json();
  if (!user?.id) {
    const error = new Error("invalid_supabase_user");
    error.status = 401;
    throw error;
  }

  let profile;
  try {
    profile = await fetchBridgeUserProfile(user.id);
  } catch (error) {
    if (!config.allowInsecureLocalAuth) throw error;
    profile = null;
  }
  if (!profile && !config.allowInsecureLocalAuth) {
    const error = new Error("active_profile_required");
    error.status = 403;
    throw error;
  }
  const tenantId = normalizeTenantId(profile?.tenant_id, config.defaultTenantId);
  const role = normalizeProfileRole(profile?.role);

  return {
    id: user.id,
    token,
    tenant_id: tenantId,
    role,
    profile_role: profile?.role ?? role,
    name: getProfileDisplayName(profile),
    email: profile?.email ?? user.email ?? null,
  };
};

const buildGraphHealthUrl = () => {
  const url = new URL(config.graphMcpUrl || "http://graph-mcp:8010/mcp");
  url.pathname = "/health";
  url.search = "";
  return url;
};

const fetchGraphHealth = async () => {
  try {
    const response = await fetch(buildGraphHealthUrl(), {
      headers: config.internalSyncKey ? { "X-Nexus-Internal-Key": config.internalSyncKey } : {},
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      ...payload,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const buildSupabaseAdminHeaders = () => {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("missing_SUPABASE_SERVICE_ROLE_KEY");
  }

  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
  };
};

const deleteSupabaseRows = async (table, filters) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    params.set(key, `eq.${value}`);
  });

  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}?${params.toString()}`, {
    method: "DELETE",
    headers: buildSupabaseAdminHeaders(),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`${table}.delete_failed:${payload?.message ?? response.status}`);
  }
};
const sanitizeStoragePathSegment = (value, fallback = "session") => {
  const sanitized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._=-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);

  return sanitized || fallback;
};

const buildGeneratedImagesPrefix = (hermesSessionId) => {
  const root = String(config.supabaseGeneratedImagesPrefix || "hermes-chat-images")
    .replace(/^\/+|\/+$/g, "");
  return `${root}/${sanitizeStoragePathSegment(hermesSessionId)}`;
};

const listSupabaseStorageObjects = async ({ bucket, prefix }) => {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return [];

  const supabaseUrl = config.supabaseUrl.replace(/\/$/, "");
  const limit = 1000;
  let offset = 0;
  const paths = [];

  for (;;) {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: buildSupabaseAdminHeaders(),
      body: JSON.stringify({
        prefix,
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });

    const rows = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(rows)) {
      throw new Error(`storage.list_failed:${response.status}`);
    }

    rows.forEach((row) => {
      const name = typeof row?.name === "string" ? row.name.trim() : "";
      if (!name) return;
      paths.push(name.startsWith(`${prefix}/`) ? name : `${prefix}/${name}`);
    });

    if (rows.length < limit) break;
    offset += rows.length;
  }

  return paths;
};

const deleteSupabaseStorageObjects = async ({ bucket, paths }) => {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey || paths.length === 0) return;

  const supabaseUrl = config.supabaseUrl.replace(/\/$/, "");
  const batchSize = 100;
  for (let index = 0; index < paths.length; index += batchSize) {
    const prefixes = paths.slice(index, index + batchSize);
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`, {
      method: "DELETE",
      headers: buildSupabaseAdminHeaders(),
      body: JSON.stringify({ prefixes }),
    });

    if (!response.ok) {
      throw new Error(`storage.delete_failed:${response.status}`);
    }
  }
};

const deleteGeneratedImagesForHermesSessions = async (hermesSessionIds) => {
  const uniqueSessionIds = Array.from(new Set(
    hermesSessionIds
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  ));
  if (uniqueSessionIds.length === 0) return;

  const allPaths = [];
  for (const hermesSessionId of uniqueSessionIds) {
    const prefix = buildGeneratedImagesPrefix(hermesSessionId);
    const paths = await listSupabaseStorageObjects({
      bucket: config.supabaseOutputsBucket,
      prefix,
    });
    allPaths.push(...paths);
  }

  await deleteSupabaseStorageObjects({
    bucket: config.supabaseOutputsBucket,
    paths: Array.from(new Set(allPaths)),
  });
};

const CHAT_REPLAY_CONTEXT_LIMIT = Number(process.env.CHAT_REPLAY_CONTEXT_LIMIT || 12);

const normalizeReplayContextContent = (content) => {
  if (typeof content !== "string") return "";
  return content.trim();
};

const fetchReplayContextMessages = async ({ sessionId, currentMessageText, limit = CHAT_REPLAY_CONTEXT_LIMIT }) => {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return [];

  const params = new URLSearchParams({
    session_id: `eq.${sessionId}`,
    select: "id,role,content,created_at",
    order: "created_at.desc,id.desc",
    limit: String(Math.max(1, limit + 2)),
  });

  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/chat_messages?${params.toString()}`, {
    headers: buildSupabaseAdminHeaders(),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows)) {
    throw new Error(`chat_messages.fetch_failed:${response.status}`);
  }

  const currentText = String(currentMessageText ?? "").trim();
  let skippedCurrentMessage = false;
  return rows
    .filter((row) => {
      const role = row?.role === "assistant" ? "assistant" : row?.role === "user" ? "user" : "";
      const messageText = normalizeReplayContextContent(row?.content);
      if (!role || !messageText) return false;
      if (!skippedCurrentMessage && role === "user" && currentText && messageText === currentText) {
        skippedCurrentMessage = true;
        return false;
      }
      return true;
    })
    .slice(0, limit)
    .reverse()
    .map((row) => ({
      role: row.role === "assistant" ? "assistant" : "user",
      messageText: normalizeReplayContextContent(row.content),
      attachments: [],
    }));
};


const assertChatSessionOwner = async ({ sessionId, userId }) => {
  const params = new URLSearchParams({
    id: `eq.${sessionId}`,
    user_id: `eq.${userId}`,
    select: "id",
  });
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/chat_sessions?${params.toString()}`, {
    headers: buildSupabaseAdminHeaders(),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows) || rows.length === 0) {
    const error = new Error("chat_session_not_found");
    error.status = 404;
    throw error;
  }
};

const deleteChatSessionData = async ({ sessionId, userId, hermesSessionIds = [] }) => {
  await assertChatSessionOwner({ sessionId, userId });
  try {
    await deleteGeneratedImagesForHermesSessions(hermesSessionIds);
  } catch (error) {
    console.warn("[chat-bridge] could not delete generated images for chat session", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await deleteSupabaseRows("chat_messages", { session_id: sessionId });
  await deleteSupabaseRows("chat_sessions", { id: sessionId, user_id: userId });
};

const IMAGE_GENERATE_QUALITIES = new Set(["auto", "low", "medium", "high"]);

const IMAGE_GENERATE_SIZES = new Set([

  "auto",

  "1024x1024",

  "1536x1024",

  "1024x1536",

  "2048x2048",

  "2048x1152",

  "1152x2048",

  "2560x1440",

  "1440x2560",

  "3840x2160",

  "2160x3840",

]);

const IMAGE_GENERATE_OUTPUT_FORMATS = new Set(["png", "jpeg", "webp"]);



const validateImageOptions = (payload) => {

  if (payload.intent !== "image_generate") return null;

  const options = payload.image_options && typeof payload.image_options === "object"

    ? payload.image_options

    : {};

  const quality = typeof options.quality === "string" ? options.quality.trim().toLowerCase() : "auto";

  const size = typeof options.size === "string" ? options.size.trim().toLowerCase() : "auto";

  const outputFormat = typeof options.output_format === "string" ? options.output_format.trim().toLowerCase() : "png";

  if (!IMAGE_GENERATE_QUALITIES.has(quality)) {

    const error = new Error("invalid_image_quality");

    error.status = 400;

    throw error;

  }

  if (!IMAGE_GENERATE_SIZES.has(size)) {

    const error = new Error("invalid_image_size");

    error.status = 400;

    throw error;

  }

  if (!IMAGE_GENERATE_OUTPUT_FORMATS.has(outputFormat)) {

    const error = new Error("invalid_image_output_format");

    error.status = 400;

    throw error;

  }

  return { quality, size, output_format: outputFormat };

};

const resolveArtifactAccessOwner = async ({ artifactId, user }) => {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return user.id;
  const query = new URLSearchParams({
    artifact_id: `eq.${artifactId}`,
    tenant_id: `eq.${user.tenant_id}`,
    artifact_type: "eq.peca_visual",
    status: "eq.validated",
    select: "created_by_user_id",
    limit: "1",
  });
  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/validated_works?${query}`, {
    headers: buildSupabaseAdminHeaders(),
  });
  if (!response.ok) return user.id;
  const rows = await response.json().catch(() => []);
  const ownerId = Array.isArray(rows) ? rows[0]?.created_by_user_id : null;
  return typeof ownerId === "string" && ownerId ? ownerId : user.id;
};



const validateChatPayload = (payload) => {
  const sessionId = typeof payload.session_id === "string" ? payload.session_id.trim() : "";
  const messageText = typeof payload.message_text === "string" ? payload.message_text.trim() : "";
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  const imageOptions = validateImageOptions(payload);

  const intent = imageOptions ? "image_generate" : null;

  if (!sessionId) {
    const error = new Error("missing_session_id");
    error.status = 400;
    throw error;
  }

  if (!messageText && attachments.length === 0) {
    const error = new Error("empty_message");
    error.status = 400;
    throw error;
  }

  return { session_id: sessionId, message_text: messageText, attachments, intent, image_options: imageOptions };
};

class RunStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.runs = new Map();
    this.subscribers = new Map();
  }

  async init() {
    await mkdir(this.runsDir, { recursive: true });
    const files = await readdir(this.runsDir).catch(() => []);
    await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
      const raw = await readFile(path.join(this.runsDir, file), "utf8").catch(() => "");
      if (!raw) return;
      try {
        const run = JSON.parse(raw);
        if (!run?.id) return;
        if (!Array.isArray(run.events)) run.events = [];
        if (!Array.isArray(run.files)) run.files = [];
        if (!Array.isArray(run.attachments)) run.attachments = [];
        if (!run.memory_diagnostics) {
          run.memory_diagnostics = createInitialMemoryDiagnostics({
            tenantId: run.tenant_id ?? config.defaultTenantId,
            userId: run.user_id ?? "unknown",
            routingContractEnabled: isNexusMemoryRoutingContractEnabled(),
          });
        }
        if (!terminalStatuses.has(run.status)) {
          run.status = "interrupted";
          run.error_message = "Bridge reiniciou antes do run terminar.";
          run.updated_at = nowIso();
        }
        this.runs.set(run.id, run);
        await this.persist(run);
      } catch {
        // ignore corrupted run snapshots
      }
    }));
  }

  get runsDir() {
    return path.join(this.dataDir, "runs");
  }

  get(id) {
    return this.runs.get(id) || null;
  }

  async persist(run) {
    await mkdir(this.runsDir, { recursive: true });
    await writeFile(path.join(this.runsDir, `${run.id}.json`), JSON.stringify(run, null, 2));
  }

  async save(run) {
    run.updated_at = nowIso();
    this.runs.set(run.id, run);
    await this.persist(run);
    this.notify(run.id);
  }

  subscribe(runId, res, { closeOnTerminal = false, startIndex = 0 } = {}) {
    const run = this.get(runId);
    if (!run) return null;

    const subscriber = {
      res,
      index: Math.max(0, Number.isInteger(startIndex) ? startIndex : 0),
      closeOnTerminal,
      closed: false,
    };

    const set = this.subscribers.get(runId) ?? new Set();
    set.add(subscriber);
    this.subscribers.set(runId, set);

    const cleanup = () => {
      subscriber.closed = true;
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(runId);
    };

    res.on("close", cleanup);
    this.flushSubscriber(runId, subscriber);
    return cleanup;
  }

  notify(runId) {
    const subscribers = this.subscribers.get(runId);
    if (!subscribers) return;
    subscribers.forEach((subscriber) => this.flushSubscriber(runId, subscriber));
  }

  flushSubscriber(runId, subscriber) {
    if (subscriber.closed) return;
    const run = this.get(runId);
    if (!run) return;

    while (subscriber.index < run.events.length) {
      const event = run.events[subscriber.index];
      subscriber.res.write(emitSse(event.event, event.data));
      subscriber.index += 1;
    }

    if (terminalStatuses.has(run.status) && subscriber.closeOnTerminal) {
      subscriber.res.end();
      subscriber.closed = true;
    }
  }
}

const buildRunNexusContext = (run) => ({
  tenantId: run.tenant_id,
  userId: run.user_id,
  userRole: run.user_role || "member",
  userName: run.user_name || "",
  userEmail: run.user_email || "",
});

const issueRunMarketingOpsDelegation = async (run) => {
  if (!config.marketingOpsDelegation.activeKey) return "";
  const scopes = [
    "campaign:read",
    "campaign:write",
    "item:read",
    "item:write",
    "timeline:read",
    "content:read",
    "content:write",
    "artifact:write",
    "approval:submit",
  ];
  if (run.user_role === "manager" || run.user_role === "admin") scopes.push("audit:read");
  return issueMarketingOpsDelegation({
    userId: run.user_id,
    tenantId: run.tenant_id,
    role: run.user_role || "member",
    chatSessionId: run.chat_session_id,
    runId: run.id,
    correlationId: run.id,
    confirmationIntent: confirmationIntentForMarketingOpsDecision(run.marketing_ops_decision),
  }, scopes, config.marketingOpsDelegation);
};

const issueRunPictureDelegation = async (run) => {
  if (run.experience !== "picture") return "";
  return issuePictureDelegation({
    userId: run.user_id,
    tenantId: run.tenant_id,
    role: run.user_role || "member",
    chatSessionId: run.chat_session_id,
    workspaceId: run.picture_workspace_id,
    runId: run.id,
  }, ["picture:read", "picture:write"], config.pictureDelegation);
};


class HermesBridge {
  constructor({ store, hermesStateRepository, approvalRegistry }) {
    this.store = store;
    this.hermesStateRepository = hermesStateRepository;
    this.approvalRegistry = approvalRegistry;
    this.activeRunConsumers = new Set();
  }

  async createRun({ user, payload }) {
    const validated = validateChatPayload(payload);
    const pictureExperience = validateChatExperience(payload);
    let pictureWorkspace = null;
    if (pictureExperience.experience === "picture") {
      await pictureSessions.assertPictureSession({ sessionId: validated.session_id, userId: user.id });
      pictureWorkspace = await pictureClient.getWorkspace({
        userId: user.id,
        tenantId: user.tenant_id,
        sessionId: validated.session_id,
        workspaceId: pictureExperience.pictureWorkspaceId,
      });
      if (pictureWorkspace.chat_session_id !== validated.session_id) {
        const error = new Error("picture_workspace_session_mismatch");
        error.status = 409;
        throw error;
      }
    }
    const preparedAttachments = await prepareHermesAttachments({
      attachments: validated.attachments,
      userId: user.id,
      sessionId: validated.session_id,
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: config.supabaseAnonKey,
      supabaseServiceRoleKey: config.supabaseServiceRoleKey,
      userToken: user.token,
      bucket: config.attachmentBucket,
      sharedImageBridgeDir: config.hermesImageInputsBridgeDir,
      sharedImageHermesDir: config.hermesImageInputsHermesDir,
    });
    if (pictureExperience.experience === "picture" && preparedAttachments.length > 0) {
      await pictureClient.importPreparedReferences({
        userId: user.id,
        tenantId: user.tenant_id,
        sessionId: validated.session_id,
        workspaceId: pictureExperience.pictureWorkspaceId,
        attachments: preparedAttachments,
      });
    }
    const pictureFiles = pictureExperience.experience === "picture"
      ? await pictureClient.getFiles({
          userId: user.id,
          tenantId: user.tenant_id,
          workspaceId: pictureExperience.pictureWorkspaceId,
        })
      : [];
    const pictureWorkspaceSummary = pictureExperience.experience === "picture"
      ? buildPictureWorkspaceSummary({ workspace: pictureWorkspace, files: pictureFiles })
      : null;

    const mode = selectHermesBridgeMode(preparedAttachments, {
      experience: pictureExperience.experience,
      textTransport: config.hermesTextTransport,
    });
    const replayContextMessages = mode === "session"
      ? []
      : await fetchReplayContextMessages({
      sessionId: validated.session_id,
      currentMessageText: validated.message_text,
    });
    const run = {
      id: randomUUID(),
      user_id: user.id,
      user_role: user.role || "member",
      user_profile_role: user.profile_role || user.role || "member",
      user_name: user.name || "",
      user_email: user.email || null,
      tenant_id: user.tenant_id,
      chat_session_id: validated.session_id,
      hermes_session_id: buildHermesRunSessionId(validated.session_id),
      hermes_run_id: null,
      hermes_response_id: null,
      hermes_conversation_id: null,
      mode,
      status: "queued",

      experience: pictureExperience.experience,
      picture_workspace_id: pictureExperience.pictureWorkspaceId,
      picture_workspace_summary: pictureWorkspaceSummary,
      message_text: validated.message_text,

      intent: pictureExperience.experience === "picture" ? null : validated.intent,

      image_options: pictureExperience.experience === "picture" ? null : validated.image_options,
      input: "",
      attachments: preparedAttachments,
      replay_context_messages: replayContextMessages,
      output_text: "",
      files: [],
      events: [
        {
          event: "meta",
          data: {
            provider: "hermes",
            event: "bridge.run.accepted",
            run_id: null,
            bridge_run_id: null,
            mode,
            tenant_id: user.tenant_id,
            user_role: user.role || "member",
            user_name: user.name || "",
            memory_routing_contract_enabled: isNexusMemoryRoutingContractEnabled(),
          },
        },
      ],
      error_message: null,
      memory_diagnostics: createInitialMemoryDiagnostics({
        tenantId: user.tenant_id,
        userId: user.id,
        routingContractEnabled: isNexusMemoryRoutingContractEnabled(),
      }),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    run.events[0].data.bridge_run_id = run.id;

    await this.store.save(run);
    queueMicrotask(() => {
      this.executeRun(run.id).catch(async (error) => {
        await this.failRun(run.id, error);
      });
    });

    return run;
  }

  applyArtifactUrlReplacements(run, text) {
    return replaceArtifactUrls(text, run.artifact_url_replacements ?? []);
  }

  normalizeEventArtifactUrls(run, event) {
    if (event.event !== "delta" || typeof event.data?.delta !== "string") return event;
    const delta = this.applyArtifactUrlReplacements(run, event.data.delta);
    if (delta === event.data.delta) return event;
    return {
      ...event,
      data: {
        ...event.data,
        delta,
      },
    };
  }

  registerArtifactUrlReplacements(run, sourceFiles, importedFiles) {
    const replacements = collectArtifactUrlReplacements(sourceFiles, importedFiles);
    if (replacements.length === 0) return;

    const existing = Array.isArray(run.artifact_url_replacements) ? run.artifact_url_replacements : [];
    const seen = new Set(existing.map((replacement) => `${replacement.from}\n${replacement.to}`));
    const nextReplacements = [...existing];

    replacements.forEach((replacement) => {
      const key = `${replacement.from}\n${replacement.to}`;
      if (seen.has(key)) return;
      seen.add(key);
      nextReplacements.push(replacement);
    });

    run.artifact_url_replacements = nextReplacements;
    run.output_text = replaceArtifactUrls(run.output_text, replacements);
    run.events = run.events.map((existingEvent) => {
      if (existingEvent.event !== "delta" || typeof existingEvent.data?.delta !== "string") return existingEvent;
      return {
        ...existingEvent,
        data: {
          ...existingEvent.data,
          delta: replaceArtifactUrls(existingEvent.data.delta, replacements),
        },
      };
    });
  }

  appendEvent(run, event) {
    const normalizedEvent = this.normalizeEventArtifactUrls(run, event);
    run.events.push(normalizedEvent);
    if (normalizedEvent.event === "approval") {
      this.approvalRegistry.register({
        userId: run.user_id,
        bridgeRunId: run.id,
        hermesRunId: run.hermes_run_id,
        requestId: normalizedEvent.data?.request_id,
        choices: normalizedEvent.data?.choices,
        summary: normalizedEvent.data?.summary,
      });
    }
    if (normalizedEvent.event === "meta" && normalizedEvent.data?.event === "approval.resolved") {
      this.approvalRegistry.complete(normalizedEvent.data?.request_id, normalizedEvent.data?.choice);
    }
    applyMemoryDiagnosticEvent(run.memory_diagnostics, normalizedEvent);
    if (normalizedEvent.event === "delta" && typeof normalizedEvent.data?.delta === "string") {
      run.output_text += normalizedEvent.data.delta;
    }
    if (normalizedEvent.event === "files" && Array.isArray(normalizedEvent.data?.files)) {
      const seen = new Set(run.files.map((file) => file.url));
      normalizedEvent.data.files.forEach((file) => {
        if (!seen.has(file.url)) {
          seen.add(file.url);
          run.files.push(file);
        }
      });
    }
  }

  mapHermesArtifactFile(file) {
    const bridgePath = toBridgeArtifactPath({
      hermesPath: file?.url,
      hermesRoot: config.hermesArtifactsHermesDir,
      bridgeRoot: config.hermesArtifactsBridgeDir,
    });

    if (!bridgePath) return file;

    return {
      ...file,
      original_url: file.original_url || file.url,
      url: bridgePath,
    };
  }

  async importFilesEventArtifacts(run, event) {
    if (event.event !== "files" || !Array.isArray(event.data?.files)) return event;

    const files = event.data.files.map((file) => this.mapHermesArtifactFile(file));
    const importedFiles = await importHermesFilesToArtifacts({
      files,
      ownerId: run.user_id,
      sessionId: run.chat_session_id,
      artifactBaseUrl: config.artifactInternalUrl,
      artifactInternalKey: config.artifactInternalKey,
      allowedLocalRoots: [config.hermesArtifactsBridgeDir],
      accessLinkTtlSeconds: config.artifactAccessTokenTtlSeconds,
      logger: console,
    });
    this.registerArtifactUrlReplacements(run, files, importedFiles);

    return {
      ...event,
      data: {
        ...event.data,
        files: importedFiles,
      },
    };
  }

  async appendEvents(run, events) {
    for (const event of events) {
      this.appendEvent(run, await this.importFilesEventArtifacts(run, event));
    }
    await this.store.save(run);
  }

  async failRun(runId, error) {
    const run = this.store.get(runId);
    if (!run || terminalStatuses.has(run.status)) return;
    run.status = "failed";
    run.error_message = error instanceof Error ? error.message : String(error);
    this.appendEvent(run, { event: "error", data: run.error_message });
    this.appendEvent(run, { event: "done", data: { request_id: run.id } });
    await this.store.save(run);
  }

  async ensureHermesSessionBinding(run, hermesBaseUrl, { createIfMissing = true, forceRecreate = false } = {}) {
    let state = await ensureHermesConversationState({
      repository: this.hermesStateRepository,
      chatSessionId: run.chat_session_id,
      userId: run.user_id,
    });

    if ((state.hermes_session_id && !forceRecreate) || !config.hermesSessionsApiEnabled || !createIfMissing) {
      return state;
    }

    try {
      const session = await createHermesSession({
        hermesBaseUrl,
        hermesApiKey: config.hermesApiKey,
        sessionId: run.hermes_session_id || buildHermesRunSessionId(run.chat_session_id),
        title: `Nexus ${run.chat_session_id}`,
      });
      state = await bindHermesSessionToState({
        repository: this.hermesStateRepository,
        state,
        hermesSessionId: session.id,
      });
    } catch (error) {
      if (!isHermesSessionApiUnavailableError(error)) {
        throw error;
      }
    }

    return state;
  }

  buildHermesHeaders(accept, run) {
    return {
      "Content-Type": "application/json",
      Accept: accept,
      "Cache-Control": "no-cache",
      "User-Agent": "NexusHermesBridge/1.0",
      "X-Request-Id": run.id,
      "X-Hermes-Session-Id": run.hermes_session_id,
      "X-Hermes-Session-Key": buildHermesSessionKey({
        userId: run.user_id,
        sessionId: run.chat_session_id,
      }),
      "X-Tenant-Id": run.tenant_id,
      "X-User-Id": run.user_id,
      "X-Nexus-User-Id": run.user_id,
      "X-Nexus-User-Role": run.user_role || "member",
      "X-Nexus-Session-Id": run.chat_session_id,
      ...(config.hermesApiKey ? { Authorization: `Bearer ${config.hermesApiKey}` } : {}),
    };
  }

  async resolveRunMarketingOpsDecision(run, hermesBaseUrl) {
    if (run.experience === "picture") return "none";
    try {
      const response = await fetch(new URL("/v1/internal/marketing-ops-decision", hermesBaseUrl.origin), {
        method: "POST",
        headers: this.buildHermesHeaders("application/json", run),
        body: JSON.stringify({ session_id: run.hermes_session_id, message: run.message_text }),
        signal: AbortSignal.timeout(config.marketingOpsDecisionTimeoutMs),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return "clarify";
      return ["approve", "reject", "revise", "clarify", "none"].includes(payload?.decision)
        ? payload.decision
        : "clarify";
    } catch {
      return "clarify";
    }
  }

  createRunsClient(run, hermesBaseUrl) {
    return new HermesRunsClient({
      baseUrl: hermesBaseUrl,
      apiKey: config.hermesApiKey,
      defaultHeaders: this.buildHermesHeaders("application/json", run),
    });
  }

  async applyHermesStatus(run, payload) {
    const parsed = parseHermesStatusPayload(payload, {
      requestId: run.id,
      runId: run.hermes_run_id,
      sessionId: run.hermes_session_id,
      conversation: run.hermes_conversation_id,
      streamedText: run.output_text,
      tenantId: run.tenant_id,
      userId: run.user_id,
    });

    if (!parsed.terminal || !parsed.parsed) return false;
    await this.applyParsedResult(run, parsed.parsed);
    return true;
  }

  async consumeEventsResponse(run, response, options = {}) {
    if (!response.ok || !response.body) return "open";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const outcome = await this.parseAndApplyEventBlock(run, part, options);
          if (outcome === "terminal" || outcome === "retry") return outcome;
        }
      }

      if (buffer.trim()) {
        const outcome = await this.parseAndApplyEventBlock(run, buffer, options);
        buffer = "";
        if (outcome === "terminal" || outcome === "retry") return outcome;
      }

      return "open";
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore reader release errors
      }
    }
  }

  async parseAndApplyEventBlock(run, eventBlock, options = {}) {
    const parsed = parseHermesEventBlock(eventBlock, {
      requestId: run.id,
      runId: run.hermes_run_id,
      sessionId: run.hermes_session_id,
      conversation: run.hermes_conversation_id,
      streamedText: run.output_text,
      tenantId: run.tenant_id,
      userId: run.user_id,
    });

    if (options.shouldRetryParsed?.(parsed)) {
      return "retry";
    }

    await this.applyParsedResult(run, parsed, options);
    return parsed.completed || parsed.failed || parsed.cancelled ? "terminal" : "open";
  }

  async applyParsedResult(run, parsed, options = {}) {
    if (parsed.events.length > 0) {
      await this.appendEvents(run, parsed.events);
    }
    if (parsed.responseId) {
      run.hermes_response_id = parsed.responseId;
    }
    if (options.onParsed) {
      await options.onParsed(parsed);
    }
    if (parsed.completed) {
      run.status = "completed";
      await this.store.save(run);
    }
    if (parsed.failed) {
      run.status = "failed";
      await this.store.save(run);
    }
    if (parsed.cancelled) {
      run.status = "cancelled";
      await this.store.save(run);
    }
  }

  async executeRunsApi(run, hermesBaseUrl) {
    if (this.activeRunConsumers.has(run.id)) return;
    this.activeRunConsumers.add(run.id);

    try {
      const client = this.createRunsClient(run, hermesBaseUrl);
      const marketingOpsDelegation = await issueRunMarketingOpsDelegation(run);
      const requestPayload = buildHermesRunRequest({
        sessionId: run.hermes_session_id,
        messageText: run.message_text,
        attachments: run.attachments,
        replayContextMessages: run.replay_context_messages,
        nexusContext: buildRunNexusContext(run),
        marketingOpsDelegation,
        marketingOpsDecision: run.marketing_ops_decision,
      });
      run.input = redactMarketingOpsDelegation(requestPayload.input);

      const created = await client.createRun({ bridgeRunId: run.id, payload: requestPayload });
      run.hermes_run_id = created.runId;
      this.appendEvent(run, {
        event: "meta",
        data: {
          provider: "hermes",
          event: "run.created",
          run_id: run.hermes_run_id,
          session_id: run.hermes_session_id,
        },
      });
      await this.store.save(run);

      while (!terminalStatuses.has(run.status)) {
        const eventsResponse = await client.getEvents(run.hermes_run_id);
        const stoppedByEvents = await this.consumeEventsResponse(run, eventsResponse);
        if (stoppedByEvents === "terminal" || terminalStatuses.has(run.status)) break;

        const statusPayload = await client.getRun(run.hermes_run_id);
        const stoppedByStatus = await this.applyHermesStatus(run, statusPayload);
        if (stoppedByStatus || terminalStatuses.has(run.status)) break;

        this.appendEvent(run, { event: "status", data: { text: "Hermes segue executando a tarefa...", tone: "info" } });
        await this.store.save(run);
        await wait(config.hermesPollMs);
      }

      if (run.status === "completed" && !run.events.some((event) => event.event === "done")) {
        this.appendEvent(run, { event: "done", data: { request_id: run.id } });
        await this.store.save(run);
      }
    } finally {
      this.activeRunConsumers.delete(run.id);
    }
  }

  async executeSessionApi(run, hermesBaseUrl, initialState) {

    let state = initialState;

    const hasImageAttachments = run.experience !== "picture"
      && run.attachments.some((attachment) => isImageAttachment(attachment));

    let imageTransport = "inline";

    let attemptedRemoteImage = false;

    let recreatedMissingSession = false;



    while (!terminalStatuses.has(run.status)) {
      const marketingOpsDelegation = run.experience === "picture" ? "" : await issueRunMarketingOpsDelegation(run);
      const pictureDelegation = await issueRunPictureDelegation(run);

      const requestPayload = buildHermesSessionChatRequest({

        messageText: run.message_text,

        attachments: run.attachments,

        imageTransport,

        intent: run.intent,

        imageOptions: run.image_options,
        nexusContext: buildRunNexusContext(run),
        marketingOpsDelegation,
        marketingOpsDecision: run.marketing_ops_decision,
        experience: run.experience,
        pictureWorkspaceId: run.picture_workspace_id,
        pictureWorkspaceSummary: run.picture_workspace_summary,
        pictureDelegation,

      });

      run.input = redactPictureDelegation(redactMarketingOpsDelegation(typeof requestPayload.message === "string"

        ? requestPayload.message

        : JSON.stringify(requestPayload.message)));



      const response = await fetch(new URL(`/api/sessions/${encodeURIComponent(run.hermes_session_id)}/chat/stream`, hermesBaseUrl.origin), {

        method: "POST",

        headers: this.buildHermesHeaders("text/event-stream", run),

        body: JSON.stringify(requestPayload),

      });



      if (!response.ok || !response.body) {

        if (response.status === 404 && config.hermesSessionsApiEnabled && !recreatedMissingSession) {

          recreatedMissingSession = true;

          state = await this.ensureHermesSessionBinding(run, hermesBaseUrl, {

            createIfMissing: true,

            forceRecreate: true,

          });

          run.hermes_session_id = state.hermes_session_id || buildHermesRunSessionId(run.chat_session_id);

          await this.store.save(run);

          continue;

        }

        if (response.status === 404) {

          throw new Error(`hermes_session_chat_failed:${response.status}`);

        }



        if (hasImageAttachments && !attemptedRemoteImage) {

          attemptedRemoteImage = true;

          imageTransport = "remote";

          this.appendEvent(run, {

            event: "status",

            data: { text: "Hermes vai tentar ler a imagem por URL segura.", tone: "warning" },

          });

          await this.store.save(run);

          continue;

        }



        const body = await response.text().catch(() => "");

        throw new Error(body.trim() || `hermes_session_chat_failed:${response.status}`);

      }



      const result = await this.consumeEventsResponse(run, response, {

        shouldRetryParsed: (parsed) => (

          parsed.failed &&

          hasImageAttachments &&

          !attemptedRemoteImage &&

          !parsed.streamedText?.trim()

        ),

        onParsed: async (parsed) => {

          const nextHermesSessionId = parsed.events

            .map((event) => event.data?.session_id)

            .find((sessionId) => typeof sessionId === "string" && sessionId.trim());

          if (nextHermesSessionId && nextHermesSessionId !== state.hermes_session_id) {

            state = await bindHermesSessionToState({

              repository: this.hermesStateRepository,

              state,

              hermesSessionId: nextHermesSessionId,

            });

            run.hermes_session_id = nextHermesSessionId;

            await this.store.save(run);

          }

        },

      });



      if (result === "retry") {

        attemptedRemoteImage = true;

        imageTransport = "remote";

        run.output_text = "";

        this.appendEvent(run, {

          event: "status",

          data: { text: "Hermes vai tentar ler a imagem por URL segura.", tone: "warning" },

        });

        await this.store.save(run);

        continue;

      }



      if (result === "terminal" || terminalStatuses.has(run.status)) break;

      throw new Error("hermes_session_stream_closed_without_terminal_event");

    }

  }



  async fetchHermesResponse(run, hermesBaseUrl, routingState, imageTransport) {
    const marketingOpsDelegation = await issueRunMarketingOpsDelegation(run);
    const requestPayload = buildHermesResponsesRequest({
      modelName: config.hermesModelName,
      userId: run.user_id,
      sessionId: run.chat_session_id,
      messageText: run.message_text,
      attachments: run.attachments,
      replayContextMessages: run.replay_context_messages,
      conversationId: routingState.conversationId,
      previousResponseId: routingState.previousResponseId,
      imageTransport,
      nexusContext: buildRunNexusContext(run),
      marketingOpsDelegation,
      marketingOpsDecision: run.marketing_ops_decision,
    });
    run.input = redactMarketingOpsDelegation(JSON.stringify(requestPayload.input));

    return await fetch(new URL("/v1/responses", hermesBaseUrl.origin), {
      method: "POST",
      headers: this.buildHermesHeaders("text/event-stream", run),
      body: JSON.stringify(requestPayload),
    });
  }

  async executeResponsesApi(run, hermesBaseUrl, initialState) {
    let state = initialState;
    let routingState = buildHermesResponseRoutingState({ state });
    run.hermes_conversation_id = routingState.conversationId;
    const hasImageAttachments = run.attachments.some((attachment) => isImageAttachment(attachment));
    let imageTransport = "inline";
    let attemptedRemoteImage = false;

    while (!terminalStatuses.has(run.status)) {
      const response = await this.fetchHermesResponse(run, hermesBaseUrl, routingState, imageTransport);
      if (!response.ok || !response.body) {
        if (hasImageAttachments && !attemptedRemoteImage) {
          attemptedRemoteImage = true;
          imageTransport = "remote";
          this.appendEvent(run, {
            event: "status",
            data: { text: "Hermes vai tentar ler a imagem por URL segura.", tone: "warning" },
          });
          await this.store.save(run);
          continue;
        }
        const body = await response.text().catch(() => "");
        throw new Error(body.trim() || `hermes_responses_failed:${response.status}`);
      }

      state = await bindHermesSessionFromResponse({
        repository: this.hermesStateRepository,
        state,
        run,
        response,
      });
      routingState = buildHermesResponseRoutingState({ state });

      const result = await this.consumeEventsResponse(run, response, {
        shouldRetryParsed: (parsed) => (
          parsed.failed &&
          hasImageAttachments &&
          !attemptedRemoteImage &&
          !parsed.streamedText?.trim()
        ),
        onParsed: async (parsed) => {
          if (parsed.recoveredFromFailure && parsed.responseId) {
            state = await markHermesResponseRecovered({
              repository: this.hermesStateRepository,
              state,
              responseId: parsed.responseId,
              errorCode: parsed.errorCode ?? "hermes_recovered_failure",
            });
            routingState = buildHermesResponseRoutingState({ state });
            return;
          }

          if (parsed.completed && parsed.responseId) {
            state = await markHermesResponseCompleted({
              repository: this.hermesStateRepository,
              state,
              responseId: parsed.responseId,
            });
            routingState = buildHermesResponseRoutingState({ state });
            return;
          }

          if (parsed.failed) {
            state = await markHermesChainDegraded({
              repository: this.hermesStateRepository,
              state,
              errorCode: parsed.errorCode ?? "hermes_response_failed",
            });
            routingState = buildHermesResponseRoutingState({ state });
          }
        },
      });

      if (result === "retry") {
        attemptedRemoteImage = true;
        imageTransport = "remote";
        run.output_text = "";
        this.appendEvent(run, {
          event: "status",
          data: { text: "Hermes vai tentar ler a imagem por URL segura.", tone: "warning" },
        });
        await this.store.save(run);
        continue;
      }

      if (result === "terminal" || terminalStatuses.has(run.status)) break;
      throw new Error("hermes_responses_stream_closed_without_terminal_event");
    }
  }

  async executeRun(runId) {
    const hermesBaseUrl = normalizeBaseUrl(config.hermesBaseUrl);
    if (!hermesBaseUrl) {
      throw new Error("missing_or_invalid_HERMES_API_BASE_URL");
    }

    const run = this.store.get(runId);
    if (!run) return;

    const state = await this.ensureHermesSessionBinding(run, hermesBaseUrl, {
      createIfMissing: run.mode !== "responses",
    });
    run.hermes_session_id = state.hermes_session_id || buildHermesRunSessionId(run.chat_session_id);
    run.hermes_conversation_id = state.hermes_conversation_id;

    run.marketing_ops_decision = await this.resolveRunMarketingOpsDecision(run, hermesBaseUrl);

    this.appendEvent(run, {
      event: "meta",
      data: { provider: "hermes", event: "marketing_ops.decision", decision: run.marketing_ops_decision },
    });
    run.status = "running";
    this.appendEvent(run, { event: "status", data: { text: "Hermes iniciou a tarefa.", tone: "info" } });
    await this.store.save(run);

    if (run.mode === "session") {

      await this.executeSessionApi(run, hermesBaseUrl, state);

    } else if (run.mode === "responses") {
      await this.executeResponsesApi(run, hermesBaseUrl, state);
    } else {
      await this.executeRunsApi(run, hermesBaseUrl);
    }
  }
}

const store = new RunStore({ dataDir: config.dataDir });
const approvalRegistry = new HermesApprovalRegistry();
const hermesStateRepository = config.supabaseUrl && config.supabaseServiceRoleKey
  ? createSupabaseHermesStateRepository({
      supabaseUrl: config.supabaseUrl,
      supabaseServiceRoleKey: config.supabaseServiceRoleKey,
    })
  : createMemoryHermesStateRepository();
const pictureClient = new PictureClient({
  baseUrl: config.pictureInternalUrl,
  internalKey: config.pictureInternalKey,
  artifactBaseUrl: config.artifactInternalUrl,
  artifactInternalKey: config.artifactInternalKey,
});
const pictureSessions = createSupabasePictureSessionRepository({
  supabaseUrl: config.supabaseUrl,
  serviceRoleKey: config.supabaseServiceRoleKey,
});
const pictureModeService = createPictureModeService({
  sessions: pictureSessions,
  picture: pictureClient,
  hermes: {
    async deleteSession({ userId, sessionId }) {
      const state = await hermesStateRepository.get(sessionId, userId).catch(() => null);
      const hermesBaseUrl = normalizeBaseUrl(config.hermesBaseUrl);
      if (state?.hermes_session_id && hermesBaseUrl) {
        await deleteHermesSession({
          hermesBaseUrl,
          hermesApiKey: config.hermesApiKey,
          hermesSessionId: state.hermes_session_id,
        }).catch(() => false);
      }
      await hermesStateRepository.delete(sessionId, userId).catch(() => {});
    },
  },
});

const bridge = new HermesBridge({ store, hermesStateRepository, approvalRegistry });

const writeSseHeaders = (req, res) => {
  res.writeHead(200, {
    ...getCorsHeaders(req),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
};

const handleRequest = async (req, res) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    jsonResponse(res, 200, {
      ok: true,
      service: "nexus-hermes-bridge",
      hermesConfigured: Boolean(normalizeBaseUrl(config.hermesBaseUrl)),
      artifactServerConfigured: Boolean(config.artifactInternalUrl && config.artifactInternalKey),
      supabaseStorageConfigured: Boolean(config.supabaseUrl && (config.supabaseServiceRoleKey || config.supabaseAnonKey)),
      supabaseStateConfigured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
      defaultTenantId: config.defaultTenantId,
      attachmentBucket: config.attachmentBucket,
    }, corsHeaders);
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/marketing-ops/delegations/refresh") {
    if (!config.marketingOpsDelegationRefreshKey) {
      jsonResponse(res, 503, { error: "delegation_refresh_not_configured" });
      return;
    }
    if (!isValidDelegationRefreshKey(
      req.headers["x-internal-key"],
      config.marketingOpsDelegationRefreshKey,
    )) {
      jsonResponse(res, 401, { error: "unauthorized" });
      return;
    }

    const payload = await readJsonBody(req, 32_768);
    const token = typeof payload.delegation_token === "string" ? payload.delegation_token : "";
    try {
      const claims = decodeJwt(token);
      const run = typeof claims.run_id === "string" ? store.get(claims.run_id) : null;
      const refreshed = await refreshMarketingOpsDelegation(token, run, config.marketingOpsDelegation);
      const refreshedClaims = decodeJwt(refreshed);
      jsonResponse(res, 200, {
        delegation_token: refreshed,
        expires_at: new Date(refreshedClaims.exp * 1000).toISOString(),
      });
    } catch {
      jsonResponse(res, 401, { error: "delegation_refresh_denied" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/internal/picture/delegations/refresh") {
    if (!config.pictureDelegationRefreshKey) {
      jsonResponse(res, 503, { error: "delegation_refresh_not_configured" });
      return;
    }
    if (!isValidDelegationRefreshKey(req.headers["x-internal-key"], config.pictureDelegationRefreshKey)) {
      jsonResponse(res, 401, { error: "unauthorized" });
      return;
    }
    const payload = await readJsonBody(req, 32_768);
    const token = typeof payload.delegation_token === "string" ? payload.delegation_token : "";
    try {
      const claims = decodeJwt(token);
      const run = typeof claims.run_id === "string" ? store.get(claims.run_id) : null;
      const refreshed = await refreshPictureDelegation(token, run, config.pictureDelegation);
      const refreshedClaims = decodeJwt(refreshed);
      jsonResponse(res, 200, {
        delegation_token: refreshed,
        expires_at: new Date(refreshedClaims.exp * 1000).toISOString(),
      });
    } catch {
      jsonResponse(res, 401, { error: "delegation_refresh_denied" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/memory/diagnostics") {
    const user = await verifyUser(req);
    const runId = url.searchParams.get("run_id");
    const graphHealth = await fetchGraphHealth();

    if (runId) {
      const run = store.get(runId);
      if (!run || run.user_id !== user.id) {
        jsonResponse(res, 404, { error: "run_not_found" }, corsHeaders);
        return;
      }

      jsonResponse(res, 200, {
        tenant_id: user.tenant_id,
        graph_health: graphHealth,
        run: {
          id: run.id,
          status: run.status,
          memory_diagnostics: run.memory_diagnostics,
        },
      }, corsHeaders);
      return;
    }

    const runs = Array.from(store.runs.values())
      .filter((run) => run.user_id === user.id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 10)
      .map((run) => ({
        id: run.id,
        status: run.status,
        created_at: run.created_at,
        memory_diagnostics: run.memory_diagnostics,
      }));

    jsonResponse(res, 200, {
      tenant_id: user.tenant_id,
      graph_health: graphHealth,
      runs,
    }, corsHeaders);
    return;
  }

  const artifactAccessMatch = url.pathname.match(/^\/api\/artifacts\/([^/]+)\/access-link$/);
  if (artifactAccessMatch && req.method === "POST") {
    if (!config.artifactInternalUrl || !config.artifactInternalKey) {
      jsonResponse(res, 503, { error: "artifact_server_not_configured" }, corsHeaders);
      return;
    }

    const user = await verifyUser(req);
    const ownerId = await resolveArtifactAccessOwner({
      artifactId: decodeURIComponent(artifactAccessMatch[1]),
      user,
    });
    const access = await createArtifactAccessLink({
      artifactBaseUrl: config.artifactInternalUrl,
      artifactInternalKey: config.artifactInternalKey,
      artifactId: decodeURIComponent(artifactAccessMatch[1]),
      ownerId,
      expiresInSeconds: config.artifactAccessTokenTtlSeconds,
    });

    jsonResponse(res, 200, {
      url: access.url,
      expires_at: access.expires_at,
    }, corsHeaders);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/picture/workspace/current") {
    const user = await verifyUser(req);
    const workspace = await pictureModeService.current(user);
    jsonResponse(res, 200, { workspace }, corsHeaders);
    return;
  }

  const pictureWorkspaceMatch = url.pathname.match(/^\/api\/picture\/workspaces\/([^/]+)(?:\/(files|approve|new-piece))?$/);
  if (pictureWorkspaceMatch) {
    const user = await verifyUser(req);
    const workspaceId = decodeURIComponent(pictureWorkspaceMatch[1]);
    const action = pictureWorkspaceMatch[2] || "";
    if (req.method === "GET" && action === "") {
      const workspace = await pictureModeService.get(user, workspaceId);
      jsonResponse(res, 200, { workspace }, corsHeaders);
      return;
    }
    if (req.method === "GET" && action === "files") {
      const files = await pictureModeService.files(user, workspaceId);
      jsonResponse(res, 200, { files }, corsHeaders);
      return;
    }
    if (req.method === "POST" && action === "approve") {
      await readJsonBody(req);
      const workspace = await pictureModeService.approve(user, workspaceId);
      jsonResponse(res, 200, { workspace }, corsHeaders);
      return;
    }
    if (req.method === "POST" && action === "new-piece") {
      await readJsonBody(req);
      const workspace = await pictureModeService.newPiece(user, workspaceId);
      jsonResponse(res, 200, { workspace }, corsHeaders);
      return;
    }
    jsonResponse(res, 405, { error: "method_not_allowed" }, corsHeaders);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/session/delete") {
    const user = await verifyUser(req);
    const payload = await readJsonBody(req);
    const sessionId = typeof payload.session_id === "string" ? payload.session_id.trim() : "";
    if (!sessionId) {
      jsonResponse(res, 400, { error: "missing_session_id" }, corsHeaders);
      return;
    }

    const state = await hermesStateRepository.get(sessionId, user.id).catch(() => null);
    const hermesBaseUrl = normalizeBaseUrl(config.hermesBaseUrl);
    if (state?.hermes_session_id && hermesBaseUrl) {
      try {
        await deleteHermesSession({
          hermesBaseUrl,
          hermesApiKey: config.hermesApiKey,
          hermesSessionId: state.hermes_session_id,
        });
      } catch {
        // Best effort: local deletion must not depend on Hermes being reachable.
      }
    }

    const hermesSessionIds = new Set([
      buildHermesRunSessionId(sessionId),
      state?.hermes_session_id,
    ].filter(Boolean));

    store.runs.forEach((run) => {
      if (run?.chat_session_id === sessionId && run?.user_id === user.id && run?.hermes_session_id) {
        hermesSessionIds.add(run.hermes_session_id);
      }
    });

    await hermesStateRepository.delete(sessionId, user.id).catch(() => {});
    await deleteChatSessionData({
      sessionId,
      userId: user.id,
      hermesSessionIds: Array.from(hermesSessionIds),
    });
    jsonResponse(res, 200, { ok: true }, corsHeaders);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/runs") {
    const user = await verifyUser(req);
    const payload = await readJsonBody(req);
    const run = await bridge.createRun({ user, payload });
    jsonResponse(res, 202, { run }, corsHeaders);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/stream") {
    const user = await verifyUser(req);
    const payload = await readJsonBody(req);
    const run = await bridge.createRun({ user, payload });
    writeSseHeaders(req, res);
    store.subscribe(run.id, res, { closeOnTerminal: true });
    return;
  }

  const stopRunMatch = url.pathname.match(/^\/api\/chat\/runs\/([^/]+)\/stop$/);
  if (stopRunMatch && req.method === "POST") {
    const user = await verifyUser(req);
    const runId = decodeURIComponent(stopRunMatch[1]);
    const run = store.get(runId);
    assertStoppableHermesRun(run, user.id);

    const hermesBaseUrl = normalizeBaseUrl(config.hermesBaseUrl);
    if (!hermesBaseUrl) {
      const error = new Error("hermes_unreachable");
      error.code = "hermes_unreachable";
      error.status = 503;
      throw error;
    }

    const client = bridge.createRunsClient(run, hermesBaseUrl);
    const previousStatus = run.status;
    run.status = "stopping";
    bridge.appendEvent(run, {
      event: "meta",
      data: {
        provider: "hermes",
        event: "run.stopping",
        run_id: run.hermes_run_id,
        session_id: run.hermes_session_id,
      },
    });
    bridge.appendEvent(run, {
      event: "status",
      data: { text: "Hermes está interrompendo a execução do agente.", tone: "info" },
    });
    await store.save(run);

    let stopPayload;
    try {
      stopPayload = await client.stopRun(run.hermes_run_id);
    } catch (error) {
      run.status = previousStatus;
      bridge.appendEvent(run, {
        event: "meta",
        data: {
          provider: "hermes",
          event: "run.stop_failed",
          run_id: run.hermes_run_id,
          session_id: run.hermes_session_id,
        },
      });
      bridge.appendEvent(run, {
        event: "status",
        data: { text: "Não foi possível interromper a execução.", tone: "warning" },
      });
      await store.save(run);
      throw error;
    }

    const becameTerminal = await bridge.applyHermesStatus(run, stopPayload);

    jsonResponse(res, becameTerminal ? 200 : 202, { run }, corsHeaders);
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/chat\/runs\/([^/]+)(?:\/events)?$/);
  if (runMatch && req.method === "GET") {
    const user = await verifyUser(req);
    const runId = decodeURIComponent(runMatch[1]);
    const run = store.get(runId);
    if (!run || run.user_id !== user.id) {
      jsonResponse(res, 404, { error: "run_not_found" }, corsHeaders);
      return;
    }

    if (url.pathname.endsWith("/events")) {
      writeSseHeaders(req, res);
      const cursor = Number(url.searchParams.get("cursor") ?? "0");
      store.subscribe(run.id, res, {
        closeOnTerminal: true,
        startIndex: Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) : 0,
      });
      return;
    }

    jsonResponse(res, 200, { run }, corsHeaders);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/approvals/respond") {
    const user = await verifyUser(req);
    const body = await readJsonBody(req);
    const choice = toOfficialApprovalChoice(body);
    const approval = approvalRegistry.claim({
      userId: user.id,
      requestId: body.request_id,
      choice,
    });
    const run = store.get(approval.bridgeRunId);
    if (
      !run
      || run.user_id !== user.id
      || terminalStatuses.has(run.status)
      || run.hermes_run_id !== approval.hermesRunId
    ) {
      approvalRegistry.release(approval.requestId);
      const error = new Error("approval_run_not_active");
      error.code = "approval_run_not_active";
      error.status = 409;
      throw error;
    }

    try {
      const hermesBaseUrl = normalizeBaseUrl(config.hermesBaseUrl);
      if (!hermesBaseUrl) {
        const error = new Error("hermes_unreachable");
        error.code = "hermes_unreachable";
        error.status = 503;
        throw error;
      }
      const client = bridge.createRunsClient(run, hermesBaseUrl);
      await client.respondApproval(approval.hermesRunId, { choice });
      approvalRegistry.complete(approval.requestId, choice);
      jsonResponse(res, 200, { ok: true, request_id: approval.requestId, choice }, corsHeaders);
    } catch (error) {
      approvalRegistry.release(approval.requestId);
      throw error;
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/approvals/stream") {
    const user = await verifyUser(req);

    writeSseHeaders(req, res);
    res.write(": connected\n\n");

    const unsubscribe = approvalRegistry.subscribe(user.id, (approval) => {
      if (!res.writableEnded) {
        res.write(emitSse("approval_request", toApprovalStreamPayload(approval)));
      }
    });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": heartbeat\n\n");
    }, 25_000);
    let closed = false;

    const cleanup = ({ endResponse = true } = {}) => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      req.off("close", onClientClose);
      req.off("aborted", onClientClose);
      if (endResponse && !res.writableEnded) res.end();
    };
    const onClientClose = () => cleanup({ endResponse: false });

    req.on("close", onClientClose);
    req.on("aborted", onClientClose);
    return;
  }



  jsonResponse(res, 404, { error: "not_found" }, corsHeaders);
};

await store.init();

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    jsonResponse(res, status, {
      error: error.code || error.message || "internal_error",
    }, getCorsHeaders(req));
  });
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(JSON.stringify({
    service: "nexus-hermes-bridge",
    status: "listening",
    port: config.port,
    hermesConfigured: Boolean(normalizeBaseUrl(config.hermesBaseUrl)),
  }));
});
