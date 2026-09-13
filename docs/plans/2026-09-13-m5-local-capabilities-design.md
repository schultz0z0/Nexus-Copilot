# M5 — Capacidades Locais Substitutas: Desenho e Plano de Implementação

> **Para Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Substituir todas as dependências restantes do Supabase (Storage, Auth, Data API) por capacidades operadas pelo monorepo ENS, habilitando o deploy do frontend e do backend como stack unificada na VPS.

**Architecture:** A App API/BFF (`services/app-api`) passa a ser a porta única para o navegador — incluindo upload de arquivos, que é delegado internamente ao Artifact Server existente. O Chat Bridge perde toda dependência do Supabase e se comunica exclusivamente com o Artifact Server para storage e com a App API para identidade. O frontend remove o stub `supabase.ts` e todas as chamadas que o utilizam.

**Tech Stack:** Node.js 20+, Fastify 5, Docker Compose, Nginx, Traefik, Artifact Server CAS nativo, PostgreSQL 18.6.

**Data:** 2026-09-13  
**Estado:** Implementado & Validado (100% dos testes passando)  
**Marco:** M5 (14% do programa)  
**Referências:** [ADR-0003](../decisions/ADR-0003-auth-sessions-and-app-api.md), [Inventário Supabase](../migration/supabase-capability-inventory.md), [Plano M4](2026-09-11-m4-auth-bff-architecture-design.md)

---

## 1. Diagnóstico: O que Ainda Depende do Supabase

### 1.1 Frontend (`apps/chat-web`)

| Arquivo | Dependência Supabase | Tipo | Impacto |
| --- | --- | --- | --- |
| `lib/supabase.ts` | Stub mock de compatibilidade | Ponto central | Toda chamada retorna dados vazios; upload falha |
| `lib/chatAttachments.ts` | `supabase.storage.upload()`, `createSignedUrl()` | Storage | Upload de anexos do chat **quebrado** |
| `pages/admin/UserManagement.tsx` | `supabase.storage.from('avatars').upload/remove/getPublicUrl` | Storage | Upload de avatares de admin **quebrado** |
| `components/Sidebar.tsx` | `supabase.storage.from('avatars')` + `supabase.from('profiles')` + `supabase.auth.updateUser` | Storage + Data API + Auth | Upload de avatar, leitura de perfil e troca de senha **quebrados** |
| `pages/manager/ValidatedWorks.tsx` | `supabase.from('validated_works').select/update` | Data API | Tela de obras validadas **quebrada** |
| `components/chat/chatStreamFileSafety.ts` | `VITE_SUPABASE_URL` na whitelist de hosts | Config | Bloqueia URLs do Artifact Server se não configurado |
| `components/chat/ChatFileCard.tsx` | `normalizeSupabaseStorageUrl()` | Compat legacy | Normaliza URLs `/object/sign/` do Supabase |

### 1.2 Backend (`services/chat-bridge`)

| Arquivo | Dependência Supabase | Tipo | Impacto |
| --- | --- | --- | --- |
| `src/attachments.js` | `supabaseUrl/storage/v1/object/...` para leitura e signed URLs | Storage | Leitura de anexos para enviar ao Hermes |
| `src/server.js` | `verifyUser` via `/auth/v1/user` + `/rest/v1/profiles` | Auth + Data API | Autenticação de usuários nas rotas do Bridge |
| `src/server.js` | `deleteGeneratedImagesForHermesSessions` via Supabase Storage | Storage | Exclusão de imagens geradas |
| `src/server.js` | Variáveis `supabaseUrl`, `supabaseAnonKey`, `supabaseServiceRoleKey` | Config | Credenciais legadas |

### 1.3 O que já funciona sem Supabase

| Componente | Status |
| --- | --- |
| Artifact Server (CAS com HMAC tokens) | ✅ Completo e testado |
| Auth por cookies HttpOnly (App API) | ✅ Completo e testado |
| Chat sessions/messages CRUD (App API) | ✅ Completo e testado |
| Admin user management (App API) | ✅ Completo e testado |
| Chat Bridge → Hermes via Runs | ✅ Completo e testado |
| Bridge → Artifact Server para saídas do Hermes | ✅ Completo e testado |

