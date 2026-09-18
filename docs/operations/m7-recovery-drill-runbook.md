# M7: Production Recovery Drill Runbook

Este documento prescreve o passo a passo para a execução do **Drill de Recuperação (Recovery Drill)** na VPS de produção, garantindo que os RTO e RPO definidos em `slos-and-retention.md` são cumpridos na arquitetura oficial da ENS.

> [!NOTE]
> O procedimento utiliza os serviços de operação nativos versionados em `infra/postgres/compose.yaml` (`postgres-backup`, `postgres-restore`, `postgres-restore-bootstrap` e `postgres-restore-drill`), garantindo isolamento total do banco de dados ativo de produção.

## Objetivo
Comprovar na topologia de produção que um snapshot lógico criptografado pelo `restic` pode ser restaurado integralmente em uma instância isolada e validado através da suíte `validate-restore.sql` sem interrupção indevida e com RTO < 2h.

## Topologia do Drill

```
+--------------------------+          +--------------------------+
|  postgres (Produção)     |          |  postgres-restore        |
|  - Porta 5432 (Privada)  |          |  - Instância isolada     |
+------------+-------------+          +------------+-------------+
             |                                     ^
       backup|                               restore|
             v                                     |
+--------------------------+          +------------+-------------+
|  postgres-backup (Ops)   | -------> |  postgres-restore-drill  |
|  - Restic snapshot       |  backup  |  - Validação SHA-256     |
|  - /var/lib/nexus-backup |  volume  |  - pg_restore            |
+--------------------------+          |  - validate-restore.sql  |
                                      +--------------------------+
```

## Procedimento do Drill na VPS

### Passo 1: Execução de Snapshot de Produção Atual
Gere um snapshot pontual do banco ativo usando o container unprivileged de backup:

```bash
docker compose --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  run --rm postgres-backup
```
*Critério de sucesso:* O script gera `/var/lib/nexus-backup/status/last-backup.json` com status `success`, digest SHA-256 e snapshot salvo no repositório Restic.

### Passo 2: Inicializar o Alvo Isolado de Restauração
Suba a instância vazia de restauração e configure as roles de menor privilégio:

```bash
docker compose --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  up -d postgres-restore

docker compose --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  run --rm postgres-restore-bootstrap
```
*Critério de sucesso:* `postgres-restore` atinge status `healthy` e `postgres-restore-bootstrap` conclui com código de saída 0.

### Passo 3: Executar o Drill de Restauração e Validação
Acione o serviço especializado `postgres-restore-drill`:

```bash
docker compose --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  run --rm postgres-restore-drill
```

#### O que o serviço `postgres-restore-drill` executa:
1. Localiza o snapshot mais recente no repositório `restic`.
2. Verifica a integridade da assinatura SHA-256 do arquivo dump.
3. Restaura o dump lógico no banco `postgres-restore` usando `pg_restore`.
4. Executa `infra/postgres/ops/validate-restore.sql`:
   - Valida a presença de todas as relações críticas (`iam.*`, `chat.*`, `marketing_ops.*`).
   - Confirma o menor privilégio das roles (`nexus_app`, `nexus_migrator`, `nexus_backup`).
   - Verifica as contagens de sentinelas e integridade das chaves estrangeiras.
5. Escreve `/var/lib/nexus-backup/status/last-restore-drill.json` registrando o tempo total de restauração (RTO).

### Passo 4: Limpeza do Ambiente de Drill
Após a validação aprovada, destrua a instância secundária e seu volume descartável:

```bash
docker compose --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  down --volumes --remove-orphans
```
*(Nota: a instância de produção `postgres` permanece ativa e inalterada, pois usa outro compose profile e volumes independentes).*

## Critérios de Aceite do Drill
- [ ] Status final em `last-restore-drill.json` reporta `status: "success"`.
- [ ] O tempo total de recuperação não ultrapassa o RTO de 2 horas.
- [ ] O banco ativo de produção (`postgres`) manteve 100% de disponibilidade durante o drill.
- [ ] Nenhuma credencial ou segredo foi exposto em logs ou saída padrão.
