import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { copiedFileContentsAreEquivalent } from "./lib/copied-file-content.mjs";

const destinationRoot = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.resolve(
  process.env.ENS_SOURCE_REPOSITORY ??
    "C:/Users/raphaeloliveira/Desktop/Projetos Saas/projeto-ens-unificado",
);

const copiedRoots = [
  "apps/chat-web",
  "services/marketing-ops",
  "services/chat-bridge",
  "services/artifact-server",
];

const forbiddenPaths = [
  "apps/chat-web/supabase",
  "services/graph-mcp",
  "services/hermes-runtime/vendor/hermes-agent",
  "services/rag-mcp",
  "services/picture-it",
];

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const copiedFiles = git(destinationRoot, [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "--",
  ...copiedRoots,
])
  .split(/\r?\n/u)
  .filter(Boolean);

const mismatches = [];
for (const relativePath of copiedFiles) {
  const sourcePath = path.join(sourceRoot, relativePath);
  const destinationPath = path.join(destinationRoot, relativePath);

  if (!existsSync(sourcePath) || !lstatSync(sourcePath).isFile()) {
    mismatches.push(`${relativePath}: missing source`);
    continue;
  }

  const sourceContents = readFileSync(sourcePath);
  const destinationContents = readFileSync(destinationPath);
  if (!copiedFileContentsAreEquivalent(sourceContents, destinationContents)) {
    mismatches.push(`${relativePath}: content differs`);
  }
}

const presentForbiddenPaths = forbiddenPaths.filter((relativePath) =>
  existsSync(path.join(destinationRoot, relativePath)),
);

if (copiedFiles.length !== 397) {
  throw new Error(`Expected 397 copied component files, found ${copiedFiles.length}.`);
}

if (mismatches.length > 0) {
  throw new Error(`Copied file mismatches:\n${mismatches.join("\n")}`);
}

if (presentForbiddenPaths.length > 0) {
  throw new Error(`Forbidden paths present:\n${presentForbiddenPaths.join("\n")}`);
}

console.log(`INITIAL_CUT_OK files=${copiedFiles.length} mismatches=0 forbidden=0`);
