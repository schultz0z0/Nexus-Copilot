# Runbook — M6 Marketing Ops e cutover

**Marco:** M6  
**Estado:** Gate funcional produtivo aprovado; Checkpoint 7 pendente
**Último gate local:** 2026-09-17
**Última homologação produtiva:** 2026-09-17
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

### Bloqueio observado após a implantação estruturada

O Checkpoint 5.0–5.3 foi executado na release `f2a598f`; o início do 5.4 parou
corretamente antes de qualquer escrita. A credencial oficial e o argumento MCP
tinham fingerprints, comprimentos, `jti` e escopos diferentes, embora
mantivessem `iat`, `exp` e Run. A causa é reconstrução do JWT pelo modelo, não
OAuth, clock, TTL, chaves ou refresh. Não reutilize a conversa da falha e não
aumente TTL como contorno. O próximo procedimento autorizado é o Checkpoint 6,
após aprovação do gate local da correção.

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
Os containers, redes e volumes criados especificamente pelo ensaio corrente
foram removidos; recursos locais preexistentes com prefixo semelhante não foram
alterados.

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

## Checkpoint 5 — execução estruturada em produção (preparado, não executado)

Este é o único checkpoint ainda aberto do M6. Ele deve ser executado pelo
responsável humano na VPS, uma etapa por vez, com validação entre etapas. O
commit de código aprovado pelo gate local é
`e9e3e3c2da1de51c1e13bffaeade30b0bd2f290e`. Um commit posterior que altere
somente esta documentação pode ser usado, desde que o commit aprovado continue
ancestral de `HEAD`.

### 5.0 — preflight de fonte e configuração

**Impacto:** somente leitura de Git, arquivos e configuração renderizada. Não
reinicia containers e não imprime valores de secrets.

```bash
set -euo pipefail
cd /opt/prometeus-marketing

approved_code_commit=e9e3e3c2da1de51c1e13bffaeade30b0bd2f290e
test "$(git branch --show-current)" = "main"
test -z "$(git status --porcelain)"
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git merge-base --is-ancestor "$approved_code_commit" HEAD

test -f /etc/ens/app.env
test -f /etc/ens/postgres.env
test -f /etc/ens/hermes.env
test -f infra/postgres/migrations/0017_marketing_ops_prepared_plans.sql

docker compose \
  --env-file /etc/ens/app.env \
  -f infra/app/compose.yaml \
  -f infra/app/compose.production.yaml \
  config --quiet

docker compose \
  --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  config --quiet

docker compose \
  --env-file /etc/ens/hermes.env \
  -f infra/hermes/compose.yaml \
  -f infra/hermes/compose.production.yaml \
  config --quiet

printf 'release_commit=%s\n' "$(git rev-parse HEAD)"
printf 'approved_code_commit=%s\n' "$approved_code_commit"
printf 'checkpoint_5_preflight=passed\n'
```

**Resultado esperado:** branch `main`, árvore limpa, `HEAD` igual a
`origin/main`, commit aprovado presente no histórico e os três arquivos Compose
válidos.

**Pare** se qualquer teste falhar, se aparecer conteúdo de secret, se houver
mudança local ou se o commit aprovado não for ancestral. Não use `reset`, não
force merge e não prossiga com um checkout divergente.

### 5.1 — backup e migration aditiva `0017`

**Impacto:** cria um snapshot lógico, reconstrói somente o migrator e cria a
tabela/políticas/índices aditivos de planos preparados. Os serviços atuais
continuam ativos e as flags estruturadas continuam desligadas.

```bash
set -euo pipefail
cd /opt/prometeus-marketing

postgres_compose=(
  docker compose
  --env-file /etc/ens/postgres.env
  --profile tools
  -f infra/postgres/compose.yaml
  -f infra/postgres/compose.production.yaml
)

docker compose \
  --env-file /etc/ens/postgres.env \
  --profile ops \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  run --rm --no-deps postgres-backup

"${postgres_compose[@]}" build --pull postgres-migrate
"${postgres_compose[@]}" run --rm --no-deps postgres-migrate
"${postgres_compose[@]}" run --rm --no-deps postgres-migrate

migration_versions="$(docker compose \
  --env-file /etc/ens/postgres.env \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  exec -T postgres psql -U nexus_bootstrap -d nexus -Atc \
  "SELECT string_agg(version, ',' ORDER BY version) FROM infra.schema_migrations;")"

test "$migration_versions" = "0001,0002,0003,0004,0005,0006,0007,0008,0009,0010,0011,0012,0013,0014,0015,0016,0017"
printf 'migration_versions=%s\n' "$migration_versions"
printf 'checkpoint_5_migration=passed\n'
```

