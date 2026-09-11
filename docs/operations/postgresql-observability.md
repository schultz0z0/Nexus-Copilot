# Runbook — Observabilidade operacional e saúde do PostgreSQL

**Marco:** M3  
**Estado:** exercitado com sucesso em ambiente local/Docker em 2026-09-11; VPS pendente de operador humano  
**Runtime:** PostgreSQL 18.6 em Docker Compose com job de observabilidade sanitizado

---

## 1. Objetivo e princípios

Fornecer um relatório estruturado, auditável e determinístico da saúde operacional do PostgreSQL e da conformidade com os objetivos de recuperação de desastres (RPO e RTO), sem expor credenciais, consultas de negócio ou dados pessoais.

### Princípios arquiteturais

- **Zero dependência externa:** nenhum agente de telemetria externo ou SaaS gerenciado é introduzido. O contrato é um comando idempotente que produz JSON sanitizado em `stdout`.
- **Fail-closed:** se o banco estiver inacessível, se o backup tiver falhado ou se a idade do último snapshot exceder a janela de RPO (3600 s), o comando retorna código de saída não zero e status `critical`.
- **Sanitização estrita:** é terminantemente proibido selecionar ou emitir:
  - credenciais, segredos, senhas ou DSNs;
  - texto ou corpo de queries SQL (`query`, `statement`);
  - identificadores de tenants ou usuários (`tenant_id`, `user_id`, `email`);
  - nomes de hosts ou endereços de rede externos.

---

## 2. Contrato JSON do relatório

O serviço `postgres-observe` produz um único objeto JSON com o seguinte schema estrutural:

```json
{
  "collected_at": "2026-09-11T12:00:00Z",
  "database": {
    "engine": "PostgreSQL",
    "version": "18.6 ...",
    "database_name": "nexus",
    "size_bytes": 10485760,
    "active_connections": 2,
    "waiting_locks": 0,
    "latest_migration": 3
  },
  "backup": {
    "status": "ok",
    "age_seconds": 900,
    "archive_sha256": "3a7b...64hex"
  },
  "restore_drill": {
    "status": "ok",
    "age_seconds": 86400,
    "duration_seconds": 12
  },
  "compliance": {
    "rpo_target_seconds": 3600,
    "rto_target_seconds": 7200,
    "rpo_compliant": true,
    "rto_compliant": true,
    "overall_status": "healthy"
  }
}
```

### Regras de status (`overall_status`)

- `healthy` (código 0): banco disponível, backup realizado nos últimos 3600 segundos com status `ok`, e restore drill realizado com status `ok` em tempo <= 7200 s.
- `degraded` (código 0): banco disponível e backup em dia, porém restore drill com mais de 30 dias de idade (necessidade de agendar novo drill de rotina).
- `critical` (código 1): banco inacessível, backup com idade superior a 3600 s, ausência de backup registrado, erro no último backup ou tempo de restore excedendo 7200 s.

---

## 3. Desenvolvimento no Docker Desktop

Para inspecionar a saúde operacional e métricas locais no Docker Desktop:

```powershell
docker compose `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  run --rm --profile ops postgres-observe
```

**Resultado esperado:**
- Saída JSON em stdout válida e sem texto de build prévio.
- Código de saída 0 quando banco e backup estiverem saudáveis.
- Código 1 caso o backup ainda não tenha sido executado ou o banco esteja fora.

---

## 4. Procedimento assistido para a VPS (Operador Humano)

> [!IMPORTANT]
> O operador humano executa o comando na VPS e pode colar a saída JSON no chat, pois o contrato é 100% sanitizado e livre de segredos ou PII.

### 4.1 Verificação sob demanda da saúde operacional

- **Impacto:** nenhum sobre a disponibilidade do banco. Consulta estritamente somente-leitura aos catálogos `pg_stat_activity`, `pg_database_size`, `pg_locks` e leitura dos arquivos locais de status.
- **Pré-condições:** contêineres do PostgreSQL ativos no Compose de produção.
- **Comando manual:**
  ```bash
  docker compose -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml \
    run --rm --profile ops postgres-observe
  ```
- **Resultado esperado:**
  - Código de saída `0`.
  - `compliance.overall_status` indicando `"healthy"`.
  - `compliance.rpo_compliant: true`.
- **Condição de parada:** código de saída `1` ou `overall_status: "critical"`.
- **Rollback:** não aplicável (operação somente-leitura).

### 4.2 Monitoramento automatizado (Healthcheck periódico)

Para integrar a observabilidade em monitoramento do host, o operador pode adicionar uma verificação a cada 15 minutos em `/etc/cron.d/ens-postgres-health`:

```cron
*/15 * * * * root cd /srv/ens/monorepo && docker compose -f infra/postgres/compose.yaml -f infra/postgres/compose.production.yaml run --rm --profile ops postgres-observe > /var/log/ens-postgres-health.json 2>&1 || logger -t ens-postgres "CRITICAL: PostgreSQL health check failed"
```

### 4.3 Ações corretivas recomendadas

| Sintoma identificado | Causa provável | Ação operacional recomendada |
| --- | --- | --- |
| `rpo_compliant: false` | Backup horário não executou ou falhou | Executar manualmente `postgres-backup` conforme o runbook de backup e verificar logs do Restic em `/var/log/ens-postgres-backup.log`. |
| `rto_compliant: false` | Duração do restore drill ultrapassou 7200 s | Verificar contenção de I/O em disco ou gargalo de CPU na VPS durante descompressão do dump. |
| `waiting_locks > 5` | Conflito transacional de migração ou DDL longo | Executar `docker compose logs --tail=100 postgres` para avaliar transações bloqueantes sem expor texto de consultas. |
| `latest_migration < esperado` | Migração pendente de aplicação | Executar runner de migrations via container dedicado `postgres-migrate`. |
