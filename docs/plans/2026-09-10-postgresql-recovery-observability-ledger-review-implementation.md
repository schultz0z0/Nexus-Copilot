# PostgreSQL Recovery, Observability and IAM/Chat Ledger Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar backup lógico criptografado, restore drill isolado,
observabilidade sanitizada e revisão humana seletiva das decisões IAM/Chat.

**Architecture:** Serviços one-shot no Compose usam uma imagem operacional
fixada, conectam-se somente à rede PostgreSQL interna e recebem segredos por
arquivo. Um overlay JSON aplica decisões humanas explícitas ao ledger gerado,
sem curingas e sem confundir aprovação arquitetural com implementação.

**Tech Stack:** Docker Compose, PostgreSQL 18.6, `pg_dump`/`pg_restore`, Restic,
POSIX shell, Node.js 22 test runner, Python 3.12/unittest.

**Spec:** `docs/plans/2026-09-10-postgresql-recovery-observability-ledger-review-design.md`

## Global Constraints

- RPO inicial: 1 hora.
- RTO inicial: 2 horas.
- Retenção: 48 horários, 14 diários e 8 semanais.
- PostgreSQL permanece sem porta pública em produção.
- Browser não acessa PostgreSQL ou Hermes diretamente.
- Não reproduzir `anon`, `authenticated` ou `service_role`.
- Não versionar `.env`, passwords, dumps, status operacional ou repositórios
  Restic.
- Restore nunca reutiliza nem monta o volume PostgreSQL de origem.
- O agente não executa ações administrativas na VPS.
- Toda produção de código segue teste falhando, implementação mínima e teste
  verde antes do próximo comportamento.

---

### Task 1: Papel de backup e contrato de segredos

**Files:**

- Modify: `infra/postgres/bootstrap/roles.sql`
- Modify: `infra/postgres/scripts/bootstrap-roles.sh`
- Modify: `infra/postgres/compose.yaml`
- Modify: `infra/postgres/secrets/README.md`
- Modify: `test/postgres/sql-contract.test.mjs`
- Modify: `test/postgres/compose-contract.test.mjs`

**Interfaces:**

- Consumes: bootstrap idempotente atual e Docker secret
  `postgres_bootstrap_password`.
- Produces: role `nexus_backup` e secret
  `/run/secrets/postgres_backup_password` para os jobs operacionais.

- [x] **Step 1: escrever testes de contrato que falham**

Adicionar ao contrato SQL uma expectativa equivalente a:

```js
assert.match(sql, /alter role nexus_backup login .*bypassrls/);
assert.match(sql, /grant connect on database :"database_name" to nexus_backup/);
assert.doesNotMatch(sql, /grant .*create.* to nexus_backup/);
assert.match(script, /NEXUS_BACKUP_PASSWORD/);
```

No contrato Compose, incluir `backup` na criação de secrets temporários e
validar que o bootstrap recebe somente o caminho do secret.

- [x] **Step 2: confirmar RED**

Run: `rtk node --test test/postgres/sql-contract.test.mjs test/postgres/compose-contract.test.mjs`

Expected: FAIL porque `nexus_backup` e `postgres_backup_password` ainda não
existem.

- [x] **Step 3: implementar o mínimo**

Criar o role de forma idempotente, com a configuração:

```sql
ALTER ROLE nexus_backup
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
GRANT CONNECT ON DATABASE :"database_name" TO nexus_backup;
GRANT pg_read_all_data TO nexus_backup;
```

Obter a senha com `\getenv`, carregar o secret sem eco no shell e declarar o
secret configurável no Compose.

- [x] **Step 4: confirmar GREEN e regressão**

Run: `rtk npm run test:postgres:contract`

Expected: PASS, incluindo os contratos existentes de menor privilégio.

- [x] **Step 5: commit**

```bash
rtk git add infra/postgres/bootstrap/roles.sql infra/postgres/scripts/bootstrap-roles.sh infra/postgres/compose.yaml infra/postgres/secrets/README.md test/postgres
rtk git commit -m "feat(postgres): add isolated backup role"
```

### Task 2: Imagem operacional e política do backup

