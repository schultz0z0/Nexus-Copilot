# ADR-0003 — Autenticação, Sessões e App API / BFF

**Data:** 2026-09-11  
**Estado:** Proposto  
**Marco:** M4 (Auth e App API/BFF)

## Contexto

O ENS está migrando para fora do Supabase gerenciado. No estado anterior, o frontend (`apps/chat-web`) consumia diretamente o Supabase GoTrue (`supabase.auth.*`), tabelas PostgREST com RLS (`supabase.from(...)`) e Storage (`supabase.storage.*`) através de mais de 36 arquivos.

O `AGENTS.md` e o `PRD-0001` estabelecem fronteiras obrigatórias:
1. O navegador deve conversar exclusivamente com a App API/BFF; nunca com o PostgreSQL ou Hermes diretamente.
2. Identidade, tenant e autorização de negócio pertencem à aplicação e são reforçadas em profundidade no banco de dados.
3. Não introduzir serviços externos proprietários ou pesados que quebrem a operabilidade em VPS única.

## Opções consideradas

1. **Serviço de Identidade próprio integrado à App API (Node.js/TypeScript):**
   - Implementar endpoints de auth (`/api/auth/*`), hashing compatível de senha e sessões por cookies seguros dentro da App API ou serviço de identidade leve.
   - *Vantagens:* Menor consumo de recursos na VPS, total controle do fluxo, integração direta com os schemas `iam` já criados no PostgreSQL (`iam.principals`, `iam.memberships`).
2. **Keycloak / Ory Kratos auto-hospedado:**
   - Adicionar uma suite de IAM completa em container separado.
   - *Desvantagens:* Alto consumo de memória RAM (especialmente Keycloak JVM em VPS de 4-8 GB), complexidade operacional desnecessária para o volume e escopo do ENS.
3. **Manter PostgREST público com JWT emitido por terceiro:**
   - Viola as diretrizes do `AGENTS.md` (o navegador não deve falar diretamente com banco ou PostgREST).

## Decisão

Adotar a **Opção 1**: a criação de uma **App API / BFF própria em Node.js/TypeScript** contendo o módulo de identidade e autenticação da plataforma.

### 1. Mecanismo de Autenticação e Sessão
- **Sessões por Cookies:** Autenticação baseada em cookie seguro `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Formato:** Token de sessão opaco e aleatório (256 bits via `crypto.randomBytes`) com estado persistido em tabela `iam.user_sessions`, ou token de acesso JWT de curta duração (15 min) assinado assimetricamente com par de chaves interno, associado a Refresh Token em cookie HttpOnly rotativo.
- **Proteção CSRF:** Validação de cabeçalho `Origin` / `Referer` e SameSite Lax para requisições mutantes (`POST`, `PUT`, `DELETE`, `PATCH`).

### 2. Compatibilidade de Senhas (Migração de `auth.users`)
- O Supabase GoTrue utiliza **bcrypt** (`$2a$` / `$2b$`) para hash de senhas de usuários.
- O novo serviço de autenticação utilizará biblioteca padrão compatível (`bcrypt` ou `@node-rs/bcrypt`) para verificar diretamente os hashes legados importados de `auth.users` durante a migração de dados (M6), **sem exigir redefinição de senha para usuários existentes**.
- Novas senhas e atualizações serão geradas com fator de custo adequado (work factor 12) ou transicionadas para Argon2id em logins subsequentes.

### 3. Propagação de Contexto no PostgreSQL
- A App API mantém um pool de conexões com credenciais do papel `nexus_app`.
- A cada requisição autenticada, antes de executar queries de dados de domínio, a App API injeta o contexto da sessão na transação:
  ```sql
  SELECT
    set_config('app.user_id', $1, true),
    set_config('app.tenant_id', $2, true),
    set_config('app.role', $3, true);
  ```
- Isso garante que o RLS em `iam` e `chat` valide o usuário/tenant em nível de banco de dados, prevenindo vazamento *cross-tenant* ou *cross-user*.

### 4. Substituição do SDK Supabase no Frontend
- O pacote `@supabase/supabase-js` será removido de `apps/chat-web`.
- Um cliente HTTP tipado (`apps/chat-web/src/lib/api.ts`) baseado em `fetch` nativo consumirá os endpoints `/api/*` da App API com `credentials: 'include'`.
- Os módulos existentes (`chatService.ts`, `AuthContext.tsx`, etc.) serão adaptados para chamar a App API.

### 5. Edge Functions de Administração
- As funções `admin-create-user`, `admin-reset-password` e `admin-delete-user` serão consolidadas como rotas administrativas autorizadas na App API (`/api/admin/users/*`), restritas a usuários com role `admin` no schema `iam`.

## Consequências

### Positivas
- Eliminação total da dependência de bibliotecas clientes e serviços de terceiros para autenticação.
- O frontend passa a ter uma superfície de API coesa e previsível.
- Zero atrito para os usuários finais: credenciais e senhas existentes são preservadas.
- RLS do PostgreSQL opera como defesa em profundidade com contexto real do usuário injetado pelo BFF.

### Riscos e Mitigações
- **Ataques de força bruta e credenciais:** A App API deve implementar rate limiting estrito nos endpoints `/api/auth/login` e `/api/auth/reset-password`.
- **Injeção de contexto incorreta no pool:** Testes automatizados obrigatórios devem verificar que transações subsequentes no mesmo pool de conexão limpam o contexto de `app.user_id`.

## Regras de revisão

Esta decisão deve ser revista se:
- For requerida integração com provedor de identidade corporativo externo (SAML / OIDC empresarial);
- O tráfego justificar a separação da App API em microsserviços distintos de autenticação e produto.