**Resultado esperado:** backup com status `ok`; primeira execução aplica apenas
`0017` (ou a pula pelo mesmo checksum); segunda execução pula `0001`–`0017`; o
ledger contém exatamente `0001`–`0017`.

**Pare** em falha de backup, checksum divergente, SQLSTATE, ledger diferente ou
PostgreSQL não saudável. A migration é transacional e aditiva: não execute
`DROP`, não edite o ledger e não restaure sobre produção. Preserve o snapshot e
mantenha as flags desligadas enquanto a causa é analisada.

### 5.2 — imagens de rollback, flags e atualização controlada

**Impacto:** constrói as quatro imagens afetadas e recria, em sequência,
Marketing Ops, App API, Chat Bridge e Chat Web. A indisponibilidade esperada é
restrita às pequenas janelas de recriação de cada serviço. PostgreSQL, Artifact
Server e volumes não são recriados.

Antes do bloco, confirme que as duas chaves abaixo estão ausentes ou com valor
`false` em `/etc/ens/app.env`. O bloco não mostra nenhum valor secreto.

```bash
set -euo pipefail
cd /opt/prometeus-marketing

app_env=/etc/ens/app.env
release_short="$(git rev-parse --short HEAD)"
env_backup="${app_env}.pre-m6-structured-${release_short}-$(date -u +%Y%m%dT%H%M%SZ)"
cp --preserve=mode,ownership,timestamps -- "$app_env" "$env_backup"

app_compose=(
  docker compose
  --env-file "$app_env"
  -f infra/app/compose.yaml
  -f infra/app/compose.production.yaml
)

for service in marketing-ops app-api chat-bridge chat-web; do
  container_id="$("${app_compose[@]}" ps -q "$service")"
  test -n "$container_id"
  test "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")" = healthy
  docker image tag "$(docker inspect --format '{{.Image}}' "$container_id")" \
    "ens-rollback/${service}:pre-structured-${release_short}"
done

candidate="$(mktemp /etc/ens/app.env.structured.XXXXXX)"
trap 'rm -f -- "$candidate"' EXIT
cp -- "$app_env" "$candidate"
for key in MARKETING_OPS_STRUCTURED_PLAN_EXECUTION MARKETING_OPS_FRONTEND_STRUCTURED_PLAN_EXECUTION; do
  current="$(awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); found=1 } END { if (!found) print "absent" }' "$candidate")"
  test "$current" = false || test "$current" = absent
  if [ "$current" = absent ]; then
    printf '%s=false\n' "$key" >> "$candidate"
  fi
  sed -i "s/^${key}=false$/${key}=true/" "$candidate"
  test "$(grep -c "^${key}=true$" "$candidate")" -eq 1
done
chown --reference="$app_env" "$candidate"
chmod --reference="$app_env" "$candidate"
mv -- "$candidate" "$app_env"
trap - EXIT

"${app_compose[@]}" build --pull marketing-ops app-api chat-bridge chat-web

for service in marketing-ops app-api chat-bridge chat-web; do
  "${app_compose[@]}" up -d --no-build --no-deps --force-recreate \
    --wait --wait-timeout 180 "$service"
done

for service in artifact-server marketing-ops app-api chat-bridge chat-web; do
  container_id="$("${app_compose[@]}" ps -q "$service")"
  test -n "$container_id"
  test "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")" = healthy
  test -z "$(docker port "$container_id")"
  printf 'service=%s health=healthy published_ports=none\n' "$service"
done

printf 'app_env_backup=%s\n' "$env_backup"
printf 'checkpoint_5_application=passed\n'
```

**Resultado esperado:** quatro tags `ens-rollback/*`, flags estruturadas `true`,
imagens construídas e cinco serviços saudáveis sem portas publicadas. O Traefik
continua expondo somente o Chat Web pela rede Docker, não por `docker port`.

**Pare** no primeiro build/healthcheck malsucedido, em porta publicada, erro de
configuração ou resposta 5xx. Não avance ao Hermes nem ao navegador.

