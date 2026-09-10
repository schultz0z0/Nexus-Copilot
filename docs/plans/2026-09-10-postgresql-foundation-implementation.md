# Plano de implementação — Fundação PostgreSQL

**Objetivo:** entregar o primeiro lote M3 com PostgreSQL oficial em container,
migrations verificáveis, papéis de menor privilégio e prova real de RLS
multi-tenant.

**Arquitetura:** um Compose base contém banco, bootstrap explícito e migrator
one-shot. Overrides separam desenvolvimento e produção. SQL imutável é aplicado
por um runner Node.js com checksum e advisory lock. A App API usará papel sem
ownership e instalará contexto somente dentro da transação.

**Stack:** PostgreSQL 18.6, Docker Compose, Node.js 22, `pg`, `node:test`, SQL.

**Design:** [2026-09-10-postgresql-foundation-design.md](2026-09-10-postgresql-foundation-design.md)  
**ADR:** [ADR-0002](../decisions/ADR-0002-postgresql-runtime-roles-and-rls.md)

## Premissas e limites

- Trabalhar em `codex/postgres-foundation`; não tocar na `.env.example` não
  versionada da cópia principal.
- Não copiar migrations Supabase para a baseline nova.
- Não implementar autenticação completa de M4.
- Não acessar a VPS. Produção recebe apenas arquivos e instruções ao operador.
- Não declarar o M3 completo até backup/restore, inventário e os demais gates do
  desenho terem evidência.
- Baseline conhecido: frontend 147/147; Marketing Ops ainda falha sem o banco e
  migrations legados em `127.0.0.1:55322`. Essas falhas não serão ocultadas.

## Checkpoint A — Contrato do runtime em container

### Tarefa 1: Fixar contratos antes do Compose

**Arquivos:**

- criar `test/postgres/compose-contract.test.mjs`;
- alterar `package.json`.

**RED**

1. Escrever testes que exijam:
   - imagem PostgreSQL 18.6 com digest;
   - volume no caminho correto do PostgreSQL 18;
   - healthcheck;
   - porta apenas em loopback no override de desenvolvimento;
   - nenhuma porta publicada no override de produção;
   - senha do banco por arquivo de segredo;
   - serviços one-shot de bootstrap e migration;
   - rede de dados interna em produção.
2. Adicionar `test:postgres:contract` e executá-lo.
3. Resultado esperado: falha por arquivos Compose ausentes.

### Tarefa 2: Implementar Compose mínimo

**Arquivos:**

- criar `infra/postgres/compose.yaml`;
- criar `infra/postgres/compose.development.yaml`;
- criar `infra/postgres/compose.production.yaml`;
- criar `infra/postgres/secrets/.gitignore`;
- criar `infra/postgres/secrets/README.md`.

**GREEN**

1. Resolver a imagem oficial `postgres:18.6-bookworm` e registrar o digest real
   testado.
2. Implementar volume, healthcheck, secrets, rede e overrides.
3. Executar:

   `npm run test:postgres:contract`

4. Resultado esperado: todos os contratos passam.
5. Validar renderização:

   `docker compose -f infra/postgres/compose.yaml -f infra/postgres/compose.development.yaml config`

   `docker compose -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml config`

6. Resultado esperado: configuração válida; somente desenvolvimento publica
   `127.0.0.1:55432`.

### Tarefa 3: Checkpoint do runtime

1. Executar `git diff --check`.
2. Commit: `infra: add pinned PostgreSQL compose foundation`.

## Checkpoint B — Runner de migrations verificável

### Tarefa 4: Testar descoberta, ordem e checksum

**Arquivos:**

- criar `infra/postgres/package.json` e lockfile;
- criar `infra/postgres/test/migration-files.test.mjs`;
- criar `infra/postgres/test/migration-runner.test.mjs`;
- criar `infra/postgres/src/migration-files.mjs`;
- criar `infra/postgres/src/migrate.mjs`.

**RED**

1. Testar nomes `NNNN_nome.sql`, ordem determinística, versão duplicada e arquivo
   inválido.
2. Testar SHA-256 estável e detecção de checksum alterado.
3. Testar que o runner abre transação, instala `nexus_owner`, registra migration,
   faz rollback na falha e sempre libera advisory lock.
