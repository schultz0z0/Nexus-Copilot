import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("CA-003: no legacy dependencies (Supabase, Neo4j) in active packages", () => {
  const packagePaths = [
    "apps/chat-web/package.json",
    "services/app-api/package.json",
    "services/chat-bridge/package.json",
    "services/marketing-ops/package.json",
    "services/artifact-server/package.json",
  ];

  for (const pkgPath of packagePaths) {
    const fullPath = path.resolve(pkgPath);
    if (!existsSync(fullPath)) continue;
    const content = JSON.parse(readFileSync(fullPath, "utf8"));
    const allDeps = {
      ...content.dependencies,
      ...content.devDependencies,
    };

    assert.equal(
      allDeps["@supabase/supabase-js"],
      undefined,
      `${pkgPath} must not depend on @supabase/supabase-js`
    );
    assert.equal(
      allDeps["neo4j-driver"],
      undefined,
      `${pkgPath} must not depend on neo4j-driver`
    );
  }
});

test("CA-003: no legacy imports in frontend and services source code", () => {
  const sourceRoots = [
    "apps/chat-web/src",
    "services/app-api/src",
    "services/chat-bridge/src",
    "services/marketing-ops/src",
    "services/artifact-server/src",
  ];

  const scanDir = (dir) => {
    const files = [];
    if (!existsSync(dir)) return files;
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        files.push(...scanDir(full));
      } else if (/\.(js|jsx|ts|tsx|mjs)$/.test(entry) && !entry.includes(".test.")) {
        files.push(full);
      }
    }
    return files;
  };

  for (const root of sourceRoots) {
    const files = scanDir(path.resolve(root));
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      assert.doesNotMatch(
        code,
        /from\s+['"]@supabase\//,
        `${file} must not import @supabase packages`
      );
      assert.doesNotMatch(
        code,
        /from\s+['"]neo4j-driver['"]/,
        `${file} must not import neo4j-driver`
      );
      assert.doesNotMatch(
        code,
        /require\(['"]@supabase\//,
        `${file} must not require @supabase packages`
      );
    }
  }
});

test("CA-005 & ADR-0005: Hermes dashboard decision is documented", () => {
  const adrPath = path.resolve("docs/decisions/ADR-0005-hermes-dashboard-exposure.md");
  assert.ok(existsSync(adrPath), "ADR-0005 must exist");
  const content = readFileSync(adrPath, "utf8");
  assert.match(content, /hermes\.solucoes-nexus\.tech/, "ADR-0005 must document host");
  assert.match(content, /Basic Auth/i, "ADR-0005 must document Basic Auth protection");
  assert.match(content, /8642/, "ADR-0005 must state API :8642 remains private");
});

test("SLOs & Retention: documents RPO <= 1h and RTO <= 2h", () => {
  const sloPath = path.resolve("docs/operations/slos-and-retention.md");
  assert.ok(existsSync(sloPath), "SLOs document must exist");
  const content = readFileSync(sloPath, "utf8");
  assert.match(content, /RPO.*1\s*h/i, "Must define RPO of 1 hour");
  assert.match(content, /RTO.*2\s*h/i, "Must define RTO of 2 hours");
});

test("Recovery Drill: runbook exists and details recovery execution", () => {
  const drillPath = path.resolve("docs/operations/m7-recovery-drill-runbook.md");
  assert.ok(existsSync(drillPath), "Recovery drill runbook must exist");
  const content = readFileSync(drillPath, "utf8");
  assert.match(content, /postgres-restore-drill/, "Must document postgres-restore-drill service");
  assert.match(content, /validate-restore\.sql/, "Must document validation SQL");
});

test("CA-008 & Retire Legacy: retirement script exists and creates safety backup", () => {
  const scriptPath = path.resolve("scripts/retire-legacy.sh");
  assert.ok(existsSync(scriptPath), "retire-legacy.sh must exist");
  const content = readFileSync(scriptPath, "utf8");
  assert.match(content, /\.bak\./, "Script must create a backup before modifying env");
  assert.match(content, /SUPABASE_/, "Script must clean SUPABASE variables");
  assert.match(content, /NEO4J_/, "Script must clean NEO4J variables");
});