### 5.3 — profile ENS no Hermes oficial

**Impacto:** atualiza idempotentemente apenas o profile persistido em
`agents/ens`, recria o container oficial do Hermes e mantém seu volume. Não
modifica nem faz fork do core Hermes.

```bash
set -euo pipefail
cd /opt/prometeus-marketing

hermes_compose=(
  docker compose
  --env-file /etc/ens/hermes.env
  -f infra/hermes/compose.yaml
  -f infra/hermes/compose.production.yaml
)

"${hermes_compose[@]}" run --rm --no-deps hermes-profile-init
"${hermes_compose[@]}" run --rm --no-deps --entrypoint hermes \
  hermes-profile-init profile info ens
"${hermes_compose[@]}" up -d --no-build --no-deps --force-recreate \
  --wait --wait-timeout 180 hermes

hermes_id="$("${hermes_compose[@]}" ps -q hermes)"
test -n "$hermes_id"
test "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$hermes_id")" = healthy
docker exec "$hermes_id" hermes -p ens mcp test nexus_marketing_ops
printf 'checkpoint_5_hermes=passed\n'
```

**Resultado esperado:** profile ENS instalado/atualizado, Hermes saudável, MCP
conectado em `http://marketing-ops:8091/mcp` e exatamente 10 ferramentas
descobertas.

**Pare** se o profile pedir alteração no core, se a URL/porta divergir, se o
MCP não conectar ou se o número de ferramentas não for 10. Não altere arquivos
dentro da imagem ou do repositório público do Hermes.

### 5.4 — homologação autenticada no navegador

Use a conta administrativa descartável já destinada à homologação, sem copiar
senha, cookie ou token para terminal, documentação ou chat. No navegador:

1. abra `https://app.solucoes-nexus.tech/` e confirme a sessão autenticada;
2. abra a campanha de homologação criada do zero;
3. peça ao Hermes um plano operacional **inerte**, limitado a criar uma
   solicitação de approval, sem publicação, envio, upload ou integração externa;
4. confirme que aparece um card estruturado persistido, com ações legíveis,
   validade e o botão explícito **Executar plano**;
5. clique uma única vez e confirme que o botão entra em estado ocupado, sem
   pedir que a confirmação seja digitada no chat;
6. recarregue a página e confirme o resultado persistido;
7. consulte a campanha pelo Hermes e confirme que há exatamente uma solicitação
   de approval `pending`, ainda sem decisão;
8. não aprove nem execute qualquer efeito externo neste checkpoint.

**Resultado esperado:** o clique chama App API/BFF diretamente, não cria uma
segunda Run do Hermes, não expõe tokens no navegador e produz exatamente um
plano e um approval pendente mesmo após repetição técnica com a mesma chave.

**Pare** se o card vier de texto livre, se o botão não existir, se surgir nova
Run, se houver duplicidade, autorização cruzada, erro 5xx, mutação externa ou
qualquer token/secret na UI/log. Não tente contornar o bloqueio digitando uma
confirmação.

### 5.5 — evidência sanitizada e decisão

Devolva somente:

- `release_commit`, `approved_code_commit` e ledger `0001`–`0017`;
- status/health dos serviços e ausência de portas publicadas;
- status final do backup e idade/RPO, sem paths sensíveis;
- `profile info ens`, MCP conectado e contagem de 10 ferramentas;
- captura do card sem e-mail, cookie, token, IDs de sessão ou conteúdo privado;
- contagens: planos, approvals pendentes, decisões, ações externas e Runs do
  Bridge antes/depois do clique;
- logs redigidos por correlation ID, nunca headers ou payloads completos.

O M6 só pode ser marcado **Concluído** após revisão dessa evidência. Ausência de
erro visual, isoladamente, não fecha o gate.

### Rollback do Checkpoint 5

O rollback preferencial é desligar somente as duas flags, reconstruir o Chat Web
e recriar Marketing Ops e Chat Web. Isso preserva tabela, planos e trilha de
auditoria:

