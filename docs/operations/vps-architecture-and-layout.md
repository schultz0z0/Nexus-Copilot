# Guia de Operação e Arquitetura da VPS de Produção

**Atualização:** 2026-09-11  
**Ambiente:** Hostinger VPS (Linux x86_64, IP 92.112.179.235)  
**Domínio:** `solucoes-nexus.tech`  
**Diretório do Monorepo no Host:** `/opt/prometeus-marketing`  
**Repositório Git:** `https://github.com/schultz0z0/Nexus-Copilot.git` (`branch: main`)

---

## 1. Princípios Operacionais e Papel do Agente Copiloto

Conforme o [AGENTS.md](../../AGENTS.md):
- A VPS e o ambiente de produção são operados **exclusivamente pelo operador humano**.
- Nenhum agente IA conecta por SSH direto, abre painéis administrativos ou executa comandos sem autorização.
- O agente atua como **copiloto**:
  1. Fornece **um comando por vez**;
  2. Declara explicitamente **Impacto**, **Resultado Esperado**, **Condição de Parada** e **Rollback**;
  3. O operador humano executa no terminal da VPS e cola o log de saída redigido;
  4. O agente analisa a saída antes de propor o próximo passo.
- **Segurança de credenciais**: Nunca versione nem cole senhas, tokens ou URLs de conexão com senhas no chat ou nos logs.

---

## 2. Topologia Multi-Compose (Mesmo Monorepo, Stacks Separadas)

O monorepo adota o padrão de **múltiplas stacks Compose modulares** dentro do mesmo repositório:

```
/opt/prometeus-marketing/
  ├── infra/
  │    ├── hermes/
  │    │    ├── compose.yaml              # Stack ens-hermes (base)
  │    │    ├── compose.production.yaml   # Traefik router para porta 9119 (dashboard)
  │    │    └── profile-init.sh           # Inicializador idempotente do profile ens
  │    └── postgres/
  │         ├── compose.yaml              # Stack ens-postgres (base, tools e ops)
  │         ├── compose.production.yaml   # Rede internal: true (nenhuma porta no host)
  │         ├── bootstrap/roles.sql       # Definição de papéis e grants mínimos
  │         ├── migrations/               # Migrations imutáveis versionadas (0001-0004)
  │         └── src/migrate.mjs           # Runner transacional com advisory lock
  ├── apps/chat-web/                      # Frontend da aplicação
  └── services/                           # Serviços internos (Chat Bridge, Artifact Server, etc.)
```

### Por que os Composes são separados?

1. **Ciclo de Vida Independente**: O banco de dados (`ens-postgres`) possui ciclo de vida longo e crítico. Atualizar skills, modelos ou reiniciar o container do Hermes Agent **nunca** interfere nem derruba conexões do PostgreSQL.
2. **Isolamento de Segredos e Privilégios**: As credenciais do PostgreSQL (`nexus_owner`, `nexus_migrator`, `nexus_app`, `nexus_backup`) residem estritamente na stack do Postgres e não se misturam com as variáveis do runtime de IA.
3. **Observabilidade e Gestão Limpa de Recursos**:
   - `ens-hermes` (container `ens-hermes-hermes-1`): consome ~414 MB RAM;
   - `ens-postgres` (container `ens-postgres-postgres-1`): consome ~55 MB RAM.

---

## 3. Gestão de Segredos e Arquivos de Ambiente no Host

Todos os segredos produtivos ficam estritamente **fora do Git**, no diretório `/etc/ens/`:

### Estrutura de Arquivos em `/etc/ens/`

| Arquivo / Diretório | Permissão | Dono | Finalidade |
| --- | --- | --- | --- |
| `/etc/ens/hermes.env` | `600` | `root:root` | Variáveis de ambiente do Hermes (`API_SERVER_KEY`, `HERMES_DASHBOARD`, etc.) |
| `/etc/ens/postgres.env` | `600` | `root:root` | Mapeamento dos caminhos dos secrets do Postgres |
| `/etc/ens/secrets/postgres/` | `755` | `root:root` | Diretório contendo os arquivos de senhas montados como secrets |
| `.../secrets/postgres/bootstrap` | `644` | `root:root` | Senha da role `nexus_bootstrap` |
| `.../secrets/postgres/migrator` | `644` | `root:root` | Senha da role `nexus_migrator` |
| `.../secrets/postgres/app` | `644` | `root:root` | Senha da role `nexus_app` (usada pelo BFF) |
| `.../secrets/postgres/backup` | `644` | `root:root` | Senha da role `nexus_backup` |
| `.../secrets/postgres/restic` | `644` | `root:root` | Senha de criptografia dos backups Restic |

> **Nota de Permissões**: Os arquivos dentro de `/etc/ens/secrets/postgres/` devem possuir modo `644` (ou grupo compartilhado) para que os containers Docker rodando sob usuários não-root (`postgres` UID 999 e `node` UID 1000) possam lê-los em `/run/secrets/`. O arquivo `postgres.env` permanece com `600`.

---

## 4. Redes, Portas e Acesso Externo

