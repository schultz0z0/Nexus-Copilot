import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:[/\\]/;
const CATEGORIES = new Set(["brief", "reference", "planning", "intermediate", "final"]);
const LIFECYCLES = new Set(["workspace", "validated"]);
const workspaceLocks = new Map();

const artifactError = (status, code) => Object.assign(new Error(code), { status, code });
const metadataPathFor = (dataDir, id) => join(dataDir, "metadata", `${id}.json`);
const objectPathFor = (dataDir, sha256) => join(dataDir, "objects", sha256.slice(0, 2), sha256);

const assertUuid = (value, code = "invalid_workspace_id") => {
  if (!UUID_PATTERN.test(String(value ?? ""))) throw artifactError(400, code);
  return String(value);
};

export const normalizeRelativePath = (value) => {
  const candidate = String(value ?? "").trim();
  if (
    !candidate ||
    candidate.includes("\0") ||
    candidate.includes("\\") ||
    candidate.startsWith("/") ||
    WINDOWS_DRIVE_PATTERN.test(candidate)
  ) {
    throw artifactError(400, "invalid_relative_path");
  }
  const segments = candidate.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw artifactError(400, "invalid_relative_path");
  }
  return candidate;
};

export const parseWorkspaceUploadHeaders = (headers) => {
  const raw = {
    workspace_id: String(headers["x-nexus-workspace-id"] ?? "").trim(),
    relative_path: String(headers["x-nexus-relative-path"] ?? "").trim(),
    category: String(headers["x-nexus-artifact-category"] ?? "").trim(),
    lifecycle: String(headers["x-nexus-artifact-lifecycle"] ?? "").trim(),
  };
  const provided = Object.values(raw).filter(Boolean).length;
  if (provided === 0) {
    return {
      workspace_id: null,
      relative_path: null,
      category: null,
      lifecycle: null,
    };
  }
  if (provided !== 4) throw artifactError(400, "incomplete_workspace_metadata");

  assertUuid(raw.workspace_id);
  const relativePath = normalizeRelativePath(raw.relative_path);
  if (!CATEGORIES.has(raw.category)) throw artifactError(400, "invalid_artifact_category");
  if (!LIFECYCLES.has(raw.lifecycle)) throw artifactError(400, "invalid_artifact_lifecycle");
  if (raw.lifecycle === "validated" && raw.category !== "final") {
    throw artifactError(400, "validated_artifact_must_be_final");
  }
  return {
    workspace_id: raw.workspace_id,
    relative_path: relativePath,
    category: raw.category,
    lifecycle: raw.lifecycle,
  };
};

export const loadArtifactMetadata = async (dataDir, id) => {
  if (!UUID_PATTERN.test(String(id ?? ""))) throw artifactError(404, "artifact_not_found");
  const raw = await readFile(metadataPathFor(dataDir, id), "utf8").catch((error) => {
    if (error?.code === "ENOENT") throw artifactError(404, "artifact_not_found");
    throw error;
  });
  return JSON.parse(raw);
};

export const saveArtifactMetadata = async (dataDir, metadata) => {
  const metadataDir = join(dataDir, "metadata");
  await mkdir(metadataDir, { recursive: true });
  const target = metadataPathFor(dataDir, metadata.id);
  const temporary = join(metadataDir, `.${metadata.id}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
  await rm(target, { force: true });
  await rename(temporary, target);
};

const readAllMetadata = async (dataDir) => {
  const metadataDir = join(dataDir, "metadata");
  const files = await readdir(metadataDir).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const entries = await Promise.all(files
    .filter((file) => file.endsWith(".json"))
    .map(async (file) => {
      const raw = await readFile(join(metadataDir, file), "utf8").catch(() => "");
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }));
  return entries.filter(Boolean);
};

export const listWorkspaceArtifacts = async ({ dataDir, workspaceId, ownerId }) => {
  assertUuid(workspaceId);
  if (!ownerId) throw artifactError(400, "missing_owner_id");
  const entries = await readAllMetadata(dataDir);
  return entries
    .filter((entry) => entry.workspace_id === workspaceId && entry.owner_id === ownerId)
    .sort((left, right) =>
      String(left.category).localeCompare(String(right.category)) ||
      String(left.relative_path).localeCompare(String(right.relative_path)) ||
      String(left.created_at).localeCompare(String(right.created_at))
    );
};

const withWorkspaceLock = async (workspaceId, operation) => {
  const previous = workspaceLocks.get(workspaceId) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const scheduled = previous.then(() => current);
  workspaceLocks.set(workspaceId, scheduled);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (workspaceLocks.get(workspaceId) === scheduled) workspaceLocks.delete(workspaceId);
  }
};

export const promoteWorkspaceArtifact = async ({ dataDir, artifactId, ownerId, workspaceId, now }) =>
  withWorkspaceLock(workspaceId, async () => {
    assertUuid(workspaceId);
    const metadata = await loadArtifactMetadata(dataDir, artifactId);
    if (metadata.owner_id !== ownerId || metadata.workspace_id !== workspaceId) {
      throw artifactError(403, "forbidden");
    }
    if (metadata.category !== "final") throw artifactError(409, "artifact_not_final");
    if (metadata.lifecycle === "validated") return metadata;
    if (metadata.lifecycle !== "workspace") throw artifactError(409, "artifact_not_promotable");

    const promoted = {
      ...metadata,
      lifecycle: "validated",
      updated_at: now().toISOString(),
      promoted_at: now().toISOString(),
    };
    await saveArtifactMetadata(dataDir, promoted);
    return promoted;
  });

const removeObjectWhenUnreferenced = async (dataDir, sha256) => {
  const references = (await readAllMetadata(dataDir)).some((metadata) => metadata.sha256 === sha256);
  if (!references) await rm(objectPathFor(dataDir, sha256), { force: true });
};

export const deleteWorkspaceArtifacts = async ({ dataDir, workspaceId, ownerId }) =>
  withWorkspaceLock(workspaceId, async () => {
    const entries = await listWorkspaceArtifacts({ dataDir, workspaceId, ownerId });
    const temporary = entries.filter((entry) => entry.lifecycle === "workspace");
    for (const entry of temporary) {
      await rm(metadataPathFor(dataDir, entry.id), { force: true });
    }
    for (const sha256 of new Set(temporary.map((entry) => entry.sha256))) {
      await removeObjectWhenUnreferenced(dataDir, sha256);
    }
    return { deleted_count: temporary.length };
  });

export const deleteArtifactMetadataAndBytes = async ({ dataDir, artifactId }) => {
  const metadata = await loadArtifactMetadata(dataDir, artifactId);
  await rm(metadataPathFor(dataDir, artifactId), { force: true });
  await removeObjectWhenUnreferenced(dataDir, metadata.sha256);
  return metadata;
};

export const artifactBytesExist = async (dataDir, sha256) =>
  Boolean(await stat(objectPathFor(dataDir, sha256)).catch(() => null));
