# ENS Application Stack (`infra/app`)

Esta pasta contém o Docker Compose unificado da stack de aplicação do monorepo ENS (Marco M5).

## Serviços Integrados

| Serviço | Diretório | Porta Interna | Descrição |
| --- | --- | --- | --- |
| **chat-web** | `apps/chat-web` | `8080` | Frontend React + Vite servido via Nginx com proxy reverso `/api/` |
| **app-api** | `services/app-api` | `3000` | BFF Fastify 5 (autenticação PostgreSQL, chat, upload via Artifact Server) |
| **chat-bridge** | `services/chat-bridge` | `8080` | Bridge interna para Hermes Agent (Runs, SSE, saídas) |
| **artifact-server** | `services/artifact-server` | `8095` | Content-Addressable Storage (CAS) com tokens HMAC de acesso |

---

## Arquitetura de Rede

```
Browser (HTTPS)
   │
   ▼ [app.solucoes-nexus.tech:8080 via Traefik]
┌─────────────────────────────────────────────────────────────────┐
│ chat-web (Nginx)                                                │
│ ├─ /              → Arquivos estáticos compilados (React/Vite)  │
│ └─ /api/*         → Proxy reverso para http://app-api:3000      │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼ (app-internal)
┌─────────────────────────────────────────────────────────────────┐
│ app-api (Fastify 5 BFF)                                         │
│ ├─ /api/auth/*        → Autenticação via PostgreSQL nativo       │
│ ├─ /api/chat/*        → Proxy para Chat Bridge                  │
│ ├─ /api/attachments   → Upload/download via Artifact Server      │
│ └─ /api/users/me/*    → Gerenciamento de perfil e avatar         │
└──────┬─────────────────┬───────────────────────┬────────────────┘
       │                 │                       │
       ▼ (postgres-data) ▼ (app-internal)        ▼ (app-internal)
  PostgreSQL        Chat Bridge             Artifact Server
  (iam, chat)       (Runs, SSE)             (CAS, HMAC tokens)
                         │
                         ▼ (hermes-net)
                    Hermes Agent
```

---

## Variáveis de Ambiente Necessárias

Exemplo de arquivo `.env` para desenvolvimento ou `/etc/ens/app.env` para produção:

```env
# Ambiente
NODE_ENV=production

# Chaves Secretas (gerar com: openssl rand -hex 32)
ARTIFACT_INTERNAL_KEY=sua-chave-interna-do-artifact-server-minimo-32-chars
ARTIFACT_ACCESS_TOKEN_SECRET=seu-segredo-de-tokens-de-acesso-artifact
APP_COOKIE_SECRET=seu-cookie-secret-de-sessao-com-minimo-32-chars

# PostgreSQL
PGHOST=postgres
PGPORT=5432
PGDATABASE=nexus
PGUSER=nexus_app
PGPASSWORD_FILE=/run/secrets/postgres_app_password

# Hermes Agent
HERMES_API_BASE_URL=http://hermes:8642
HERMES_API_KEY=sua-api-key-do-hermes

# Domínio público (produção)
NEXUS_PUBLIC_APP_HOST=app.solucoes-nexus.tech
CORS_ORIGIN=https://app.solucoes-nexus.tech
```

---

## Como Operar

### 1. Desenvolvimento Local (Docker Desktop)

```bash
# Validar arquivo compose composto
docker compose -f infra/app/compose.yaml -f infra/app/compose.development.yaml config

# Subir stack
docker compose --env-file .env -f infra/app/compose.yaml -f infra/app/compose.development.yaml up -d --build

# Verificar logs
docker compose -f infra/app/compose.yaml logs -f

# Parar stack
docker compose -f infra/app/compose.yaml -f infra/app/compose.development.yaml down
```

Portas expostas em desenvolvimento:
- **Chat Web**: `http://localhost:8088`
- **App API**: `http://localhost:3000`
- **Chat Bridge**: `http://localhost:8080`
- **Artifact Server**: `http://localhost:8095`

### 2. Validação e Smoke Test

```bash
# Executar smoke test automatizado
node scripts/smoke-app-stack.mjs
```

### 3. Produção (VPS via Copiloto)

> [!IMPORTANT]
> A operação na VPS segue o protocolo do `AGENTS.md`: o agente prepara os comandos com impacto, resultado esperado, parada e rollback, e o operador humano os executa.

```bash
# Subir stack em produção conectado à rede Traefik e volumes externos
docker compose \
  --env-file /etc/ens/app.env \
  -f infra/app/compose.yaml \
  -f infra/app/compose.production.yaml \
  up -d --build
```