```
                    INTERNET
                       │ (Porta 443 / HTTPS)
                       ▼
            ┌──────────────────────┐
            │   Traefik (Host)     │
            │ (Let's Encrypt TLS)  │
            └──────────┬───────────┘
                       │ Host: hermes.solucoes-nexus.tech
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stack ens-hermes                                            │
│   • Dashboard: Porta 9119 (HTTP interno -> Traefik HTTPS)   │
│     Basic Auth: admin / scrypt hash                         │
│   • Runs API: Porta 8642 (SEM ROTA EXTERNA - REDE PRIVADA)  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Stack ens-postgres (Rede ens-postgres-data, internal: true) │
│   • Porta 5432: ISOLADA DO HOST (0 portas publicadas)       │
│   • Acesso exclusivo interno para nexus_app via BFF         │
└─────────────────────────────────────────────────────────────┘
```

- **Traefik**: Container `traefik-es6t-traefik-1` rodando em `network_mode: host`.
- **Dashboard Hermes**: Publicado em `https://hermes.solucoes-nexus.tech` com TLSv1.3 e Let's Encrypt válido.
- **Autenticação do Dashboard**: Basic Auth HTTP (`admin` / senha configurada no volume `/opt/data/config.yaml`).
- **API do Hermes**: Escuta na porta interna `8642`. Não possui router público no Traefik nem portas no host.
- **PostgreSQL**: Escuta na porta `5432` da rede interna Docker `ens-postgres-data`. Nenhuma porta aberta no host.

---

## 5. Estado Atual dos Marcos de Migração

1. **Marco M1 — Runtime Hermes e Profile ENS**:
   - Imagem: `nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79`;
   - Profile `ens@0.1.1` ativo no volume persistente `ens-hermes-data`;
   - Supervisão de processos via `s6-overlay` (gateway + dashboard sem restart loop);
   - Status: `Up (healthy)`.

2. **Marco M2 — Protocolo de Runs e Chat Bridge**:
   - Contrato Python `test_runs_contract.py` aprovado contra `172.16.2.2:8642`;
   - Suíte de testes do Chat Bridge aprovada na VPS (124/124 testes);
   - Smoke test Node validado (Liveness `PASS`, Capabilities `PASS`);
   - Persistência de `RunStore` migrada para a tabela `chat.bridge_runs` do PostgreSQL.

3. **Marco M3 — Fundação PostgreSQL**:
   - Imagem: `postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af`;
   - Papéis com menor privilégio: `nexus_owner`, `nexus_migrator`, `nexus_app`, `nexus_backup`;
   - Migrations `0001` a `0004` aplicadas com sucesso:
     - `0001_foundation_schemas.sql`: Schemas `infra`, `app_private` e `iam`;
     - `0002_iam_tenancy.sql`: Tabelas de tenancy e identidades;
     - `0003_rls_canary.sql`: Funções de tenant context e políticas RLS forçadas;
     - `0004_chat_store.sql`: Schema `chat` (6 tabelas: `chat_sessions`, `chat_messages`, `bridge_runs`, etc.).
   - Isolamento RLS testado e comprovado com o usuário `nexus_app`;
   - 23/23 testes contratuais de PostgreSQL aprovados.

---

## 6. Comandos Operacionais Essenciais

### 6.1. Inspecionar o Hermes
```bash
# Status do container
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml ps

# Logs recentes
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml logs --tail=50 hermes

# Obter IP privado do container
docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ens-hermes-hermes-1
```

### 6.2. Inspecionar o PostgreSQL
```bash
# Status do container
docker compose --env-file /etc/ens/postgres.env -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml ps

# Logs do banco
docker compose --env-file /etc/ens/postgres.env -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml logs --tail=50 postgres

# Listar migrations aplicadas no ledger oficial
docker compose --env-file /etc/ens/postgres.env -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml exec -T postgres psql -U nexus_bootstrap -d nexus -c "SELECT version, name, applied_at FROM infra.schema_migrations ORDER BY version;"

# Listar tabelas do domínio chat
docker compose --env-file /etc/ens/postgres.env -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml exec -T postgres psql -U nexus_bootstrap -d nexus -c "\dt chat.*"
```

### 6.3. Aplicar Novas Migrations no PostgreSQL
```bash
docker compose --env-file /etc/ens/postgres.env --profile tools -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml run --rm --no-deps postgres-migrate
```

---

## 7. Próximo Marco: M4 — Autenticação, Sessões e App API (BFF)

Com o banco de dados e o runtime Hermes estáveis e validados na VPS, o Marco M4 introduzirá a camada de aplicação:
- **App API / BFF**: Serviço Node.js/Fastify que fica entre o frontend (`chat-web`) e a infraestrutura interna;
- **Conexão com PostgreSQL**: Conecta na rede privada `ens-postgres-data` usando o usuário `nexus_app`;
- **Injeção de Tenant/User Context**: Define `SET LOCAL app.tenant_id` e `SET LOCAL app.user_id` em cada transação para garantir o isolamento RLS;
- **Sessões e Autenticação Própria**: Substituição definitiva do Supabase Auth por sessões HTTP-only seguras no PostgreSQL;
- **Documentação de Referência**:
  - [ADR-0003: Auth, Sessões e App API](../decisions/ADR-0003-auth-sessions-and-app-api.md)
  - [Plano de Arquitetura M4](../plans/2026-09-11-m4-auth-bff-architecture-design.md)