4. Resultado esperado: testes falham antes da implementação.

**GREEN**

1. Implementar funções puras de descoberta/checksum.
2. Implementar runner com cliente injetável e CLI que lê `DATABASE_URL` ou
   parâmetros libpq do ambiente.
3. Proibir impressão de URL ou senha.
4. Executar `npm --prefix infra/postgres test`.
5. Resultado esperado: testes unitários passam.

### Tarefa 5: Integrar o runner ao Compose

**Arquivos:**

- criar `infra/postgres/Dockerfile.migrator`;
- alterar `infra/postgres/compose.yaml`;
- alterar `test/postgres/compose-contract.test.mjs`.

1. Escrever primeiro o contrato do container sem shell interpolando segredo no
   Compose.
2. Implementar imagem mínima do migrator e entrada explícita.
3. Executar contrato e `docker compose ... config`.
4. Commit: `feat(db): add checksummed migration runner`.

## Checkpoint C — Papéis, schema mínimo e RLS

### Tarefa 6: Testar o bootstrap de papéis

**Arquivos:**

- criar `infra/postgres/bootstrap/roles.sql`;
- criar `infra/postgres/scripts/bootstrap-roles.sh`;
- criar `test/postgres/sql-contract.test.mjs`.

**RED**

Testar estaticamente que `nexus_owner`, `nexus_migrator` e `nexus_app` têm o
contrato do ADR, que o app não recebe owner/BYPASSRLS e que senhas não aparecem
nos arquivos versionados.

**GREEN**

Implementar bootstrap idempotente com senhas lidas dos arquivos Docker secrets,
sem ecoá-las. Validar com `npm run test:postgres:contract`.

### Tarefa 7: Escrever migrations da fundação

**Arquivos:**

- criar `infra/postgres/migrations/0001_foundation_schemas.sql`;
- criar `infra/postgres/migrations/0002_iam_tenancy.sql`;
- criar `infra/postgres/migrations/0003_rls_canary.sql`;
- ampliar `test/postgres/sql-contract.test.mjs`.

**RED**

Exigir schemas, constraints, FKs, índices tenant-first, grants mínimos,
`ENABLE/FORCE RLS`, `USING` e `WITH CHECK`, além de ausência de referências
Supabase.

**GREEN**

Implementar:

- `infra.schema_migrations` pelo runner;
- `iam.tenants`, `iam.principals` e `iam.memberships` mínimos;
- tabela sentinela `app_private.tenant_canary` acessível ao app somente por RLS;
- helpers de contexto que falham fechados;
- grants explícitos e default privileges restritos.

Executar contratos e testes unitários.

### Tarefa 8: Provar em PostgreSQL real

**Arquivos:**

- criar `infra/postgres/test/foundation.integration.test.mjs`;
- criar `infra/postgres/test/helpers/postgres-compose.mjs`;
- alterar scripts de `infra/postgres/package.json` e raiz.

**RED/GREEN**

1. Subir banco limpo pelo Compose de desenvolvimento.
2. Executar bootstrap e migrations duas vezes.
3. Testar no catálogo os atributos de papéis, ownership, grants, policies e
   índices.
4. Como `nexus_app`, provar:
   - negação sem contexto;
   - leitura e escrita no próprio tenant;
   - isolamento de outro tenant;
   - falha de `INSERT`/`UPDATE` cross-tenant;
   - limpeza de contexto após commit e rollback na mesma conexão.
5. Alterar temporariamente uma migration já aplicada em fixture isolada e provar
   falha por checksum.
6. Resultado esperado: suíte real passa em banco vazio e repetido.
7. Commit: `feat(db): enforce tenant isolation with PostgreSQL RLS`.

## Checkpoint D — Operação e evidências

### Tarefa 9: Criar runbook local e de produção assistida

**Arquivos:**

- criar `docs/operations/postgresql-foundation.md`;
- alterar `docs/operations/README.md`;
- alterar `docs/README.md`;
- alterar `docs/migration/roadmap.md`.

Documentar para cada comando de produção: impacto, resultado esperado, condição
de parada e rollback. Incluir criação de secrets fora do Git, subida, health,
bootstrap, migrate, logs redigidos, parada e diagnóstico. Não executar na VPS.

