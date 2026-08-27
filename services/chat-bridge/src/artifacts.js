import { constants, createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const ARTIFACT_STORAGE_BUCKET = "nexus-artifacts";
const DEFAULT_ACCESS_LINK_TTL_SECONDS = 15 * 60;

const MIME_BY_EXTENSION = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["svg", "image/svg+xml"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["mov", "video/quicktime"],
  ["pdf", "application/pdf"],
  ["zip", "application/zip"],
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["csv", "text/csv"],
  ["json", "application/json"],
  ["html", "text/html"],
  ["doc", "application/msword"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xls", "application/vnd.ms-excel"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["ppt", "application/vnd.ms-powerpoint"],
  ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
]);

const normalizeBaseUrl = (value) => String(value ?? "").trim().replace(/\/+$/, "");

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value ?? ""));

const getExtension = (value) => {
  const match = String(value ?? "").match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
  return match?.[1]?.toLowerCase() ?? "";
};

const guessMimeType = (file) => {
  const explicit = String(file.mimeType ?? file.mime_type ?? "").trim().toLowerCase();
  if (explicit) return explicit;
  return MIME_BY_EXTENSION.get(getExtension(file.name || file.url)) || "application/octet-stream";
};

const guessFileName = (file) => {
  const explicit = String(file.name ?? file.filename ?? file.file_name ?? "").trim();
  if (explicit) return explicit;
  if (isHttpUrl(file.url)) {
    try {
      const parsed = new URL(file.url);
      return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "artifact.bin");
    } catch {
      return "artifact.bin";
    }
  }
  const baseName = path.basename(String(file.url ?? "").replace(/\\/g, "/"));
  return baseName || "artifact.bin";
};

const normalizeRoot = (value) => String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");

const asNonEmptyString = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");

export const collectArtifactUrlReplacements = (sourceFiles = [], importedFiles = []) => {
  const replacements = [];
  const seen = new Set();
  const maxLength = Math.max(sourceFiles.length, importedFiles.length);

  for (let index = 0; index < maxLength; index += 1) {
    const sourceFile = sourceFiles[index] ?? {};
    const importedFile = importedFiles[index] ?? {};
    const targetUrl = asNonEmptyString(importedFile.url);
    if (!targetUrl) continue;

    [
      sourceFile.url,
      sourceFile.original_url,
      importedFile.original_url,
      importedFile.source_url,
    ].forEach((candidate) => {
      const fromUrl = asNonEmptyString(candidate);
      if (!fromUrl || fromUrl === targetUrl) return;
      const key = `${fromUrl}\n${targetUrl}`;
      if (seen.has(key)) return;
      seen.add(key);
      replacements.push({ from: fromUrl, to: targetUrl });
    });
  }

  return replacements;
};

export const replaceArtifactUrls = (text, replacements = []) => {
  if (typeof text !== "string" || replacements.length === 0) return text;
  return replacements
    .filter((replacement) => asNonEmptyString(replacement?.from) && asNonEmptyString(replacement?.to))
    .sort((a, b) => b.from.length - a.from.length)
    .reduce((nextText, replacement) => nextText.split(replacement.from).join(replacement.to), text);
};

