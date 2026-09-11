# Runbook — Backup e restore lógico do PostgreSQL

**Marco:** M3  
**Estado:** exercitado com sucesso em ambiente local/Docker em 2026-09-11; VPS pendente de operador humano  
**Runtime:** PostgreSQL 18.6 com Restic 0.17.3 em Docker Compose

---

## 1. Objetivo e limites

Operar o backup lógico e o restore drill do PostgreSQL ENS sem expor segredos, sem colocar credenciais no Git e sem risco de sobrescrever a base produtiva.

Este runbook cobre:

- inicialização controlada do repositório Restic criptografado;
- criação de snapshot lógico seguro com `pg_dump` (formato custom) e checagem SHA-256;
- política de retenção automatizada (48 horários, 14 diários, 8 semanais);
- validação de RPO alvo de 3600 s (1 h) e RTO alvo de 7200 s (2 h);
- ensaio isolado de restauração (**restore drill**) em banco temporário, sem tocar na base original;
- validação estrutural, de menor privilégio e dados sentinela (`validate-restore.sql`);
- procedimentos manuais e assistidos para o operador da VPS.

### Ameaça coberta e limitações

- **Protegido:** corrupção lógica de tabelas, erro de aplicação, falha de migration ou perda do volume do banco quando o repositório de backup em disco separado sobrevive.
- **Não protegido por este runbook:** perda total da VPS ou destruição do host físico. Uma cópia off-host adicional deve ser operada pelo responsável em evolução posterior (M5/M7).
- **Fail-closed estrito:** o job de drill falha imediatamente se o destino apontar para o host do banco de produção (`PGHOST=postgres`) ou se a base de destino já contiver tabelas de usuário.

---

## 2. Contratos de segurança e arquitetura

| Componente | Contrato e Fronteira |
| --- | --- |
| Papel PostgreSQL | `nexus_backup` com `BYPASSRLS` e `pg_read_all_data` (`WITH INHERIT TRUE`); sem privilégios de superusuário ou DDL. |
| Container Ops | `infra/postgres/Dockerfile.ops`: usuário não-root `nexus_ops` (UID 10001), `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges: true`. |
| Segredos | Arquivos montados sob `/run/secrets/`: `backup_password` e `restic_password`. Nunca usar flags de senha em linha de comando ou variáveis no Git. |
| Repositório Restic | Criptografado com AES-256 / ChaPoly. Sem a chave (`restic_password`), os dados são matematicamente irrecuperáveis. |
| Status operacional | Arquivos `/var/lib/nexus-backup/last-backup.json` e `/var/lib/nexus-backup/last-restore-drill.json` gerados atomicamente, contendo apenas metadados sanitizados. |

---

## 3. Desenvolvimento no Docker Desktop

No ambiente de desenvolvimento, todos os serviços operacionais utilizam o perfil `ops` do Docker Compose.

### 3.1 Inicializar o repositório de backup

O repositório só pode ser inicializado se a flag explícita `ALLOW_REPOSITORY_INIT=1` estiver ativa:

```powershell
docker compose `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  run --rm --profile ops -e ALLOW_REPOSITORY_INIT=1 postgres-backup-init
```

**Resultado esperado:**
- Saída indicando criação do repositório Restic.
- Código de saída 0.
- Execuções subsequentes não recriam nem limpam o repositório existente.

### 3.2 Executar backup manual

```powershell
docker compose `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  run --rm --profile ops postgres-backup
```

**Resultado esperado:**
- `pg_dump` gera arquivo `nexus.dump` no staging temporário.
- Checksum SHA-256 gravado em `manifest.sha256`.
- Snapshot criado e indexado no Restic.
- Política de retenção aplicada via `restic forget --prune`.
- `last-backup.json` atualizado atomicamente com status `ok` e hash do arquivo.

### 3.3 Listar e verificar snapshots

```powershell
docker compose `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  run --rm --profile ops postgres-backup `
  restic snapshots --host nexus-postgres
```

**Resultado esperado:**
- Lista dos snapshots gravados com tags `nexus-postgres` e `logical`.

### 3.4 Executar restore drill isolado

O restore drill restaura o último snapshot em um container e banco temporários dedicados:

```powershell
docker compose `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  run --rm --profile ops postgres-restore-drill
```

**Resultado esperado:**
- Snapshot restaurado em área temporária descartável.
- Integridade do checksum validada via `sha256sum --check`.
- Base de destino conferida (deve estar vazia antes do restore).
- `pg_restore` executado com sucesso.
- Script `validate-restore.sql` executado sem erros (valida esquemas, tabelas e menor privilégio).
- `last-restore-drill.json` atualizado com status `ok` e duração mensurada.

---

## 4. Procedimento assistido para a VPS (Operador Humano)

> [!IMPORTANT]
> A VPS e o ambiente de produção são operados exclusivamente pelo operador humano. O agente não acessa SSH diretamente. Siga rigorosamente cada etapa.

### 4.1 Preparação de diretórios e segredos na VPS

- **Impacto:** nenhum sobre serviços em execução.
- **Pré-condições:** acesso SSH administrativo ao host; Docker Compose instalado; volume de dados do PostgreSQL ativo.
- **Comando manual:**
  ```bash
  sudo install -d -m 700 /srv/ens/backups/postgres
  sudo install -d -m 700 /etc/ens/secrets
  # Gerar senhas de alta entropia sem quebras de linha caso ainda não existam:
  # openssl rand -base64 32 | tr -d '\n' | sudo tee /etc/ens/secrets/postgres_backup_password >/dev/null
  # openssl rand -base64 32 | tr -d '\n' | sudo tee /etc/ens/secrets/restic_repository_password >/dev/null
  sudo chmod 600 /etc/ens/secrets/*
  ```
- **Resultado esperado:** diretórios `/srv/ens/backups/postgres` e `/etc/ens/secrets` criados com permissões restritas.
- **Condição de parada:** falha de criação ou permissões abertas para outros usuários.
- **Rollback:** `sudo rm -rf /srv/ens/backups/postgres`.

### 4.2 Inicialização única do repositório Restic na VPS

- **Impacto:** prepara o repositório criptografado onde os snapshots serão armazenados.
- **Pré-condições:** segredos de produção configurados; PostgreSQL ativo e saudável na rede interna.
- **Comando manual:**
  ```bash
  docker compose -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml \
    run --rm --profile ops -e ALLOW_REPOSITORY_INIT=1 postgres-backup-init
  ```
- **Resultado esperado:** mensagem do Restic confirmando que o repositório foi inicializado.
- **Condição de parada:** erro de autenticação ou diretório inacessível.
- **Logs permitidos para devolução:**
  ```text
  created restic repository <hash> at /var/lib/nexus-backup
  Please note that knowledge of your password is required to access the repository.
  ```

### 4.3 Agendamento do backup horário em produção

- **Impacto:** executa dump lógico horário, aplica retenção e atualiza métricas de conformidade de RPO.
- **Pré-condições:** repositório Restic inicializado.
- **Comando manual (via cron do host ou systemd timer):**
  Adicionar a `/etc/cron.d/ens-postgres-backup`:
  ```cron
  0 * * * * root cd /srv/ens/monorepo && docker compose -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml run --rm --profile ops postgres-backup >> /var/log/ens-postgres-backup.log 2>&1
  ```
- **Resultado esperado:** backup executado a cada 60 minutos sem intervenção humana.
- **Condição de parada:** falha de execução registrada em `/var/lib/nexus-backup/last-backup.json`.
- **Logs permitidos para devolução:** saída do `last-backup.json` (sanitizado).

### 4.4 Procedimento de restore drill mensal na VPS

- **Impacto:** nenhum impacto sobre a base de produção. A restauração ocorre em banco efêmero isolado.
- **Pré-condições:** pelo menos um snapshot recente de backup existente; espaço em disco disponível.
- **Comando manual:**
  ```bash
  docker compose -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml \
    run --rm --profile ops postgres-restore-drill
  ```
- **Resultado esperado:** drill concluído em menos de 7200 segundos com status `ok` em `last-restore-drill.json`.
- **Condição de parada:** erro de soma de verificação SHA-256 ou falha de query de validação.
- **Rollback:** os artefatos de drill são gravados em diretório efêmero que é limpo pelo trap ao finalizar.

### 4.5 Restauração de emergência (Disaster Recovery)

> [!CAUTION]
> A restauração de emergência de produção deve ser precedida de parada dos escritores e snapshot manual do estado remanescente.

1. **Parar tráfego de aplicação:**
   ```bash
   docker compose -f infra/postgres/compose.yaml stop app-api
   ```
2. **Identificar o snapshot desejado:**
   ```bash
   docker compose -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml \
     run --rm --profile ops postgres-backup restic snapshots --host nexus-postgres
   ```
3. **Executar restore apontando snapshot específico para nova base limpa:**
   ```bash
   docker compose -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml \
     run --rm --profile ops -e RESTIC_SNAPSHOT_ID="<snapshot-id>" -e PGHOST=postgres -e PGDATABASE=nexus_recovery postgres-restore
   ```
4. **Validar integridade dos dados recuperados:**
   ```bash
   docker compose -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml \
     run --rm --profile ops -e PGDATABASE=nexus_recovery postgres-restore psql -f /opt/nexus-postgres/validate-restore.sql
   ```
5. **Comutar a base e reiniciar aplicação após aprovação do operador.**