**Files:**

- Create: `infra/postgres/Dockerfile.ops`
- Create: `infra/postgres/ops/common.sh`
- Create: `infra/postgres/ops/init-repository.sh`
- Create: `infra/postgres/ops/backup.sh`
- Create: `test/postgres/ops-contract.test.mjs`
- Modify: `infra/postgres/compose.yaml`
- Modify: `package.json`

**Interfaces:**

- Consumes: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, secret
  `postgres_backup_password`, secret `postgres_restic_password` e volume
  `/var/lib/nexus-backup`.
- Produces: snapshot com tags `nexus-postgres`/`logical`, arquivos
  `nexus.dump` e `manifest.json`, e status atômico
  `/var/lib/nexus-backup/status/last-backup.json`.

- [x] **Step 1: escrever contrato falhando da imagem e scripts**

O teste deve exigir:

```js
assert.match(dockerfile, /FROM restic\/restic:[^@\s]+@sha256:[0-9a-f]{64} AS restic/);
assert.match(dockerfile, /FROM postgres:18\.6-bookworm@sha256:[0-9a-f]{64}/);
assert.match(dockerfile, /^USER nexus_ops$/m);
assert.match(backup, /pg_dump .*--format=custom/);
assert.match(backup, /sha256sum/);
assert.match(backup, /--keep-hourly 48/);
assert.match(backup, /--keep-daily 14/);
assert.match(backup, /--keep-weekly 8/);
assert.doesNotMatch(backup, /set -x|echo .*password/i);
```

Também renderizar o Compose e validar `read_only`, `cap_drop: ALL`,
`no-new-privileges`, ausência de portas e secrets por arquivo.

- [x] **Step 2: confirmar RED**

Run: `rtk node --test test/postgres/ops-contract.test.mjs`

Expected: FAIL porque imagem, scripts e serviço ainda não existem.

- [x] **Step 3: implementar helper e inicialização explícita**

`common.sh` deve oferecer somente estas funções públicas:

```sh
read_secret()       # falha para arquivo ausente/vazio, nunca imprime valor
write_status()      # substituição atômica de JSON controlado
require_directory() # valida mount esperado sem criá-lo silenciosamente
```

`init-repository.sh` executa `restic snapshots`; inicializa apenas quando
`ALLOW_REPOSITORY_INIT=1` e o erro indicar repositório inexistente.

- [x] **Step 4: implementar backup mínimo**

`backup.sh` deve:

```sh
pg_dump --format=custom --no-owner --no-acl --file "$archive_path"
pg_restore --list "$archive_path" >/dev/null
sha256sum "$archive_path" > "$checksum_path"
restic backup "$staging_dir" --host nexus-postgres --tag nexus-postgres --tag logical
restic forget --host nexus-postgres --tag logical --keep-hourly 48 --keep-daily 14 --keep-weekly 8 --prune
restic check --read-data-subset "${RESTIC_CHECK_SUBSET:-5%}"
```

O `trap` remove staging em qualquer saída; erro gera status com código estável,
sem mensagem bruta potencialmente sensível.

- [x] **Step 5: confirmar GREEN**

Run: `rtk node --test test/postgres/ops-contract.test.mjs`

Expected: PASS.

- [x] **Step 6: validar Compose completo**

Run: `rtk npm run test:postgres:contract`

Expected: PASS.

- [x] **Step 7: commit**

```bash
rtk git add infra/postgres/Dockerfile.ops infra/postgres/ops infra/postgres/compose.yaml test/postgres/ops-contract.test.mjs package.json
rtk git commit -m "feat(postgres): add encrypted logical backup job"
```

### Task 3: Backup real contra PostgreSQL no Docker

**Files:**

- Create: `infra/postgres/test/backup.integration.test.mjs`
- Modify: `infra/postgres/test/helpers/postgres-compose.mjs`
- Modify: `infra/postgres/compose.development.yaml`
- Modify: `infra/postgres/package.json`
- Modify: `package.json`

**Interfaces:**

- Consumes: `PostgresComposeHarness`, serviço `postgres-backup` e diretório
  temporário fornecido por `POSTGRES_BACKUP_ROOT`.
