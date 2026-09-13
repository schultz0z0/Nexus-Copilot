import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("compose.yaml defines all 4 core application services", () => {
  const composePath = path.resolve("infra/app/compose.yaml");
  const content = readFileSync(composePath, "utf8");

  // Check required services
  assert.match(content, /artifact-server:/, "artifact-server must be defined");
  assert.match(content, /chat-bridge:/, "chat-bridge must be defined");
  assert.match(content, /app-api:/, "app-api must be defined");
  assert.match(content, /chat-web:/, "chat-web must be defined");

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
  assert.match(content, /8080\}:8080/, "chat-bridge port 8080 must be mapped");
  assert.match(content, /3000\}:3000/, "app-api port 3000 must be mapped");
  assert.match(content, /8088\}:8080/, "chat-web port 8088 must be mapped");
});

test("compose.production.yaml configures Traefik labels and external networks", () => {
  const prodComposePath = path.resolve("infra/app/compose.production.yaml");
  const content = readFileSync(prodComposePath, "utf8");

  assert.match(content, /traefik\.enable:\s*"true"/, "Traefik must be enabled");
  assert.match(content, /app\.solucoes-nexus\.tech/, "Production host must be app.solucoes-nexus.tech");
  assert.match(content, /traefik-public/, "Traefik public network must be used");
  assert.match(content, /external:\s*true/, "Production networks/volumes must be external");
});

test("chat-web nginx.conf proxies /api/ to app-api with SSE buffering disabled", () => {
  const nginxPath = path.resolve("apps/chat-web/nginx.conf");
  const content = readFileSync(nginxPath, "utf8");

  assert.match(content, /location \/api\/ \{/, "location /api/ must be configured");
  assert.match(content, /proxy_pass http:\/\/app-api:3000;/, "must proxy to app-api:3000");
  assert.match(content, /proxy_buffering off;/, "proxy_buffering off required for SSE");
});

test("services/app-api has Dockerfile and .dockerignore", () => {
  const dockerfilePath = path.resolve("services/app-api/Dockerfile");
  const content = readFileSync(dockerfilePath, "utf8");

  assert.match(content, /FROM node:20-alpine/, "must use node:20-alpine");
  assert.match(content, /EXPOSE 3000/, "must expose port 3000");
  assert.match(content, /CMD \["node", "src\/server\.js"\]/, "must run src/server.js");
});
