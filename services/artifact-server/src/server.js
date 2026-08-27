import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join } from "node:path";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import {
  deleteArtifactMetadataAndBytes,
  deleteWorkspaceArtifacts,
  listWorkspaceArtifacts,
  loadArtifactMetadata,
  parseWorkspaceUploadHeaders,
  promoteWorkspaceArtifact,
  saveArtifactMetadata,
} from "./workspaces.js";

const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_MAX_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const jsonResponse = (res, status, payload, headers = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(payload));
};

const emptyResponse = (res, status, headers = {}) => {
  res.writeHead(status, headers);
  res.end();
};

const httpError = (status, error) => {
  const err = new Error(error);
  err.status = status;
  err.code = error;
  return err;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const splitCsv = (value) =>
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeBaseUrl = (value, fallback = "") => {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  return trimmed || fallback;
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left ?? ""));
  const rightBuffer = Buffer.from(String(right ?? ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const getBearerToken = (req) => {
  const match = String(req.headers.authorization ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
};

const sanitizeFileName = (value) => {
  const raw = basename(String(value ?? "").replace(/\\/g, "/")).trim();
  const sanitized = raw
    .replace(/[\r\n"]/g, "")
    .replace(/[^\w.\-=+ ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return sanitized || "artifact.bin";
};

const encodeBase64Url = (value) => Buffer.from(value).toString("base64url");

const decodeBase64UrlJson = (value) => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

const signToken = ({ payload, secret }) => {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
};

const verifyToken = ({ token, secret }) => {
  const [encodedPayload, signature] = String(token ?? "").split(".");
  if (!encodedPayload || !signature) {
    throw httpError(401, "invalid_token");
  }

  const expected = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  if (!safeEqual(signature, expected)) {
    throw httpError(401, "invalid_token");
  }

  try {
    return decodeBase64UrlJson(encodedPayload);
  } catch {
    throw httpError(401, "invalid_token");
  }
};

const readJsonBody = async (req, maxBytes = 64 * 1024) => {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      throw httpError(413, "payload_too_large");
    }
  }

  if (!body.trim()) return {};

  try {
    return JSON.parse(body);
  } catch {
    throw httpError(400, "invalid_json");
  }
};

const getCorsHeaders = (req, allowedOrigins) => {
  const origin = req.headers.origin;
  const allowAny = allowedOrigins.includes("*");
  const allowedOrigin = origin && (allowAny || allowedOrigins.includes(origin)) ? origin : "";
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET,HEAD,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": [
      "Authorization",
      "Content-Type",
      "Range",
      "X-Nexus-Content-Type",
      "X-Nexus-Filename",
      "X-Nexus-Owner-Id",
      "X-Nexus-Session-Id",
      "X-Nexus-Source",
      "X-Nexus-Workspace-Id",
      "X-Nexus-Relative-Path",
      "X-Nexus-Artifact-Category",
      "X-Nexus-Artifact-Lifecycle",
    ].join(","),
    "Access-Control-Expose-Headers": "Accept-Ranges,Content-Disposition,Content-Length,Content-Range",
    "Access-Control-Max-Age": "86400",
  };
};

const objectPathFor = (dataDir, sha256) => join(dataDir, "objects", sha256.slice(0, 2), sha256);

const loadMetadata = async (config, id) => {
  return loadArtifactMetadata(config.dataDir, id);
};

const saveMetadata = async (config, metadata) => {
  await saveArtifactMetadata(config.dataDir, metadata);
};

const ensureObjectFromTemp = async ({ config, tempPath, sha256 }) => {
  const targetPath = objectPathFor(config.dataDir, sha256);
  await mkdir(join(config.dataDir, "objects", sha256.slice(0, 2)), { recursive: true });

  const existing = await stat(targetPath).catch(() => null);
  if (existing) {
    await rm(tempPath, { force: true });
    return targetPath;
  }

  await rm(targetPath, { force: true });
  await rename(tempPath, targetPath);
  return targetPath;
};

const receiveUpload = async ({ req, config }) => {
  await mkdir(join(config.dataDir, "tmp"), { recursive: true });
  const tempPath = join(config.dataDir, "tmp", `${randomUUID()}.upload`);
  const output = createWriteStream(tempPath, { flags: "wx" });
  const hash = createHash("sha256");
  let size = 0;

  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > config.maxUploadBytes) {
        throw httpError(413, "upload_too_large");
      }
      hash.update(buffer);
      if (!output.write(buffer)) {
        await once(output, "drain");
      }
    }

    output.end();
    await once(output, "finish");

    return {
      tempPath,
      size,
      sha256: hash.digest("hex"),
    };
  } catch (error) {
    output.destroy();
    await rm(tempPath, { force: true });
    throw error;
  }
};