- Produces: helper `harness.initializeBackupRepository()` e
  `harness.backup()`; teste comprova snapshot criptografado e status sanitizado.

- [x] **Step 1: escrever integração falhando**

O teste deve inserir duas linhas sentinela em tenants distintos e então:

```js
harness.initializeBackupRepository();
const result = harness.backup();
assert.equal(result.status, 0, result.stderr);
const status = JSON.parse(readFileSync(harness.backupStatusPath, 'utf8'));
assert.equal(status.status, 'ok');
assert.match(status.archive_sha256, /^[0-9a-f]{64}$/);
assert.equal(status.rpo_seconds, 3600);
assert.doesNotMatch(JSON.stringify(status), /password|postgresql:\/\//i);
```

Listar snapshots com senha correta deve funcionar; senha errada deve falhar sem
revelar a senha.

- [x] **Step 2: confirmar RED**

Run: `rtk node --test infra/postgres/test/backup.integration.test.mjs`

Expected: FAIL porque o harness ainda não expõe os comandos.

- [x] **Step 3: estender o harness minimamente**

Adicionar secrets `backup` e `restic`, raiz temporária absoluta e os métodos:

```js
initializeBackupRepository(): SpawnSyncReturns<string>
backup(): SpawnSyncReturns<string>
restic(args: string[], passwordFile?: string): SpawnSyncReturns<string>
get backupStatusPath(): string
```

Cleanup deve verificar o caminho resolvido antes de remover e manter todos os
recursos limitados ao projeto Compose aleatório do teste.

- [x] **Step 4: confirmar GREEN**

Run: `rtk node --test infra/postgres/test/backup.integration.test.mjs`

Expected: PASS com snapshot real.

- [x] **Step 5: regressão PostgreSQL**

Run: `rtk npm run test:postgres && rtk npm run test:postgres:integration`

Expected: PASS.

- [x] **Step 6: commit**

```bash
rtk git add infra/postgres/test infra/postgres/compose.development.yaml infra/postgres/package.json package.json
rtk git commit -m "test(postgres): verify encrypted backup end to end"
```

### Task 4: Restore drill isolado e validação de RTO

**Files:**

- Create: `infra/postgres/ops/restore-drill.sh`
- Create: `infra/postgres/ops/validate-restore.sql`
- Create: `infra/postgres/test/restore-drill.integration.test.mjs`
- Modify: `infra/postgres/compose.yaml`
- Modify: `infra/postgres/test/helpers/postgres-compose.mjs`
- Modify: `test/postgres/ops-contract.test.mjs`

**Interfaces:**

- Consumes: último snapshot Restic e serviços `postgres-restore`,
  `postgres-restore-bootstrap`.
- Produces: status
  `/var/lib/nexus-backup/status/last-restore-drill.json` com duração e
  `rto_compliant`; método `harness.restoreDrill()`.

- [x] **Step 1: escrever contratos e integração falhando**

Exigir que `postgres-restore` use `postgres-restore-data`, não publique portas e
não monte `postgres-data`. A integração deve remover/mutar dados da origem após
o backup, restaurar no destino e comparar as sentinelas recuperadas.

- [x] **Step 2: confirmar RED**

Run: `rtk node --test test/postgres/ops-contract.test.mjs infra/postgres/test/restore-drill.integration.test.mjs`

Expected: FAIL pela ausência do serviço e script.

- [x] **Step 3: implementar restore mínimo e fail-closed**

O script deve executar:

```sh
restic restore latest --host nexus-postgres --tag logical --target "$restore_dir"
sha256sum --check manifest.sha256
pg_restore --list nexus.dump >/dev/null
pg_restore --exit-on-error --no-owner --no-acl --dbname nexus nexus.dump
psql -X --set ON_ERROR_STOP=1 --file /opt/nexus-postgres/validate-restore.sql
```

Antes de restaurar, confirmar que o destino não contém relações de usuário.
Nunca aceitar `PGHOST=postgres` no job de drill.

- [x] **Step 4: confirmar GREEN e falhas seguras**