export const toBridgeArtifactPath = ({ hermesPath, hermesRoot, bridgeRoot }) => {
  const normalizedHermesPath = String(hermesPath ?? "").replace(/\\/g, "/");
  const normalizedHermesRoot = normalizeRoot(hermesRoot);
  if (!normalizedHermesPath || !normalizedHermesRoot || !bridgeRoot) return null;

  if (
    normalizedHermesPath !== normalizedHermesRoot &&
    !normalizedHermesPath.startsWith(`${normalizedHermesRoot}/`)
  ) {
    return null;
  }

  const relative = normalizedHermesPath.slice(normalizedHermesRoot.length).replace(/^\/+/, "");
  if (!relative || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  return path.join(bridgeRoot, ...relative.split("/"));
};

const assertAllowedLocalPath = async ({ localPath, allowedLocalRoots }) => {
  const roots = (allowedLocalRoots ?? []).map((root) => String(root ?? "").trim()).filter(Boolean);
  if (roots.length === 0) throw new Error("artifact_local_path_not_allowed");

  const resolvedPath = await realpath(localPath);
  const allowed = await Promise.all(roots.map(async (root) => {
    const resolvedRoot = await realpath(root).catch(() => path.resolve(root));
    const relative = path.relative(resolvedRoot, resolvedPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }));

  if (!allowed.some(Boolean)) {
    throw new Error("artifact_local_path_not_allowed");
  }

  return resolvedPath;
};

const uploadToArtifactServer = async ({
  artifactBaseUrl,
  artifactInternalKey,
  ownerId,
  sessionId,
  fileName,
  mimeType,
  body,
  fetchImpl,
}) => {
  const response = await fetchImpl(`${normalizeBaseUrl(artifactBaseUrl)}/v1/artifacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${artifactInternalKey}`,
      "Content-Type": mimeType,
      "X-Nexus-Owner-Id": ownerId,
      "X-Nexus-Session-Id": sessionId,
      "X-Nexus-Filename": fileName,
      "X-Nexus-Content-Type": mimeType,
      "X-Nexus-Source": "hermes",
    },
    body,
    duplex: "half",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || `artifact_upload_failed:${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (!payload?.id) throw new Error("artifact_upload_missing_id");
  return payload;
};

export const createArtifactAccessLink = async ({
  artifactBaseUrl,
  artifactInternalKey,
  artifactId,
  ownerId,
  expiresInSeconds = DEFAULT_ACCESS_LINK_TTL_SECONDS,
  fetchImpl = fetch,
}) => {
  const response = await fetchImpl(`${normalizeBaseUrl(artifactBaseUrl)}/v1/artifacts/${encodeURIComponent(artifactId)}/access-link`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${artifactInternalKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      owner_id: ownerId,
      expires_in_seconds: expiresInSeconds,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.message || `artifact_access_link_failed:${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (!payload?.url) throw new Error("artifact_access_link_missing_url");
  return payload;
};

const resolveLocalArtifactSource = async ({ file, allowedLocalRoots, accessImpl = access }) => {
  const localPath = await assertAllowedLocalPath({
    localPath: String(file.url ?? ""),
    allowedLocalRoots,
  });
  const fileStat = await stat(localPath);
  if (!fileStat.isFile()) throw new Error("artifact_local_path_not_file");
  await accessImpl(localPath, constants.R_OK);
  const body = createReadStream(localPath);
  body.on("error", () => {});
  return {
    body,
    mimeType: guessMimeType(file),
  };
};

const resolveRemoteArtifactSource = async ({ file, fetchImpl }) => {
  const response = await fetchImpl(file.url);
  if (!response.ok || !response.body) {
    throw new Error(`artifact_remote_fetch_failed:${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return {
    body: response.body,
    mimeType: String(file.mimeType ?? file.mime_type ?? contentType ?? guessMimeType(file)).trim().toLowerCase(),
  };
};

export const importHermesFileToArtifact = async ({
  file,
  ownerId,
  sessionId,
  artifactBaseUrl,
  artifactInternalKey,
  allowedLocalRoots = [],
  accessImpl = access,
  fetchImpl = fetch,
  accessLinkTtlSeconds = DEFAULT_ACCESS_LINK_TTL_SECONDS,
}) => {
  if (!artifactBaseUrl || !artifactInternalKey) return file;
  const fileName = guessFileName(file);
  const source = isHttpUrl(file.url)
    ? await resolveRemoteArtifactSource({ file, fetchImpl })
    : await resolveLocalArtifactSource({ file, allowedLocalRoots, accessImpl });

  const artifact = await uploadToArtifactServer({
    artifactBaseUrl,
    artifactInternalKey,
    ownerId,
    sessionId,
    fileName,
    mimeType: source.mimeType,
    body: source.body,
    fetchImpl,
  });
  const access = await createArtifactAccessLink({
    artifactBaseUrl,
    artifactInternalKey,
    artifactId: artifact.id,
    ownerId,
    expiresInSeconds: accessLinkTtlSeconds,
    fetchImpl,
  });

  return {
    ...file,
    name: artifact.filename || fileName,
    url: access.url,
    mimeType: artifact.content_type || source.mimeType,
    storage_bucket: ARTIFACT_STORAGE_BUCKET,
    storage_path: artifact.id,
    artifact_id: artifact.id,
    artifact_size: artifact.size,
    artifact_sha256: artifact.sha256,
    signed_url_expires_at: access.expires_at,
  };
};

export const importHermesFilesToArtifacts = async ({
  files,
  ownerId,
  sessionId,
  artifactBaseUrl,
  artifactInternalKey,
  allowedLocalRoots = [],
  accessImpl = access,
  fetchImpl = fetch,
  accessLinkTtlSeconds = DEFAULT_ACCESS_LINK_TTL_SECONDS,
  logger = console,
}) => {
  if (!Array.isArray(files) || files.length === 0 || !artifactBaseUrl || !artifactInternalKey) {
    return files;
  }

  return await Promise.all(files.map(async (file) => {
    if (file?.artifact_id) return file;
    try {
      return await importHermesFileToArtifact({
        file,
        ownerId,
        sessionId,
        artifactBaseUrl,
        artifactInternalKey,
        allowedLocalRoots,
        accessImpl,
        fetchImpl,
        accessLinkTtlSeconds,
      });
    } catch (error) {
      logger.warn?.("[chat-bridge] could not import Hermes file to artifact server", {
        file: file?.name || file?.url,
        error: error instanceof Error ? error.message : String(error),
      });
      return file?.original_url ? { ...file, url: file.original_url } : file;
    }
  }));
};
