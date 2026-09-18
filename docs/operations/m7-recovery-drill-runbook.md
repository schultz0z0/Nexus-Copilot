# M7: Production Recovery Drill Runbook

Este documento prescreve o passo a passo para a execução de um **Drill de Recuperação (Recovery Drill)** na VPS de produção, garantindo que os RTO e RPO definidos em `slos-and-retention.md` são possíveis de serem atingidos.

> [!WARNING]
> Este exercício deve ser realizado em janelas de manutenção e não substitui os testes automatizados de backup local.

## Objetivo
Verificar se o backup lógico via `restic` do PostgreSQL pode ser restaurado integralmente em um novo banco de dados na VPS sem perda de dados para além da tolerância estabelecida.

## Procedimento do Drill

### Passo 1: Interrupção Controlada da Aplicação
Para obter um snapshot consistente e não afetar usuários em uso durante a validação, pause a aplicação web temporariamente:
```bash
docker compose --env-file /etc/ens/app.env \
  -f infra/app/compose.yaml \
  -f infra/app/compose.production.yaml \
  stop chat-web app-api
```

### Passo 2: Execução de Backup Isolado (Snapshot Final)
Execute um backup forçado antes de mexer nos volumes para garantir um ponto de restauração zero-loss.
```bash
# Executar a task de backup (referência a ser configurada na VPS via cron)
docker compose --env-file /etc/ens/postgres.env -f infra/postgres/compose.yaml exec -T backup /bin/backup.sh
```

### Passo 3: Criação de Ambiente de Drill (Sandbox)
Em vez de destruir os dados de produção para testar (o que traz risco real), suba uma instância secundária do PostgreSQL escutando na porta 5433 usando uma base vazia.

1. Crie uma pasta temporária `/opt/drill-db`.
2. Crie um `compose.drill.yaml` que suba o PostgreSQL montando a `/opt/drill-db`.

### Passo 4: Executar o Restore
Com o `drill-db` rodando, acione o `restic` para depositar os dumps extraídos do repositório remoto para dentro do contêiner de drill.
```bash
export RESTIC_REPOSITORY="s3:s3.amazonaws.com/sua-bucket-restic"
export RESTIC_PASSWORD="sua-senha-restic"

restic dump latest custom.sql | docker exec -i drill-postgres psql -U postgres
```

### Passo 5: Validação da Integridade (Asserções)
Acesse o `drill-postgres` e rode queries para comprovar que os dados estão lá.
```bash
docker exec -it drill-postgres psql -U nexus_app -d nexus -c "SELECT count(*) FROM chat.chat_sessions;"
```
A contagem deve ser idêntica ao último snapshot da produção.

### Passo 6: Limpeza (Tear-down)
Uma vez que o drill for aprovado (dados idênticos e tempo de restore menor que 2 horas), destrua o `drill-db`:
```bash
docker compose -f compose.drill.yaml down -v
rm -rf /opt/drill-db
```

### Passo 7: Retorno da Operação
Inicie os containers da aplicação novamente.
```bash
docker compose --env-file /etc/ens/app.env \
  -f infra/app/compose.yaml \
  -f infra/app/compose.production.yaml \
  start app-api chat-web
```

## Registro do Teste
Guarde no changelog ou sistema interno da empresa (Jira, Notion) a data em que o drill foi executado, o tempo levado e qualquer impedimento encontrado para manter conformidade de SRE.