```bash
set -euo pipefail
cd /opt/prometeus-marketing
app_env=/etc/ens/app.env
app_compose=(
  docker compose
  --env-file "$app_env"
  -f infra/app/compose.yaml
  -f infra/app/compose.production.yaml
)

sed -i \
  -e 's/^MARKETING_OPS_STRUCTURED_PLAN_EXECUTION=true$/MARKETING_OPS_STRUCTURED_PLAN_EXECUTION=false/' \
  -e 's/^MARKETING_OPS_FRONTEND_STRUCTURED_PLAN_EXECUTION=true$/MARKETING_OPS_FRONTEND_STRUCTURED_PLAN_EXECUTION=false/' \
  "$app_env"

test "$(grep -c '^MARKETING_OPS_STRUCTURED_PLAN_EXECUTION=false$' "$app_env")" -eq 1
test "$(grep -c '^MARKETING_OPS_FRONTEND_STRUCTURED_PLAN_EXECUTION=false$' "$app_env")" -eq 1

"${app_compose[@]}" build chat-web
"${app_compose[@]}" up -d --no-build --no-deps --force-recreate \
  --wait --wait-timeout 180 marketing-ops chat-web
printf 'checkpoint_5_flag_rollback=passed\n'
```

Se houver regressão binária fora da feature, pare o tráfego de homologação,
restaure o backup de `/etc/ens/app.env` indicado pelo bloco 5.2, reaplique as
tags `ens-rollback/<serviço>:pre-structured-<release_short>` como imagens locais
e recrie somente os serviços afetados. Não remova a migration `0017`, não apague
registros de plano/approval e não execute `down --volumes`. Restauração de banco
só pode ocorrer em destino isolado após diagnóstico e autorização humana.

## Checkpoint 6 — delegação opaca por Run (gate local aprovado; não executado na VPS)

Este checkpoint substitui somente a passagem da credencial entre Chat Bridge,
Hermes e Marketing Ops. Não altera banco, migration `0017`, App API, Chat Web,
card ou semântica do botão. O commit candidato de código é
`5b6d0b68266bc7b70cfd57a08bbdfafb4a397a32`. As suítes integrais registradas no
plano TDD estão verdes; a execução produtiva só é autorizada depois que esse
commit estiver em `main`/`origin/main`.

### Evidência local da correção

- frontend 193/193;
- Marketing Ops 291 aprovados e 2 E2E deliberadamente ignorados;
- Chat Bridge 131/131, Artifact Server 13/13 e App API 87/87;
- typechecks e builds de produção aprovados;
- contratos App 11/11, Hermes 22/22 e profile ENS válido;
- stack descartável: MCP com 10 ferramentas, Playwright real aprovado, smoke
  14/14, 1 plano, 1 approval `pending`, 0 decisões, 0 ações externas e rollback
  por flags aprovado.

### 6.0 — preflight do candidato

**Impacto:** somente leitura. Não reinicia containers nem imprime secrets.

```bash
set -euo pipefail
cd /opt/prometeus-marketing

opaque_code_commit=5b6d0b68266bc7b70cfd57a08bbdfafb4a397a32
test "$(git branch --show-current)" = main
test -z "$(git status --porcelain)"
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git merge-base --is-ancestor "$opaque_code_commit" HEAD

test "$(awk -F: '/^version:/ { gsub(/[[:space:]]/, "", $2); print $2 }' agents/ens/distribution.yaml)" = 0.1.2

docker compose \
  --env-file /etc/ens/app.env \
  -f infra/app/compose.yaml \
  -f infra/app/compose.production.yaml \
  config --quiet

printf 'release_commit=%s\n' "$(git rev-parse HEAD)"
printf 'opaque_code_commit=%s\n' "$opaque_code_commit"
printf 'checkpoint_6_preflight=passed\n'
```

**Resultado esperado:** `main` limpa e sincronizada, commit candidato ancestral,
profile `ens@0.1.2` e Compose válido.

**Pare** em qualquer divergência, árvore suja, falha de fetch, commit ausente ou
configuração inválida. Não use `reset`, merge forçado ou edição manual dentro de
container.

### 6.1 — rollback local e atualização dos dois serviços

**Impacto:** constrói Chat Bridge e Marketing Ops e os recria sequencialmente.
Há duas janelas curtas de indisponibilidade interna; PostgreSQL, App API, Chat
Web, Artifact Server, Hermes e volumes não são recriados.