---

## 2. Arquitetura-Alvo do M5

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (apps/chat-web)                                         │
│  - Login, Chat, Admin, Upload de Anexos e Avatares               │
│  - Toda comunicação via /api/* (proxy Nginx ou Vite)             │
│  - Streaming SSE via /api/chat/runs/:id/events                   │
│  - Download de arquivos via /api/artifacts/:id/content?token=... │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTPS / Cookie HttpOnly
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│  App API / BFF (services/app-api) — Fastify 5                    │
│  /api/auth/*        → Auth nativa PostgreSQL                     │
│  /api/admin/*       → RBAC Admin                                 │
│  /api/chat/*        → CRUD sessões + proxy Chat Bridge           │
│  /api/attachments   → Upload multipart → Artifact Server         │
│  /api/attachments/:id/url → Access link → Artifact Server        │
│  /api/users/me/avatar     → Upload avatar → Artifact Server      │
│  /api/artifacts/:id/content?token=... → Proxy → Artifact Server  │
└──────┬──────────────┬──────────────────┬────────────────────────┘
       │              │                  │
       ▼              ▼                  ▼
  PostgreSQL    Chat Bridge        Artifact Server
  (iam, chat)   (Runs, SSE)        (CAS, tokens HMAC)
                     │
                     ▼
               Hermes Agent
```

### 2.1 Decisões de design

1. **Upload de anexos via App API**: O frontend faz `POST /api/attachments` com `multipart/form-data`. A App API valida o cookie, limita tamanho/tipo e repassa para o Artifact Server interno via `POST /v1/artifacts`. O frontend recebe de volta `{ attachment_id, url, expires_at }` — uma URL temporária assinada do Artifact Server.

2. **Chat Bridge sem Supabase**: O Chat Bridge para de autenticar usuários diretamente — a App API já validou o usuário antes de fazer o proxy. O Bridge recebe `x-user-id` e `x-tenant-id` no header, confia na App API como gateway. Quando precisa ler os bytes de um anexo para enviar ao Hermes, busca do Artifact Server (`GET /v1/artifacts/:id/content` com chave interna).

3. **Avatares via Artifact Server**: Mesma mecânica de upload, mas com lifecycle `permanent` e uma referência `avatar_url` no PostgreSQL (`iam.principals.avatar_url`).

4. **Proxy de conteúdo na App API**: Para que o frontend nunca precise acessar o Artifact Server diretamente, a App API expõe `GET /api/artifacts/:id/content?token=...` que faz proxy transparente para o Artifact Server. Isso evita problemas de CORS, whitelist de hosts e exposição de serviço interno.

5. **ValidatedWorks**: Implementar endpoints mínimos na App API (`GET /api/validated-works`, `PATCH /api/validated-works/:id`) que leem e escrevem na tabela `chat.validated_works` (a ser verificada/criada se necessário).

6. **Remoção do stub `supabase.ts`**: Ao final do M5, zero imports de `@/lib/supabase` no código ativo.

---

## 3. Divisão em Tarefas

### Tarefa 1: Infraestrutura de Upload na App API (Backend)

**Objetivo:** Permitir que o frontend faça upload de arquivos (anexos de chat e avatares) via multipart para a App API, que delega ao Artifact Server.

**Arquivos:**
- Criar: `services/app-api/src/attachments/routes.js`
- Criar: `services/app-api/src/attachments/service.js`
- Modificar: `services/app-api/package.json` (adicionar `@fastify/multipart`)
- Modificar: `services/app-api/src/server.js` (registrar plugin)
- Modificar: `services/app-api/src/config.js` (variáveis do Artifact Server)
- Teste: `services/app-api/test/attachments.test.js`

**Endpoints:**
- `POST /api/attachments` — Upload multipart, retorna `{ id, url, filename, content_type, size, expires_at }`
- `POST /api/attachments/:id/access-link` — Renova URL assinada
- `GET /api/artifacts/:id/content` — Proxy transparente para Artifact Server (valida `?token=`)

**Variáveis de config:**
```
ARTIFACT_INTERNAL_URL=http://localhost:8095  (ou IP Docker interno)
ARTIFACT_INTERNAL_KEY=<chave forte>
ARTIFACT_ACCESS_TOKEN_TTL_SECONDS=900
ARTIFACT_PUBLIC_BASE_URL=    (vazio = relativo à App API)
```

---

### Tarefa 2: Upload de Avatar via App API (Backend)

**Objetivo:** Substituir `supabase.storage.from('avatars')` por rota dedicada que persiste no Artifact Server e atualiza `iam.principals.avatar_url`.

**Arquivos:**
- Modificar: `services/app-api/src/attachments/routes.js` (adicionar rotas de avatar)
- Modificar: `services/app-api/src/auth/service.js` (função `updateUserAvatar`)
- Teste: `services/app-api/test/avatar.test.js`

**Endpoints:**
- `POST /api/users/me/avatar` — Upload multipart do avatar do usuário autenticado
- `DELETE /api/users/me/avatar` — Remove avatar

**Contrato:** Retorna `{ avatar_url }` — URL relativa `/api/artifacts/:id/content?token=...`

---

### Tarefa 3: Migrar Frontend — Upload de Anexos de Chat

**Objetivo:** Reescrever `chatAttachments.ts` para usar `POST /api/attachments` em vez do stub Supabase.

**Arquivos:**
- Modificar: `apps/chat-web/src/lib/chatAttachments.ts`
- Modificar: `apps/chat-web/src/lib/chatAttachments.test.ts`
- Modificar: `apps/chat-web/src/lib/api.ts` (adicionar `api.attachments.*`)

**Mudanças:**
- Remover import de `supabase`
- `uploadChatAttachments()` chama `POST /api/attachments` com `FormData`
- `createSignedAttachmentUrl()` chama `POST /api/attachments/:id/access-link`
- `refreshChatAttachmentUrl()` chama `POST /api/attachments/:id/access-link`

---

### Tarefa 4: Migrar Frontend — Avatar e Perfil na Sidebar

**Objetivo:** Substituir todas as chamadas `supabase.from('profiles')` e `supabase.storage.from('avatars')` em `Sidebar.tsx`.

**Arquivos:**
- Modificar: `apps/chat-web/src/components/Sidebar.tsx`
- Modificar: `apps/chat-web/src/lib/api.ts` (adicionar `api.users.me`, `api.users.uploadAvatar`)
- Testes correspondentes

**Mudanças:**
- Leitura de perfil: usa `api.auth.session()` que já retorna `full_name` e `avatar_url`
- Upload de avatar: usa `api.users.uploadAvatar(file)`
- Troca de senha: já usa `api.auth.changePassword()` (implementado em M4)

---

### Tarefa 5: Migrar Frontend — Avatar no Admin UserManagement

**Objetivo:** Substituir `supabase.storage.from('avatars')` em `UserManagement.tsx`.

**Arquivos:**
- Modificar: `apps/chat-web/src/pages/admin/UserManagement.tsx`
- Modificar: `apps/chat-web/src/lib/api.ts` (adicionar `api.admin.users.uploadAvatar(userId, file)`)

---

#### Tarefa 6: Remoção Completa do Módulo ValidatedWorks

**Objetivo:** Eliminar completamente o módulo `ValidatedWorks` do frontend e do sistema, conforme decisão do usuário.

**Arquivos:**
- Modificar: `apps/chat-web/src/App.tsx` (remover rota `/manager/validated-works` e import correspondente)
- Modificar: `apps/chat-web/src/components/Sidebar.tsx` (remover link para trabalhos validados)
- Modificar: `apps/chat-web/src/components/ProtectedRoute.tsx` / `roles.ts` (remover referências se houver)
- Deletar: `apps/chat-web/src/pages/manager/ValidatedWorks.tsx`
- Deletar: `apps/chat-web/src/components/validated-works/ValidatedVisualWorkCard.tsx`
- Deletar: `apps/chat-web/src/components/validated-works/ValidatedVisualWorkCard.test.tsx`
- Deletar: `apps/chat-web/src/lib/validatedWorks.ts`

**Resultado:** Elimina de imediato 4 pontos de dependência do stub Supabase (`supabase.from('validated_works')`), sem necessidade de criar tabelas ou rotas extras.

---

### Tarefa 7: Migrar Frontend — Segurança de URLs e Limpeza

**Objetivo:** Atualizar a whitelist de hosts para streaming, remover referências Supabase na segurança de URLs e remover o stub `supabase.ts`.

**Arquivos:**
- Modificar: `apps/chat-web/src/components/chat/chatStreamFileSafety.ts`
- Modificar: `apps/chat-web/src/components/chat/ChatFileCard.tsx`
- Modificar: `apps/chat-web/src/lib/chatArtifacts.ts`
- Deletar: `apps/chat-web/src/lib/supabase.ts`
- Atualizar testes de segurança de URLs

**Mudanças:**
- `getAllowedStreamFileHosts()` adiciona `window.location.hostname` automaticamente (já faz) e remove dependência de `VITE_SUPABASE_URL`
- `normalizeSupabaseStorageUrl()` removida (não há mais URLs Supabase)
- `chatArtifacts.ts`: renovação de URLs aponta para `POST /api/attachments/:id/access-link` via App API
- Confirmar que nenhum arquivo importa `@/lib/supabase`

---

### Tarefa 8: Desacoplar Chat Bridge do Supabase

**Objetivo:** Eliminar toda dependência do Supabase no Chat Bridge: auth, storage e config.

**Arquivos:**
- Modificar: `services/chat-bridge/src/attachments.js`
- Modificar: `services/chat-bridge/src/server.js`
- Atualizar: `services/chat-bridge/test/attachments.test.js`
- Atualizar: `services/chat-bridge/test/*.test.js` (testes que mockam Supabase)

**Mudanças:**
1. **Autenticação**: O Chat Bridge confia nos headers `x-user-id` e `x-tenant-id` injetados pela App API (que já validou o cookie). Remover `verifyUser` via Supabase `/auth/v1/user`.
2. **Leitura de anexos**: `readAttachmentBytes` passa a ler do Artifact Server via `GET /v1/artifacts/:id/content` com `Authorization: Bearer ${internalKey}`, em vez de `supabaseUrl/storage/v1/object/...`.
3. **Signed URLs**: `createAttachmentSignedUrl` passa a chamar `POST /v1/artifacts/:id/access-link` no Artifact Server.
4. **Exclusão de imagens**: `deleteGeneratedImagesForHermesSessions` usa o Artifact Server em vez de Supabase Storage.
5. **Config**: Remover variáveis `supabaseUrl`, `supabaseAnonKey`, `supabaseServiceRoleKey`.

**Adaptação de fluxo de anexos:**
O payload de `attachments` que chega ao Chat Bridge no `POST /api/chat/runs` muda:
- Antes: `{ storage_path, storage_bucket }` (caminhos Supabase)
- Depois: `{ artifact_id }` (referência ao Artifact Server)

O Chat Bridge recupera os bytes via `GET /v1/artifacts/${artifact_id}/content` com chave interna, extrai texto e materializa imagens para o Hermes da mesma forma.

---

### Tarefa 9: Desacoplar Marketing Ops MCP do Supabase

**Objetivo:** Atender ao critério do roadmap do M5: "Marketing Ops MCP não depende de credenciais Supabase".

**Arquivos:**
- Modificar: `services/marketing-ops/src/config.ts` (tornar credenciais Supabase opcionais/removidas)
- Modificar: `services/marketing-ops/src/auth/supabaseAuth.ts` (permitir auth delegada ou desativar validação Supabase em produção interna)
- Atualizar: `services/marketing-ops/src/auth.test.ts` e `services/marketing-ops/src/migration-contract.test.ts`

---

### Tarefa 10: Docker Compose da Stack de Aplicação

**Objetivo:** Criar o Compose que sobe App API, Chat Web, Chat Bridge e Artifact Server como uma stack unificada, conectada ao PostgreSQL e Hermes existentes.

**Arquivos:**
- Criar: `infra/app/compose.yaml` (base)
- Criar: `infra/app/compose.development.yaml` (portas locais)
- Criar: `infra/app/compose.production.yaml` (Traefik labels, rede interna)
- Criar: `services/app-api/Dockerfile`
- Modificar: `apps/chat-web/Dockerfile` (remover ARGs Supabase, adicionar proxy config Nginx)
- Modificar: `apps/chat-web/nginx.conf` (adicionar `location /api/` proxy para app-api)

**Stack:**
```yaml
services:
  app-api:
    build: ../../services/app-api
    networks: [app-internal, postgres-data]
    environment:
      PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD_FILE
      CHAT_BRIDGE_URL, ARTIFACT_INTERNAL_URL, ARTIFACT_INTERNAL_KEY
      COOKIE_SECRET, NODE_ENV=production, CORS_ORIGIN
    depends_on:
      postgres: { condition: service_healthy }

  chat-bridge:
    build: ../../services/chat-bridge
    networks: [app-internal, hermes-net]
    volumes:
      - hermes-data:/app/data/hermes-artifacts:ro
      - bridge-data:/app/data
    environment:
      HERMES_API_BASE_URL, HERMES_API_KEY
      ARTIFACT_INTERNAL_URL, ARTIFACT_INTERNAL_KEY

  artifact-server:
    build: ../../services/artifact-server
    networks: [app-internal]
    volumes:
      - artifact-data:/app/data

  chat-web:
    build: ../../apps/chat-web
    networks: [app-internal]
    depends_on: [app-api]
    # Nginx serves static + proxies /api/ to app-api
```

**Produção (labels Traefik):**
```yaml
chat-web:
  labels:
    traefik.enable: "true"
    traefik.http.routers.ens-app.rule: Host(`app.solucoes-nexus.tech`)
    traefik.http.routers.ens-app.tls.certresolver: letsencrypt
    traefik.http.services.ens-app.loadbalancer.server.port: "8080"
```

---

### Tarefa 10: Testes de Contrato e Validação Docker Desktop

**Objetivo:** Validação end-to-end completa com a stack inteira rodando no Docker Desktop local.

**Arquivos:**
- Criar: `test/app/compose-contract.test.mjs`
- Criar: `scripts/smoke-app-stack.mjs`

**Cenários de teste:**
1. Stack sobe e todos os containers ficam healthy
2. `GET /health` da App API responde 200
3. Login com credencial válida retorna cookie
4. Upload de anexo via `POST /api/attachments` retorna URL assinada
5. Download do anexo via URL retornada funciona
6. Upload de avatar via `POST /api/users/me/avatar` atualiza perfil
7. Chat Bridge processa run com anexo via Artifact Server
8. Frontend servido pelo Nginx renderiza sem erros de console
9. Nenhuma requisição sai para domínio Supabase (validação de rede)

---

## 4. Ordem de Execução e Commits

| Ordem | Tarefa | Dependências | Commit sugerido |
| ---: | --- | --- | --- |
| 1 | T1: Upload de arquivos na App API | — | `feat(app-api): add multipart attachment upload via Artifact Server` |
| 2 | T2: Upload de avatar na App API | T1 | `feat(app-api): add avatar upload and profile avatar URL management` |
| 3 | T3: Frontend — Anexos de chat | T1 | `refactor(chat-web): migrate chat attachments from Supabase to App API` |
| 4 | T4: Frontend — Sidebar perfil/avatar | T2 | `refactor(chat-web): migrate Sidebar profile and avatar to App API` |
| 5 | T5: Frontend — Admin avatar | T2 | `refactor(chat-web): migrate UserManagement avatar to App API` |
| 6 | T6: Frontend — ValidatedWorks | — | `feat(app-api): add validated-works endpoints; migrate frontend` |
| 7 | T7: Frontend — URL safety e remoção do stub | T3, T4, T5, T6 | `refactor(chat-web): remove supabase.ts stub and legacy URL handling` |
| 8 | T8: Chat Bridge desacoplamento | T1 | `refactor(chat-bridge): replace Supabase storage/auth with Artifact Server` |
| 9 | T9: Docker Compose stack | T1–T8 | `infra(app): add unified application Compose stack` |
| 10 | T10: Testes e validação | T9 | `test(app): add compose contract tests and smoke script` |

---

## 5. Verificação e Evidências Requeridas

### 5.1 Testes Automatizados
```bash
# Todos devem passar com 0 falhas
npm run test:postgres:contract     # ≥24 testes
npm --prefix services/app-api test  # ≥74 + novos testes de upload/avatar
npm --prefix services/chat-bridge test  # ≥124, sem mocks Supabase
npm --prefix services/artifact-server test  # ≥13
npm --prefix apps/chat-web test     # ≥164, sem imports supabase.ts
npm run typecheck                   # 0 erros
```

### 5.2 Validação com Docker Desktop
```bash
# Stack local sobe saudável
docker compose -f infra/app/compose.yaml -f infra/app/compose.development.yaml up -d
# Smoke test automatizado
node scripts/smoke-app-stack.mjs
```

### 5.3 Validação na VPS (Copiloto)
- Deploy assistido pelo operador humano
- `https://app.solucoes-nexus.tech` responde com a interface
- Login, upload de avatar, envio de mensagem com anexo, visualização de arquivo — tudo sem Supabase

### 5.4 Gate de Remoção do Supabase
```bash
# Nenhuma referência ativa ao SDK ou API do Supabase no código de aplicação
grep -rn "supabase" apps/chat-web/src/ --include="*.ts" --include="*.tsx" \
  | grep -v "test" | grep -v ".d.ts" | grep -v "node_modules"
# Esperado: 0 resultados (exceto comentários/docs)
```

---

## 6. Estratégia de Rollback

- Todas as tarefas são aditivas e incrementais; o stub `supabase.ts` só é removido na T7, após todas as substituições estarem implementadas e testadas.
- O Chat Bridge mantém compatibilidade com ambos os modos (Artifact Server e Supabase) até a T8 ser concluída.
- O frontend pode funcionar em modo degradado (sem upload) se a App API estiver indisponível.
- A migration `0006` (se necessária) é idempotente e reversível.
- Os containers legados (Supabase) não são desligados até o gate de M6/M7.

---

## 7. Variáveis de Ambiente Finais Pós-M5

### Frontend (`apps/chat-web`)
```env
VITE_APP_API_URL=            # vazio = relativo (recomendado com proxy Nginx)
VITE_CHAT_STREAM_FILE_HOSTS= # vazio = apenas window.location.hostname
```

### App API (`services/app-api`)
```env
PORT=3000
PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD_FILE
COOKIE_SECRET=<gerado>
CHAT_BRIDGE_URL=http://chat-bridge:8080
ARTIFACT_INTERNAL_URL=http://artifact-server:8095
ARTIFACT_INTERNAL_KEY=<gerado>
ARTIFACT_ACCESS_TOKEN_TTL_SECONDS=900
CORS_ORIGIN=https://app.solucoes-nexus.tech
NODE_ENV=production
```

### Chat Bridge (`services/chat-bridge`)
```env
BRIDGE_PORT=8080
HERMES_API_BASE_URL=http://hermes:8642
HERMES_API_KEY=<chave>
ARTIFACT_INTERNAL_URL=http://artifact-server:8095
ARTIFACT_INTERNAL_KEY=<gerado>
ARTIFACT_ACCESS_TOKEN_TTL_SECONDS=900
# Zero variáveis Supabase
```

### Artifact Server (`services/artifact-server`)
```env
ARTIFACT_PORT=8095
ARTIFACT_DATA_DIR=/app/data
ARTIFACT_INTERNAL_KEY=<gerado>
ARTIFACT_ACCESS_TOKEN_SECRET=<gerado>
ARTIFACT_PUBLIC_BASE_URL=    # vazio = URLs relativas via proxy App API
ARTIFACT_MAX_UPLOAD_BYTES=5368709120
```
