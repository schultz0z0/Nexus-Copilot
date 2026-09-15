# Runbook — M6 Marketing Ops e cutover

**Marco:** M6  
**Estado:** Gate local aprovado; checkpoint produtivo da execução estruturada pendente
**Último ensaio local:** 2026-09-15
**Checkout da VPS:** `/opt/prometeus-marketing`

## Objetivo e fronteiras

Ativar o domínio Marketing Ops sobre o PostgreSQL canônico, App API/BFF e Hermes
interno sem reintroduzir Supabase, Graph MCP ou Neo4j. O navegador continua
falando somente com a App API e PostgreSQL continua sendo a autoridade dos dados
do produto.

Produção é operada exclusivamente pelo responsável humano. Os comandos abaixo
permanecem como registro histórico e modelo de rollback; não devem ser repetidos
sem um novo checkpoint explícito. Não execute SSH, deploy ou restauração a
partir de um agente.

## Estado produtivo registrado em 2026-09-14

- P1: backup Restic, migrations `0001`–`0016`, ledger e idempotência aprovados.
- P2: secrets/configuração, imagens de rollback e containers Marketing Ops/App
  saudáveis aprovados.
- P3: destino vazio aprovado pelo responsável; não houve carga legada.
- P4 leitura: frontend/BFF, campanha criada do zero e consulta Hermes aprovados.
- P4 escrita: flags de write e approvals ativadas progressivamente; preparação
  de plano aprovada.
- P4 execução: **não aprovada**. A execução por confirmação textual depende de
  endpoint privado ausente no Hermes oficial e perdeu o `plan_token` entre
  turnos. O bloqueio falhou fechado, sem mutação ou approval criado.

O gate local do
[plano estruturado com botão Executar plano](../plans/2026-09-14-structured-marketing-ops-plan-execution-design.md)
foi aprovado. O próximo passo é somente o checkpoint produtivo operado pelo
responsável humano. Não repetir confirmações textuais, não fazer fork do Hermes
e não criar substituto para `/v1/internal/marketing-ops-decision`.

## Evidência local aprovada

O ensaio isolado em Docker Desktop comprovou:

- migrations `0001`–`0016` aplicadas em banco vazio;
- 465 linhas sintéticas aceitas e 4 quarentenadas pela política de transformação;
- primeira carga `completed`, segunda carga `skipped` pela mesma fingerprint;
- duas reconciliações integrais aprovadas;
- duração do ensaio completo de 5,619 s;
- banco isolado removido com sucesso no ensaio de rollback;
- 12/12 verificações do smoke da stack, incluindo sessão App API e BFF;
- MCP v1 acessível, com 10 ferramentas publicadas e limites de delegação e
  confirmação de escrita ativos;
- E2E local de campanhas, produção/calendário, approvals, kill switch e comandos
  Hermes aprovado;
- Marketing Ops com 242 testes executados e aprovados; frontend com 163 testes
  aprovados; typechecks e builds de produção aprovados;
- no Compose de produção, App API, Artifact Server, Chat Bridge e Marketing Ops
  não publicam portas no host; Marketing Ops não possui router Traefik.

O gate complementar descartável de 2026-09-15 comprovou adicionalmente:

- migration `0017` aplicada e ledger `0001`–`0017` idempotente na segunda run;
- frontend 193/193, Marketing Ops 275/275, Chat Bridge 127/127, Artifact Server
  13/13 e App API 87/87;
- Hermes oficial v2026.8.27 conectado ao MCP privado e 10 ferramentas
  descobertas na rede descartável;
- Playwright contra a stack real validou login, sessão, isolamento de ator e o
  card persistido; separadamente, o fake determinístico do Hermes passou 7/7
  cenários do clique e 1/1 do kill switch;
- smoke autenticado da stack real 14/14;
- plano operacional inerte executado e repetido com a mesma chave: 1 plano,
  1 approval `pending`, 0 decisões e 0 ações externas;
- rollback por flags com recriação exclusiva de Marketing Ops e Chat Web,
  preservando a sessão e a leitura autenticada;
- correção TDD da projeção de revisores para a tabela canônica
  `iam.memberships`.
- review de segurança resolvido: rejeição recursiva de credenciais, RLS por
  tenant+ator, preparo concorrente serializado, estado terminal imutável e
  catálogo do card alinhado ao servidor.

Nenhum dado, dump, credencial ou artefato temporário do ensaio foi versionado.
Os projetos Docker e volumes descartáveis `ens-m6-cutover-*` foram removidos.

## Checkpoint 1 — backup, migrations e validação do ledger (executado)

### Pré-condições

- O commit de release M6 aprovado já deve estar presente no checkout, com árvore
  limpa. Este checkpoint **não faz `git pull`**.
- `/etc/ens/postgres.env` deve continuar apontando apenas para secrets externos ao
  Git; não imprima nem compartilhe seu conteúdo.
- PostgreSQL deve estar saudável e o repositório Restic produtivo deve estar
  operacional.
- A aplicação M5 permanece ativa durante este checkpoint. As migrations são
  aditivas e ainda não recebem tráfego do Marketing Ops novo.

### Comando exato

Execute o bloco inteiro no terminal da VPS. Ele para no primeiro erro:

```bash
set -euo pipefail
cd /opt/prometeus-marketing

test -z "$(git status --porcelain)"
test -f infra/postgres/migrations/0006_marketing_ops_core.sql
test -f infra/postgres/migrations/0016_marketing_ops_delegation_retry.sql
printf 'release_commit=%s\n' "$(git rev-parse --short HEAD)"

docker compose \
  --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  config --quiet

docker compose \
  --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  ps postgres

docker compose \
  --env-file /etc/ens/postgres.env \
  --profile ops \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  run --rm --no-deps postgres-backup

docker compose \
  --env-file /etc/ens/postgres.env \
  --profile tools \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  build --pull postgres-migrate

docker compose \
  --env-file /etc/ens/postgres.env \
  --profile tools \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  run --rm --no-deps postgres-migrate

migration_versions="$(docker compose \
  --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  exec -T postgres psql -U nexus_bootstrap -d nexus -Atc \
  "SELECT string_agg(version, ',' ORDER BY version) FROM infra.schema_migrations;")"
test "$migration_versions" = "0001,0002,0003,0004,0005,0006,0007,0008,0009,0010,0011,0012,0013,0014,0015,0016"
printf 'migration_versions=%s\n' "$migration_versions"

docker compose \
  --env-file /etc/ens/postgres.env \
  --profile tools \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  run --rm --no-deps postgres-migrate
```

### Impacto esperado

- Lê o estado do Git, renderiza o Compose e consulta a saúde do PostgreSQL.
- Cria um backup lógico/Restic pré-mudança e aplica a política de retenção já
  configurada.
- Reconstrói somente a imagem utilitária `postgres-migrate` no cache local.
- Aplica, sob advisory lock e uma transação por arquivo, as migrations canônicas
  ainda ausentes. Em uma base M5, o esperado é aplicar `0006`–`0016`.
- Não reinicia a aplicação, não ativa flags, não carrega dados e não remove
  container, rede, volume ou secret.

### Resultado/saída esperada

- `release_commit=<sha curto>` corresponde ao commit de release aprovado.
- `postgres` permanece `Up (healthy)` e sem porta publicada no host.
- O backup termina com código `0`, snapshot criado, retenção aplicada e status
  `ok`; nenhum valor de secret aparece.
- A primeira execução do migrator emite
  `database_migrations_complete`, com `0006`–`0016` em `applied` (ou em
  `skipped` apenas se já estiverem registradas com o mesmo checksum).
- A validação imprime exatamente
  `migration_versions=0001,...,0016`, sem lacuna ou versão desconhecida.
- A segunda execução termina com código `0` e todas as versões `0001`–`0016`
  em `skipped`, provando idempotência.

### Condição de parada

Pare imediatamente e não execute o Checkpoint 2 se ocorrer qualquer um destes
casos:

- árvore Git suja, arquivo `0006`/`0016` ausente ou commit diferente do aprovado;
- Compose inválido, PostgreSQL não saudável ou alguma porta do banco publicada;
- backup sem status `ok`, RPO fora do limite ou qualquer falha de Restic;
- checksum divergente, SQLSTATE, migration desconhecida, lacuna no ledger,
  advisory lock bloqueado ou código diferente de `0`;
- segredo, URL com senha, dado de usuário ou payload privado aparecer na saída.

### Rollback imediato

Se uma migration falhar, o runner reverte automaticamente a transação daquele
arquivo. Em qualquer falha, interrompa a release e mantenha os containers M5
atuais; eles não usam o schema novo. Não execute `DROP`, não edite o ledger e não
use `down --volumes`.

Confirme apenas que o banco anterior continua saudável:

```bash
cd /opt/prometeus-marketing
docker compose \
  --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  ps postgres
```

Se uma migration já tiver sido confirmada mas a validação posterior falhar, o
rollback seguro continua sendo **não avançar a release**. Preserve o backup e os
logs. Uma migration corretiva ou restauração em destino isolado só será liberada
após análise; nunca restaure por cima da base produtiva de forma improvisada.

### Evidência a devolver

Envie somente a saída redigida contendo:

- `release_commit`;
- linha de estado/health do PostgreSQL, ocultando IPs públicos;
- status final do backup, duração e idade/RPO, sem snapshot path sensível;
- os dois eventos `database_migrations_complete`;
- a linha `migration_versions=...`;
- código de saída final.

Remova e-mails, nomes, IP público, tokens, URLs de conexão, conteúdo de dados,
IDs de sessão e qualquer valor lido de secret. Após receber essa evidência, o
copiloto valida o Gate P1 e somente então prepara o Checkpoint 2.

## Registro dos checkpoints subsequentes

- Checkpoint 2 foi executado com atualização controlada, rollback images e
  serviços saudáveis.
- Checkpoint 3 foi encerrado com destino vazio por decisão do responsável e
  smoke HTTP 10/10. O smoke MCP de escrita apontou as flags antes da ativação,
  sem derrubar os containers.
- Checkpoint 4 comprovou leitura e preparação, mas não a execução. As flags
  foram ativadas com sucesso técnico, porém isso não fecha o gate funcional.

### Condição de retomada — atendida localmente

O Docker Desktop comprovou:

1. migration do plano durável e rollback por flag;
2. card vindo de resposta estruturada, sem parsing do texto do Hermes;
3. clique idempotente sem nova Run do agente;
4. negação cross-tenant, cross-user, expirada e com hash divergente;
5. plano inerte de approval criando exatamente uma solicitação `pending`.

O novo checkpoint deve novamente declarar impacto, resultado esperado, condição
de parada e rollback. Nenhuma credencial deve ser copiada para documentação ou
logs.