```bash
set -euo pipefail
cd /opt/prometeus-marketing

app_compose=(
  docker compose
  --env-file /etc/ens/app.env
  -f infra/app/compose.yaml
  -f infra/app/compose.production.yaml
)
release_short="$(git rev-parse --short HEAD)"

for service in chat-bridge marketing-ops; do
  container_id="$("${app_compose[@]}" ps -q "$service")"
  test -n "$container_id"
  test "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")" = healthy
  docker image tag "$(docker inspect --format '{{.Image}}' "$container_id")" \
    "ens-rollback/${service}:pre-opaque-${release_short}"
done

"${app_compose[@]}" build --pull chat-bridge marketing-ops

for service in chat-bridge marketing-ops; do
  "${app_compose[@]}" up -d --no-build --no-deps --force-recreate \
    --wait --wait-timeout 180 "$service"
done

for service in artifact-server marketing-ops app-api chat-bridge chat-web; do
  container_id="$("${app_compose[@]}" ps -q "$service")"
  test -n "$container_id"
  test "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")" = healthy
  test -z "$(docker port "$container_id")"
  printf 'service=%s health=healthy published_ports=none\n' "$service"
done

printf 'checkpoint_6_application=passed\n'
```

**Resultado esperado:** duas tags de rollback, imagens novas e todos os cinco
serviços saudáveis e privados.

**Pare** no primeiro build/healthcheck malsucedido, em porta publicada ou 5xx.
Não abra o navegador e não repita uma Run antiga.

### 6.2 — atualização do profile ENS

**Impacto:** atualiza somente a distribuição ENS persistida para `0.1.2` e
recria o container oficial preservando o volume. Não altera o core Hermes.

```bash
set -euo pipefail
cd /opt/prometeus-marketing

hermes_compose=(
  docker compose
  --env-file /etc/ens/hermes.env
  -f infra/hermes/compose.yaml
  -f infra/hermes/compose.production.yaml
)

"${hermes_compose[@]}" run --rm --no-deps hermes-profile-init
"${hermes_compose[@]}" run --rm --no-deps --entrypoint hermes \
  hermes-profile-init profile info ens
"${hermes_compose[@]}" up -d --no-build --no-deps --force-recreate \
  --wait --wait-timeout 180 hermes

hermes_id="$("${hermes_compose[@]}" ps -q hermes)"
test -n "$hermes_id"
test "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$hermes_id")" = healthy
docker exec "$hermes_id" hermes -p ens mcp test nexus_marketing_ops
printf 'checkpoint_6_hermes=passed\n'
```

**Resultado esperado:** `ens@0.1.2`, Hermes saudável, MCP conectado na porta
8091 e 10 ferramentas descobertas.

**Pare** se a versão divergir, se houver pedido de patch no core, MCP offline ou
contagem diferente de 10.

### 6.3 — smoke técnico antes do navegador

**Impacto:** somente requisições de leitura e testes negativos. Não prepara nem
executa plano.

Execute o smoke consolidado já usado no Checkpoint 5 e confirme, adicionalmente:

- Chat Bridge e Marketing Ops saudáveis após pelo menos dois healthchecks;
- `MARKETING_OPS_DELEGATION_RESOLVE_URL` existe dentro do Marketing Ops e aponta
  para `http://chat-bridge:8080/internal/marketing-ops/delegations/resolve`;
- a rota de resolução não está publicada pelo Traefik ou por porta do host;
- o MCP continua com 10 ferramentas.

**Resultado esperado:** smoke integral verde, nenhuma mutação e nenhuma
credencial exibida.

**Pare** em falha, degradação nova, rota pública, restart de container ou log
contendo credencial. Não imprima o valor de `MARKETING_OPS_INTERNAL_KEY`.

### 6.4 — homologação autenticada em conversa nova

Uma referência vive somente durante uma Run. Portanto, abra uma conversa nova;
não reutilize a sessão da falha nem qualquer Run anterior ao deploy.

1. Faça a consulta somente-leitura das campanhas e confirme a campanha de
   homologação.
2. Peça um plano operacional inerte com exatamente uma solicitação de approval,
   sem publicação, envio, upload ou integração externa.
3. Confirme que a preparação termina sem `delegation_invalid` e que surge o card
   estruturado persistido com **Executar plano**.
4. Antes do clique, registre somente contagens sanitizadas: uma referência
   `mopref_...` presente no histórico interno da Run e zero strings com formato
   JWT. Não imprima a referência.