const isInternalRequest = (req, config) =>
  Boolean(config.internalKey) && safeEqual(getBearerToken(req), config.internalKey);

const requireInternalAuth = (req, config) => {
  if (!isInternalRequest(req, config)) {
    throw httpError(401, "unauthorized");
  }
};

const createAccessToken = ({ config, artifactId, ownerId, expiresInSeconds }) => {
  const nowSeconds = Math.floor(config.now().getTime() / 1000);
  const ttl = Math.min(
    Math.max(1, parsePositiveInt(expiresInSeconds, config.accessTokenTtlSeconds)),
    config.maxAccessTokenTtlSeconds,
  );
  const exp = nowSeconds + ttl;
  const payload = {
    artifact_id: artifactId,
    owner_id: ownerId,
    iat: nowSeconds,
    exp,
  };
  return {
    token: signToken({ payload, secret: config.accessTokenSecret }),
    expiresAt: new Date(exp * 1000).toISOString(),
  };
};

const verifyAccessToken = ({ config, token, artifactId }) => {
  if (!config.accessTokenSecret) throw httpError(401, "artifact_access_not_configured");
  const payload = verifyToken({ token, secret: config.accessTokenSecret });
  const nowSeconds = Math.floor(config.now().getTime() / 1000);
  if (payload.artifact_id !== artifactId || !payload.owner_id || Number(payload.exp) <= nowSeconds) {
    throw httpError(401, "invalid_token");
  }
  return payload;
};

const artifactPayload = (config, metadata) => ({
  id: metadata.id,
  owner_id: metadata.owner_id,
  session_id: metadata.session_id,
  filename: metadata.filename,
  content_type: metadata.content_type,
  size: metadata.size,
  sha256: metadata.sha256,
  created_at: metadata.created_at,
  source: metadata.source,
  workspace_id: metadata.workspace_id ?? null,
  relative_path: metadata.relative_path ?? null,
  category: metadata.category ?? null,
  lifecycle: metadata.lifecycle ?? null,
  updated_at: metadata.updated_at ?? null,
  promoted_at: metadata.promoted_at ?? null,
  content_url: `${config.publicBaseUrl}/v1/artifacts/${metadata.id}/content`,
});

