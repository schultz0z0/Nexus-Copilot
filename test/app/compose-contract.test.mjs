import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("compose.yaml defines all 5 core application services", () => {
  const composePath = path.resolve("infra/app/compose.yaml");
  const content = readFileSync(composePath, "utf8");

  // Check required services
  assert.match(content, /artifact-server:/, "artifact-server must be defined");
  assert.match(content, /chat-bridge:/, "chat-bridge must be defined");
  assert.match(content, /app-api:/, "app-api must be defined");
  assert.match(content, /chat-web:/, "chat-web must be defined");
  assert.match(content, /marketing-ops:/, "marketing-ops must be defined");

  // Check no Supabase service
  assert.doesNotMatch(content, /supabase/, "compose must not define Supabase");

  // Check healthchecks
  assert.match(content, /healthcheck:/, "healthcheck must be configured");

  // Check network isolation
  assert.match(content, /app-internal:/, "app-internal network must be defined");
  assert.match(content, /postgres-data:/, "postgres-data network must be defined");
});

test("compose.development.yaml defines local port mappings", () => {
  const devComposePath = path.resolve("infra/app/compose.development.yaml");
  const content = readFileSync(devComposePath, "utf8");

  assert.match(content, /8095\}:8095/, "artifact-server port 8095 must be mapped");
  assert.match(content, /808[02]\}:8080/, "chat-bridge port 8080/8082 must be mapped");
  assert.match(content, /3000\}:3000/, "app-api port 3000 must be mapped");
  assert.match(content, /8088\}:8080/, "chat-web port 8088 must be mapped");
});

test("compose.production.yaml configures Traefik labels and external networks", () => {
  const prodComposePath = path.resolve("infra/app/compose.production.yaml");
  const content = readFileSync(prodComposePath, "utf8");

  assert.match(content, /traefik\.enable:\s*"true"/, "Traefik must be enabled");
  assert.match(content, /app\.solucoes-nexus\.tech/, "Production host must be app.solucoes-nexus.tech");
  assert.match(content, /external:\s*true/, "Production networks/volumes must be external");
});

test("marketing-ops optional RAG probe times out before Docker readiness", () => {
  const composePath = path.resolve("infra/app/compose.yaml");
  const content = readFileSync(composePath, "utf8");
  const ragTimeout = content.match(
    /MARKETING_OPS_RAG_TIMEOUT_MS:\s*\$\{MARKETING_OPS_RAG_TIMEOUT_MS:-(\d+)\}/,
  );
  const healthcheckTimeout = content.match(
    /marketing-ops:[\s\S]*?healthcheck:[\s\S]*?timeout:\s*(\d+)s/,
  );

  assert.ok(ragTimeout, "marketing-ops must configure the optional RAG timeout");
  assert.ok(healthcheckTimeout, "marketing-ops healthcheck timeout must be configured");
  assert.ok(
    Number(ragTimeout[1]) < Number(healthcheckTimeout[1]) * 1_000,
    "optional RAG timeout must leave time for /ready to return degraded readiness",
  );
});

test("marketing-ops resolves opaque delegation references only through the private bridge", () => {
  const composePath = path.resolve("infra/app/compose.yaml");
  const content = readFileSync(composePath, "utf8");

  assert.match(
    content,
    /MARKETING_OPS_DELEGATION_RESOLVE_URL:\s*http:\/\/chat-bridge:8080\/internal\/marketing-ops\/delegations\/resolve/,
    "marketing-ops must resolve opaque references through the private chat bridge route",
  );
  assert.match(
    content,
    /MARKETING_OPS_INTERNAL_KEY:\s*\$\{MARKETING_OPS_DELEGATION_REFRESH_KEY:-\}/,
    "delegation resolution must reuse the authenticated internal bridge key",
  );
});

test("structured plan execution is wired behind explicit backend and frontend flags", () => {
  const baseCompose = readFileSync(path.resolve("infra/app/compose.yaml"), "utf8");
  const developmentCompose = readFileSync(
    path.resolve("infra/app/compose.development.yaml"),
    "utf8",
  );
  const productionCompose = readFileSync(
    path.resolve("infra/app/compose.production.yaml"),
    "utf8",
  );
  const dockerfile = readFileSync(path.resolve("apps/chat-web/Dockerfile"), "utf8");
  const envExample = readFileSync(path.resolve(".env.example"), "utf8");

  assert.match(
    baseCompose,
    /MARKETING_OPS_STRUCTURED_PLAN_EXECUTION:\s*\$\{MARKETING_OPS_STRUCTURED_PLAN_EXECUTION:-false\}/,
    "backend structured execution must default to false",
  );
  assert.match(
    baseCompose,
    /VITE_MARKETING_OPS_STRUCTURED_PLAN_EXECUTION:\s*\$\{MARKETING_OPS_FRONTEND_STRUCTURED_PLAN_EXECUTION:-false\}/,
    "frontend structured execution build arg must default to false",
  );
  assert.match(
    developmentCompose,
    /MARKETING_OPS_STRUCTURED_PLAN_EXECUTION:\s*"true"/,
    "the local parity override must enable the backend gate explicitly",
  );
  assert.match(
    developmentCompose,
    /VITE_MARKETING_OPS_STRUCTURED_PLAN_EXECUTION:\s*"true"/,
    "the local parity override must enable the frontend gate explicitly",
  );
  assert.match(dockerfile, /ARG VITE_MARKETING_OPS_STRUCTURED_PLAN_EXECUTION="false"/);
  assert.match(
    dockerfile,
    /VITE_MARKETING_OPS_STRUCTURED_PLAN_EXECUTION=\$VITE_MARKETING_OPS_STRUCTURED_PLAN_EXECUTION/,
  );
  assert.match(envExample, /^NEXUS_MARKETING_OPS_STRUCTURED_PLAN_EXECUTION=false$/m);
  assert.match(envExample, /^NEXUS_MARKETING_OPS_FRONTEND_STRUCTURED_PLAN_EXECUTION=false$/m);
  assert.doesNotMatch(
    productionCompose,
    /MARKETING_OPS_(?:FRONTEND_)?STRUCTURED_PLAN_EXECUTION:\s*"true"/,
    "production must not force either structured execution gate on",
  );
});

test("chat-web nginx.conf proxies /api/ to app-api with SSE buffering disabled", () => {
  const nginxPath = path.resolve("apps/chat-web/nginx.conf");
  const content = readFileSync(nginxPath, "utf8");

  assert.match(content, /location \/api\/ \{/, "location /api/ must be configured");
  assert.match(content, /proxy_pass (http:\/\/app-api:3000|\$app_api_upstream);/, "must proxy to app-api:3000");
  assert.match(content, /proxy_buffering off;/, "proxy_buffering off required for SSE");
});

test("services/app-api has Dockerfile and .dockerignore", () => {
  const dockerfilePath = path.resolve("services/app-api/Dockerfile");
  const content = readFileSync(dockerfilePath, "utf8");

  assert.match(content, /FROM node:20-alpine/, "must use node:20-alpine");
  assert.match(content, /EXPOSE 3000/, "must expose port 3000");
  assert.match(content, /CMD \["node", "src\/server\.js"\]/, "must run src/server.js");
});