5. Clique uma vez. Confirme estado ocupado, ausência de nova Run e resultado
   persistido após recarregar.
6. Confirme exatamente um plano executado, um approval `pending`, zero decisões
   e zero ações externas.

**Resultado esperado:** o modelo só transporta a referência opaca; o JWT nasce
e é validado servidor a servidor; o clique chama apenas App API/BFF e é
idempotente.

**Pare** se houver `delegation_invalid`, JWT no histórico do Hermes, referência
em UI/log, ausência do card, nova Run no clique, duplicidade, decisão automática
ou efeito externo. Não aumente TTL, não edite token e não tente confirmar por
texto.

### 6.5 — aprovação humana por segundo gestor

Uma solicitação operacional não pode ser decidida pelo mesmo ator que a criou.
Isso é uma separação de funções deliberada: para validar a decisão humana, use
um segundo usuário `manager` ou `admin` do **mesmo tenant**.

O painel administrativo depende da App API executar as consultas em contexto
transacional (`app.user_id` e `app.tenant_id`). A migration
`0018_iam_admin_tenant_rls.sql` completa as políticas de RLS necessárias para
listar e gerir apenas os principals/memberships do tenant corrente. Não crie
usuários por SQL manual, não altere políticas diretamente na VPS e não reutilize
o solicitante como aprovador.

**Regressão identificada em 2026-09-17:** mesmo com `0018` aplicada, a primeira
tentativa de criar o segundo gestor retornou `42501` em `iam.principals`. A causa
não é falta de contexto nem de grants: PostgreSQL aplica a política `SELECT` ao
`INSERT ... RETURNING`; naquele ponto a membership ainda não existe e a política
tenant-scoped não pode enxergar o principal recém-inserido. A correção na App API
remove o `RETURNING`, usa o UUID já gerado pela aplicação e só devolve o objeto
após concluir, na mesma transação, principal, credencial e membership. O teste de
regressão falha se o insert voltar a depender de `RETURNING`. Esta correção exige
apenas rebuild/recreate da App API; não requer migration adicional nem alteração
manual de RLS na VPS.

Depois de aplicar a release que contém a migration `0018` e recriar a App API:

1. Como admin, confira que `/admin/users` lista os membros do tenant e crie o
   segundo manager pelo próprio painel.
2. Faça login como esse segundo manager, abra a solicitação pendente e confira
   que ela continua `operational`, `low`, `sandbox`, inerte e sem alvos externos.
3. Decida uma única vez e registre somente as contagens sanitizadas: um plano
   `completed`, um approval `approved`, uma decisão e zero ações externas.

**Homologação registrada em 2026-09-16:** a criação de um segundo `manager` pelo
painel foi concluída após a correção da App API; esse ator decidiu uma única vez
o pacote operacional inerte. A verificação no PostgreSQL confirmou exatamente um
plano `completed` com `max_execution_attempts=1`, uma solicitação `approved` e
uma decisão `approved`. O pacote permaneceu `sandbox`, sem audiência, envio,
upload, publicação, integração externa ou outra mutação externa. O fluxo
funcional de segregação e aprovação humana deste checkpoint está aprovado.

O M6 permanece aberto exclusivamente para a melhoria de UX já planejada: o chat
deve reter um recibo terminal, persistente e legível após o clique em **Executar
plano**, deixando claro se a execução foi concluída, falhou ou resultou em
approval pendente. Essa melhoria não altera a decisão já registrada nem reabre
o pacote homologado.

**Pare** se o painel não listar os usuários do tenant, se a criação retornar
5xx, se o aprovador for o solicitante, se a solicitação divergir do pacote
inerte ou se houver qualquer efeito externo. O rollback da correção é reverter
somente a App API para a imagem marcada antes do deploy; a migration é
aditiva e não deve ser removida em produção.

### Rollback do Checkpoint 6

Interrompa a homologação. Reaponte localmente as imagens dos dois serviços para
as tags `ens-rollback/<serviço>:pre-opaque-<release_short>` e recrie apenas
Chat Bridge e Marketing Ops com `--no-build --no-deps --force-recreate --wait`.
Mantenha migration `0017`, flags, dados e volumes. O profile `0.1.2` pode
permanecer instalado durante a investigação, mas nenhuma escrita deve ser
homologada com os serviços revertidos. Não execute `down --volumes`, não apague
planos/approvals e não restaure banco em produção.