const handleUpload = async ({ req, res, config, corsHeaders }) => {
  requireInternalAuth(req, config);

  const ownerId = String(req.headers["x-nexus-owner-id"] ?? "").trim();
  if (!ownerId) throw httpError(400, "missing_owner_id");

  const filename = sanitizeFileName(req.headers["x-nexus-filename"]);
  const contentType = String(req.headers["x-nexus-content-type"] ?? req.headers["content-type"] ?? "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase() || "application/octet-stream";
  const sessionId = String(req.headers["x-nexus-session-id"] ?? "").trim() || null;
  const source = String(req.headers["x-nexus-source"] ?? "").trim() || "bridge";
  const workspace = parseWorkspaceUploadHeaders(req.headers);

  const upload = await receiveUpload({ req, config });
  await ensureObjectFromTemp({ config, tempPath: upload.tempPath, sha256: upload.sha256 });

  const metadata = {
    id: randomUUID(),
    owner_id: ownerId,
    session_id: sessionId,
    filename,
    content_type: contentType,
    size: upload.size,
    sha256: upload.sha256,
    source,
    ...workspace,
    created_at: config.now().toISOString(),
    updated_at: config.now().toISOString(),
  };
  await saveMetadata(config, metadata);

  jsonResponse(res, 201, artifactPayload(config, metadata), corsHeaders);
};

const handleMetadata = async ({ req, res, config, id, corsHeaders }) => {
  requireInternalAuth(req, config);
  const metadata = await loadMetadata(config, id);
  jsonResponse(res, 200, artifactPayload(config, metadata), corsHeaders);
};

const handleAccessLink = async ({ req, res, config, id, corsHeaders }) => {
  requireInternalAuth(req, config);
  const metadata = await loadMetadata(config, id);
  const body = await readJsonBody(req);
  const ownerId = String(body.owner_id ?? "").trim();
  if (!ownerId) throw httpError(400, "missing_owner_id");
  if (ownerId !== metadata.owner_id) throw httpError(403, "forbidden");

  const { token, expiresAt } = createAccessToken({
    config,
    artifactId: id,
    ownerId,
    expiresInSeconds: body.expires_in_seconds,
  });
  const url = `${config.publicBaseUrl}/v1/artifacts/${id}/content?token=${encodeURIComponent(token)}`;

  jsonResponse(res, 200, { url, expires_at: expiresAt }, corsHeaders);
};

const contentDisposition = (filename) => {
  const asciiName = sanitizeFileName(filename).replace(/[^\x20-\x7E]/g, "_");
  return `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

const parseRangeHeader = (rangeHeader, size) => {
  const value = String(rangeHeader ?? "").trim();
  if (!value) return null;

  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return { invalid: true };

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { invalid: true };

  let start;
  let end;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { invalid: true };
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
};

const handleContent = async ({ req, res, config, id, url, corsHeaders }) => {
  const metadata = await loadMetadata(config, id);

  if (!isInternalRequest(req, config)) {
    const payload = verifyAccessToken({
      config,
      token: url.searchParams.get("token") ?? "",
      artifactId: id,
    });
    if (payload.owner_id !== metadata.owner_id) throw httpError(403, "forbidden");
  }

  const objectPath = objectPathFor(config.dataDir, metadata.sha256);
  const objectStat = await stat(objectPath).catch((error) => {
    if (error?.code === "ENOENT") throw httpError(404, "artifact_bytes_not_found");
    throw error;
  });

  const headers = {
    ...corsHeaders,
    "Content-Type": metadata.content_type || "application/octet-stream",
    "Content-Length": String(objectStat.size),
    "Content-Disposition": contentDisposition(metadata.filename),
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=0, no-store",
  };

  const range = parseRangeHeader(req.headers.range, objectStat.size);
  if (range?.invalid) {
    emptyResponse(res, 416, {
      ...headers,
      "Content-Length": "0",
      "Content-Range": `bytes */${objectStat.size}`,
    });
    return;
  }

  if (range) {
    const partialHeaders = {
      ...headers,
      "Content-Length": String(range.end - range.start + 1),
      "Content-Range": `bytes ${range.start}-${range.end}/${objectStat.size}`,
    };

    if (req.method === "HEAD") {
      emptyResponse(res, 206, partialHeaders);
      return;
    }

    res.writeHead(206, partialHeaders);
    createReadStream(objectPath, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  if (req.method === "HEAD") {
    emptyResponse(res, 200, headers);
    return;
  }

  res.writeHead(200, headers);
  createReadStream(objectPath).pipe(res);
};

const handleDelete = async ({ req, res, config, id, corsHeaders }) => {
  requireInternalAuth(req, config);
  await deleteArtifactMetadataAndBytes({ dataDir: config.dataDir, artifactId: id });
  jsonResponse(res, 200, { ok: true }, corsHeaders);
};

const handleWorkspaceArtifacts = async ({ req, res, config, workspaceId, url, corsHeaders }) => {
  requireInternalAuth(req, config);
  const ownerId = String(url.searchParams.get("owner_id") ?? "").trim();
  if (!ownerId) throw httpError(400, "missing_owner_id");
  if (req.method === "GET") {
    const artifacts = await listWorkspaceArtifacts({
      dataDir: config.dataDir,
      workspaceId,
      ownerId,
    });
    jsonResponse(res, 200, { artifacts: artifacts.map((entry) => artifactPayload(config, entry)) }, corsHeaders);
    return;
  }
  const result = await deleteWorkspaceArtifacts({
    dataDir: config.dataDir,
    workspaceId,
    ownerId,
  });
  jsonResponse(res, 200, result, corsHeaders);
};

const handlePromote = async ({ req, res, config, id, corsHeaders }) => {
  requireInternalAuth(req, config);
  const body = await readJsonBody(req);
  const ownerId = String(body.owner_id ?? "").trim();
  const workspaceId = String(body.workspace_id ?? "").trim();
  if (!ownerId) throw httpError(400, "missing_owner_id");
  const metadata = await promoteWorkspaceArtifact({
    dataDir: config.dataDir,
    artifactId: id,
    ownerId,
    workspaceId,
    now: config.now,
  });
  jsonResponse(res, 200, artifactPayload(config, metadata), corsHeaders);
};

export const createArtifactServer = (options = {}) => {
  const config = {
    dataDir: options.dataDir || process.env.ARTIFACT_DATA_DIR || "/app/data",
    internalKey: options.internalKey ?? process.env.ARTIFACT_INTERNAL_KEY ?? "",
    accessTokenSecret:
      options.accessTokenSecret ?? process.env.ARTIFACT_ACCESS_TOKEN_SECRET ?? process.env.ARTIFACT_INTERNAL_KEY ?? "",
    publicBaseUrl: normalizeBaseUrl(
      options.publicBaseUrl ?? process.env.ARTIFACT_PUBLIC_BASE_URL,
      `http://127.0.0.1:${process.env.ARTIFACT_PORT || 8095}`,
    ),
    allowedOrigins: options.allowedOrigins ?? splitCsv(process.env.ARTIFACT_ALLOWED_ORIGINS || ""),
    maxUploadBytes: parsePositiveInt(options.maxUploadBytes ?? process.env.ARTIFACT_MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES),
    accessTokenTtlSeconds: parsePositiveInt(
      options.accessTokenTtlSeconds ?? process.env.ARTIFACT_ACCESS_TOKEN_TTL_SECONDS,
      DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
    ),
    maxAccessTokenTtlSeconds: parsePositiveInt(
      options.maxAccessTokenTtlSeconds ?? process.env.ARTIFACT_MAX_ACCESS_TOKEN_TTL_SECONDS,
      DEFAULT_MAX_ACCESS_TOKEN_TTL_SECONDS,
    ),
    now: options.now || (() => new Date()),
  };

  return createServer(async (req, res) => {
    const corsHeaders = getCorsHeaders(req, config.allowedOrigins);

    try {
      if (req.method === "OPTIONS") {
        emptyResponse(res, 204, corsHeaders);
        return;
      }

      const url = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = url.pathname.replace(/\/+$/, "") || "/";

      if (req.method === "GET" && pathname === "/health") {
        jsonResponse(res, 200, { ok: true }, corsHeaders);
        return;
      }

      if (req.method === "POST" && pathname === "/v1/artifacts") {
        await handleUpload({ req, res, config, corsHeaders });
        return;
      }

      const workspaceArtifactsMatch = pathname.match(/^\/v1\/workspaces\/([0-9a-f-]{36})\/artifacts$/i);
      if (workspaceArtifactsMatch && (req.method === "GET" || req.method === "DELETE")) {
        await handleWorkspaceArtifacts({
          req,
          res,
          config,
          workspaceId: workspaceArtifactsMatch[1],
          url,
          corsHeaders,
        });
        return;
      }

      const artifactMatch = pathname.match(/^\/v1\/artifacts\/([0-9a-f-]{36})(?:\/(.+))?$/i);
      if (artifactMatch) {
        const id = artifactMatch[1];
        const action = artifactMatch[2] || "";

        if (req.method === "GET" && action === "") {
          await handleMetadata({ req, res, config, id, corsHeaders });
          return;
        }

        if (req.method === "POST" && action === "access-link") {
          await handleAccessLink({ req, res, config, id, corsHeaders });
          return;
        }

        if (req.method === "POST" && action === "promote") {
          await handlePromote({ req, res, config, id, corsHeaders });
          return;
        }

        if ((req.method === "GET" || req.method === "HEAD") && action === "content") {
          await handleContent({ req, res, config, id, url, corsHeaders });
          return;
        }

        if (req.method === "DELETE" && action === "") {
          await handleDelete({ req, res, config, id, corsHeaders });
          return;
        }
      }

      jsonResponse(res, 404, { error: "not_found" }, corsHeaders);
    } catch (error) {
      const status = Number(error?.status) || 500;
      const code = error?.code || (status >= 500 ? "internal_error" : "bad_request");
      if (status >= 500) {
        console.error("[artifact-server] request failed", error);
      }
      jsonResponse(res, status, { error: code }, corsHeaders);
    }
  });
};

const isMain = () => {
  const entry = process.argv[1] ? new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href : "";
  return import.meta.url === entry;
};

if (isMain()) {
  const port = Number(process.env.ARTIFACT_PORT || 8095);
  const server = createArtifactServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`[artifact-server] listening on 0.0.0.0:${port}`);
  });
}