Run: `rtk node --test test/postgres/ops-contract.test.mjs infra/postgres/test/restore-drill.integration.test.mjs`

Expected: PASS para sucesso, checksum inválido, destino não vazio e senha errada.

- [x] **Step 5: commit**

```bash
rtk git add infra/postgres/ops infra/postgres/compose.yaml infra/postgres/test test/postgres/ops-contract.test.mjs
rtk git commit -m "feat(postgres): add isolated restore drill"
```

### Task 5: Observabilidade local sanitizada

**Files:**

- Create: `infra/postgres/ops/observe.sh`
- Create: `infra/postgres/ops/observe.sql`
- Create: `infra/postgres/test/observability.integration.test.mjs`
- Modify: `infra/postgres/compose.yaml`
- Modify: `test/postgres/ops-contract.test.mjs`

**Interfaces:**

- Consumes: catálogos PostgreSQL e os dois status JSON controlados.
- Produces: um objeto JSON em stdout com `database`, `backup`, `restore_drill`
  e `compliance`; zero quando saudável e não zero quando RPO/RTO falham.

- [x] **Step 1: escrever teste falhando do contrato JSON**

Validar chaves permitidas e negar recursivamente nomes como:

```js
const forbidden = /password|secret|dsn|query|statement|tenant_id|user_id|host/i;
for (const key of allKeys(report)) assert.doesNotMatch(key, forbidden);
assert.equal(report.compliance.rpo_target_seconds, 3600);
assert.equal(report.compliance.rto_target_seconds, 7200);
```

- [x] **Step 2: confirmar RED**

Run: `rtk node --test infra/postgres/test/observability.integration.test.mjs`

Expected: FAIL porque o comando não existe.

- [x] **Step 3: implementar consulta allowlisted**

`observe.sql` deve construir JSON diretamente no PostgreSQL usando apenas
`version()`, `pg_database_size`, `pg_stat_activity`, `pg_locks` e
`infra.schema_migrations`. Não selecionar texto de query, nomes de aplicações,
endereços ou identificadores de negócio.

- [x] **Step 4: implementar avaliação de status**

`observe.sh` valida JSON de backup/drill, aplica 3600/7200 segundos e imprime
apenas o documento final. Ausência ou expiração deve resultar em estado
`critical` e código não zero.

- [x] **Step 5: confirmar GREEN e regressão**

Run: `rtk node --test infra/postgres/test/observability.integration.test.mjs && rtk npm run test:postgres`

Expected: PASS.

- [x] **Step 6: commit**

```bash
rtk git add infra/postgres/ops infra/postgres/compose.yaml infra/postgres/test test/postgres/ops-contract.test.mjs
rtk git commit -m "feat(postgres): add sanitized operational health report"
```

### Task 6: Overlay explícito de revisão IAM/Chat

**Files:**

- Create: `tools/supabase-ledger/src/supabase_ledger/reviews.py`
- Create: `tools/supabase-ledger/tests/test_reviews.py`
- Create: `docs/migration/supabase-ledger/reviews/iam-chat.json`
- Modify: `tools/supabase-ledger/src/supabase_ledger/cli.py`
- Modify: `tools/supabase-ledger/src/supabase_ledger/decisions.py`
- Modify: `tools/supabase-ledger/src/supabase_ledger/render.py`
- Modify: `tools/supabase-ledger/tests/test_cli.py`
- Modify: `tools/supabase-ledger/tests/test_render.py`
- Modify: `package.json`

**Interfaces:**

- Consumes: manifesto e decisões geradas.
- Produces: `apply_review_overlay(document, overlay) -> dict`, opção CLI
  `--reviews`, decisões/render determinísticos e seção de resumo por domínio.

- [ ] **Step 1: escrever testes falhando do overlay**

Os testes devem cobrir:

```python
reviewed = apply_review_overlay(document, overlay)
self.assertEqual("approved", reviewed["decisions"][0]["review_status"])
self.assertRaisesRegex(ReviewValidationError, "orphan", apply_review_overlay, document, orphan)
self.assertRaisesRegex(ReviewValidationError, "duplicate", apply_review_overlay, document, duplicate)
self.assertRaisesRegex(ReviewValidationError, "wildcard", apply_review_overlay, document, wildcard)
```