## Checkpoint 7 — recibos persistentes e planos sequenciais no mesmo chat

Este é o último checkpoint aberto do M6. Ele implanta somente a melhoria descrita
no [desenho de recibos e planejamento sequencial](../plans/2026-09-17-m6-plan-receipts-and-sequential-planning-design.md)
e no [plano TDD](../plans/2026-09-17-m6-plan-receipts-and-sequential-planning-implementation.md).
Um plano continua sendo um único card e pode conter várias ações. O objetivo é
preservar esse card como recibo terminal e permitir que um pedido posterior gere
outro plano independente na mesma conversa.

### Evidência local do Checkpoint 7

- profile ENS `0.1.3` e contrato do Chat Bridge exigem nova Run e nova referência
  opaca para um novo pedido, sem herdar autorização do histórico;
- a preparação é serializada por tenant, ator e chat; uma nova versão invalida o
  plano pendente anterior e somente um card permanece executável;
- a leitura de planos recentes é actor-scoped, limitada e sanitizada; não expõe
  credenciais, chaves de idempotência, payload interno nem referências opacas;
- o card terminal diferencia `completed`, `partial`, `failed`, `expired` e
  `invalidated`, sobrevive ao reload e nunca reexibe **Executar plano**;
- a criação de approval é apresentada como **pendente**, não como decisão
  aprovada; deep links desconhecidos ou externos são descartados;
- migrations `0001`–`0018` e replay idempotente passaram no PostgreSQL isolado;
- frontend 197/197, Marketing Ops 296 aprovados + 2 E2E ignorados, Chat Bridge
  131/131, Artifact Server 13/13, App API 88/88, contratos App 11/11 e Hermes
  23/23 passaram; typechecks, builds e validação do profile também passaram.

### 7.0 — pré-condições e sincronização da release

**Impacto:** atualiza somente o checkout Git. Não altera containers, banco,
profile ou tráfego.

1. O operador deve receber o SHA completo anunciado para a release e atribuí-lo
   a `target_commit`; não use um SHA abreviado nem aceite outro `origin/main`.
2. Confirme branch `main`, árvore limpa e commit atual conhecido.
3. Execute `git fetch origin main`, compare `origin/main` ao SHA anunciado e faça
   somente `git merge --ff-only origin/main`.
4. Confirme `agents/ens/distribution.yaml` em `0.1.3` e a presença dos dois
   documentos do Checkpoint 7.

**Resultado esperado:** árvore limpa, `HEAD` exatamente no SHA anunciado e
profile `0.1.3` presente.

**Pare** em árvore suja, branch divergente, merge não fast-forward, SHA diferente
ou arquivo ausente. Não faça reset, checkout destrutivo ou stash automático.

### 7.1 — rollback images e build dos serviços afetados

**Impacto:** cria tags locais de rollback e reconstrói imagens sem reiniciar os
containers ativos. PostgreSQL e dados não são alterados.

1. Confirme `healthy` para `marketing-ops`, `chat-bridge` e `chat-web`.
2. Marque as imagens atuais como
   `ens-rollback/<serviço>:pre-plan-receipts-<release_short>`.
3. Construa `marketing-ops`, `chat-bridge` e `chat-web` com os mesmos arquivos
   Compose de produção e `--pull`.
4. Confirme que as três imagens novas existem antes de recriar qualquer serviço.

**Resultado esperado:** três tags de rollback válidas e três imagens novas,
enquanto a stack antiga continua saudável.

**Pare** se um serviço não estiver saudável, uma imagem/tag não existir ou o
build falhar. Não execute `down`, não remova volumes e não faça prune.

### 7.2 — recriação progressiva e atualização do profile

**Impacto:** pequenas interrupções isoladas por serviço. Não reinicia PostgreSQL,
Artifact Server ou App API e não publica portas novas.

1. Recrie primeiro `marketing-ops`, depois `chat-bridge` e por último `chat-web`,
   sempre com `--no-build --no-deps --force-recreate --wait`.
2. Após cada recriação, confirme container `running` e `healthy`; confirme também
   que todos os demais serviços continuam saudáveis e sem portas publicadas.
3. Execute `hermes-profile-init`, confirme `ens@0.1.3`, recrie somente `hermes`
   e rode `hermes -p ens mcp test nexus_marketing_ops`.