### Tarefa 10: Registrar dívida e gate de segurança completo

**Arquivos:**

- atualizar `docs/plans/2026-09-10-postgresql-foundation-design.md`;
- criar `docs/migration/supabase-capability-inventory.md`;
- atualizar o PRD, roadmap e índice da documentação;
- atualizar este plano.

Registrar como pendentes, sem marcá-los concluídos: auth M4, migração dos domínios,
backup/restore exercitado, observabilidade de produção, inventário Supabase,
TLS/pg_hba revisados, RPO/RTO e cutover.

**Estado:** concluída em 2026-09-10. A matriz registra capacidades, 51 tabelas,
Edge Functions, grupos de RPCs/triggers, buckets, extensões e destinos. O ledger
DDL automatizado e os demais gates permanecem explicitamente abertos.

### Tarefa 11: Verificação final do lote

Executar e guardar resumo:

1. `npm run test:postgres`;
2. `npm run test:postgres:integration`;
3. `npm run test:hermes`;
4. `npm run test:chat-web`;
5. suítes não dependentes do legado em Marketing Ops;
6. `npm run typecheck`;
7. `npm run build`;
8. `git diff --check`;
9. `git status --short`.

Falhas de baseline que dependem das migrations Supabase antigas devem continuar
registradas como dívida, nunca convertidas em falso sucesso.

**Estado:** concluída em 2026-09-10 para o escopo deste lote.

| Gate executado | Resultado observado |
| --- | --- |
| `npm run test:postgres` | 12/12 contratos e 9/9 testes do runner aprovados |
| `npm run test:postgres:integration` | 5/5 testes em PostgreSQL real aprovados; recursos temporários removidos |
| `npm run test:hermes` | 16 aprovados, 0 falhas e 6 pulados por ausência de shell POSIX no Windows |
| `npm run test:chat-web` | 39 arquivos e 147/147 testes aprovados |
| `npm run test:chat-bridge` | 124/124 testes aprovados |
| `npm run test:artifact-server` | 13/13 testes aprovados |
| Marketing Ops sem legado | 27 arquivos e 85/85 testes aprovados |
| `npm run typecheck` | frontend e Marketing Ops aprovados |
| `npm run build` | frontend e Marketing Ops aprovados; warnings conhecidos de chunk e Browserslist |
| `npm run test:cut` | 3/3 testes aprovados |
| higiene | `git diff --check` aprovado; nenhum secret/arquivo sensível rastreado ou container temporário ativo |

A suíte completa `npm run test:marketing-ops` continua vermelha pelo baseline
copiado: nove contratos procuram migrations Supabase ausentes, integrações tentam
o banco legado em `127.0.0.1:55322` e um contrato procura o antigo
`docker-compose.yml`. Essa falha é esperada até a migração do domínio; não é
atribuída à fundação nova nem tratada como gate aprovado.

### Tarefa 12: Publicação controlada

1. Commit: `docs: record PostgreSQL foundation evidence`.
2. Revisar o diff completo e confirmar ausência de segredos.
3. Integrar `codex/postgres-foundation` à `main` sem sobrescrever alterações do
   usuário.
4. Fazer push de `main` para `origin/main` somente após todos os gates locais do
   lote passarem.

## Estado de execução

| Checkpoint | Estado | Evidência |
| --- | --- | --- |
| A — runtime em container | Concluído | `1ac9721`; 3/3 contratos e dois `docker compose config --quiet` aprovados |
| B — runner de migrations | Concluído | `fb70b64`; 9/9 testes unitários, 4/4 contratos Compose e build da imagem aprovados |
| C — papéis e RLS | Concluído | `0755d67`; 12/12 contratos, 9/9 unitários e 5/5 integrações reais aprovados |
| D — operação e evidências | Primeiro lote aprovado localmente | runbook, inventário e verificação final registrados; backup/restore, ledger DDL automatizado e gates de M3 seguem pendentes |

**Próximo comando seguro:** concluir a Tarefa 12, integrar a branch à `main` e
publicar `origin/main`; depois abrir uma nova fatia para o ledger DDL automatizado
ou o ADR de Auth/App API, sem acessar a VPS.