Exigir destino não vazio para `transform` aprovado e justificativa para
`remove` aprovado.

- [ ] **Step 2: confirmar RED**

Run: `rtk python -m unittest tools.supabase-ledger.tests.test_reviews`

Expected: FAIL porque `reviews.py` ainda não existe.

- [ ] **Step 3: implementar overlay mínimo e CLI**

Formato de cada entrada:

```json
{
  "object_id": "grant:table%3Apublic%2Eprofiles:authenticated:all",
  "action": "remove",
  "target_component": "app-api",
  "target_name": "authorization-without-supabase-role",
  "milestone": "M4",
  "review_status": "approved",
  "reason_code": "supabase_runtime_removal"
}
```

Aplicar somente IDs enumerados; ordenar por `object_id`; validar o documento
resultante com `verify_decisions`.

- [ ] **Step 4: criar revisão IAM/Chat seletiva**

Enumerar explicitamente os objetos aprovados. Grants Supabase viram `remove`;
estruturas com destino inequívoco ganham `target_name`; policies sem substituto,
triggers entre domínios e campos de credencial permanecem `proposed`.

- [ ] **Step 5: gerar e validar relatório**

Run:

```bash
rtk npm run render:supabase-ledger
rtk npm run verify:supabase-ledger
rtk npm run test:supabase-ledger
```

Expected: PASS, relatório com aprovados e propostos separados e zero objeto
sem decisão.

- [ ] **Step 6: commit**

```bash
rtk git add tools/supabase-ledger docs/migration/supabase-ledger package.json
rtk git commit -m "feat(ledger): apply selective IAM and chat review"
```

### Task 7: Runbooks, PRD, roadmap e verificação final

**Files:**

- Create: `docs/operations/postgresql-backup-restore.md`
- Create: `docs/operations/postgresql-observability.md`
- Modify: `docs/operations/README.md`
- Modify: `docs/prds/PRD-0001-migracao-plataforma-ens.md`
- Modify: `docs/migration/roadmap.md`
- Modify: `docs/migration/supabase-capability-inventory.md`
- Modify: `docs/plans/2026-09-10-postgresql-recovery-observability-ledger-review-implementation.md`

**Interfaces:**

- Consumes: comandos e resultados verificados das Tasks 1–6.
- Produces: procedimentos completos para desenvolvimento e produção e estado de
  migração atualizado com percentual conservador.

- [ ] **Step 1: documentar desenvolvimento**

Registrar inicialização do Restic, backup, inspeção, restore drill,
observabilidade e limpeza. Cada comando deve indicar saída esperada e arquivos
temporários criados.

- [ ] **Step 2: documentar produção para o operador**

Para cada ação incluir:

- impacto;
- pré-condições;
- comando a executar manualmente;
- resultado esperado;
- condição de parada;
- rollback;
- logs que podem ser devolvidos, já redigidos.

Não pedir que credenciais sejam coladas no chat.

- [ ] **Step 3: atualizar governança**

Marcar critérios realmente comprovados, registrar limitações de backup no mesmo
host, itens restantes de M3/M4 e recalcular o percentual global sem declarar
conclusão de Auth/Chat.

- [ ] **Step 4: executar verificação final fresca**

Run:

```bash
rtk npm run test:postgres
rtk npm run test:postgres:integration
rtk npm run test:supabase-ledger
rtk npm run verify:supabase-ledger
rtk git diff --check
```

Expected: todas as suítes do escopo passam; nenhum erro de whitespace.

- [ ] **Step 5: inspecionar segredos e artefatos**

Run:

```bash
rtk git status --short
rtk git ls-files | Select-String -Pattern 'last-backup|last-restore|nexus\.dump|restic.*password'
```

Expected: somente fontes/documentação esperadas; nenhum dump, status ou password
versionado.

- [ ] **Step 6: commit**

```bash
rtk git add docs package.json infra/postgres tools/supabase-ledger test/postgres
rtk git commit -m "docs: complete postgres recovery operations batch"
```