4. Confirme exatamente 10 ferramentas MCP e nenhum restart inesperado.

**Resultado esperado:** serviços afetados e Hermes saudáveis, profile `0.1.3`,
MCP privado conectado e 10 ferramentas descobertas.

**Pare** no primeiro healthcheck vermelho, porta pública, versão divergente,
contagem diferente de ferramentas ou pedido de alteração no core do Hermes.

### 7.3 — smoke técnico antes do navegador

**Impacto:** apenas leituras e testes negativos; não prepara nem executa plano.

1. Rode o smoke consolidado da stack e confirme todos os serviços saudáveis.
2. Confirme que `GET /v1/agent-plans?status=all&limit=10` continua protegido por
   autenticação e que o navegador o acessa somente pela App API/BFF.
3. Confirme que Chat Bridge e Marketing Ops não publicam portas nem rotas
   Traefik e que nenhum log contém JWT, `mopref_`, secret ou chave de execução.

**Resultado esperado:** smoke integral verde, nenhuma escrita e nenhuma
credencial exposta.

**Pare** em 5xx, restart, rota pública, bypass do BFF ou dado sensível em log.

### 7.4 — homologação manual autenticada

Use uma conversa já capaz de executar planos e mantenha as ações em sandbox ou
de baixo risco durante este checkpoint.

1. Peça um plano único com uma ou mais ações relacionadas. Confirme somente um
   card pendente e um único botão **Executar plano**.
2. Clique uma vez. Confirme estado ocupado e, ao terminar, um recibo explícito:
   conclusão total, parcial, falha ou approval criado como **pendente**.
3. Recarregue a página. O mesmo card deve continuar visível como recibo terminal,
   sem botão de execução e sem criar nova Run.
4. No **mesmo chat**, faça um pedido posterior e diferente. Não escreva “autorizo
   novamente”. O Hermes deve abrir uma nova Run, usar somente a nova referência
   opaca e preparar outro card normalmente.
5. Antes de executar o novo card, peça uma revisão dele. A versão anterior deve
   aparecer como **Substituído** e somente a versão mais nova pode ter botão.
6. Execute a versão nova uma única vez. Confirme que o recibo anterior permanece,
   o novo recibo é persistido e nenhum card terminal volta a ser executável.
7. Se houver approval, valide a decisão humana pelo segundo gestor já criado; o
   chat não deve afirmar que a solicitação foi aprovada no momento da criação.

**Resultado esperado:** vários planos históricos podem coexistir no chat, cada
qual em um card; no máximo um fica pendente/executável. Cada pedido posterior usa
nova Run/ref, não herda autorização e não exige confirmação textual interpretada
pelo modelo.

**Pare** se houver dois botões executáveis, desaparecimento do recibo após reload,
recusa indevida de novo planejamento, reutilização da Run/ref, nova Run causada
pelo clique, duplicidade, status falso de aprovação ou qualquer efeito externo
não revisado no card.

### 7.5 — evidência sanitizada e critério de fechamento

Registre sem payloads ou credenciais:

- contagem e status dos planos da conversa, ordenados por criação;
- `max(execution_attempts)` por plano terminal, que deve ser `1`;
- no máximo um plano `pending` para tenant, ator e chat;
- contagem de approvals e decisões, quando aplicável;
- ausência de JWT e referência opaca no histórico visível e nos logs coletados;
- saúde final dos serviços e SHA integral implantado.

O M6 só muda para **Concluído** após todas as evidências acima e a percepção de
UX serem aprovadas pelo responsável. Até lá, o estado permanece Checkpoint 7
pendente.

### Rollback do Checkpoint 7

Interrompa novos testes. Reaponte as imagens `marketing-ops`, `chat-bridge` e
`chat-web` para `ens-rollback/<serviço>:pre-plan-receipts-<release_short>` e
recrie apenas esses serviços, um por vez, com espera de saúde. Reinstale o profile
ENS anterior somente se o contrato `0.1.3` estiver implicado; não modifique o core
do Hermes. Preserve migrations `0017`/`0018`, planos, approvals, decisões,
volumes e banco. Não execute `down --volumes`, restore ou exclusão manual de
registros. Depois do rollback, mantenha escrita/approvals suspensos até análise.
