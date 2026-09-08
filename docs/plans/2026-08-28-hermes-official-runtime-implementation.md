# Official Hermes Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `@executing-plans` to implement this plan task-by-task. Use `@test-driven-development` for every behavior change, `@hermes-agent` before relying on Hermes commands or configuration, and `@verification-before-completion` before claiming a gate complete.

**Goal:** entregar o marco M1 com o Hermes Agent oficial `0.20.6` executado pela imagem fixada, Profile Distribution ENS instalada de forma idempotente e dashboard temporário publicado com segurança pelo Traefik externo.

**Architecture:** o monorepo não contém o core Hermes. Um Compose dedicado usa a mesma imagem oficial em dois serviços sequenciais: `hermes-profile-init` modifica o volume persistente e termina; `hermes` só inicia após o sucesso do init. O runtime expõe a API apenas na rede Docker e o dashboard temporário via labels do Traefik. Desenvolvimento continua usando o Hermes oficial já instalado no Windows.

**Tech Stack:** Docker Compose v2, imagem oficial Nous Research, shell POSIX apenas dentro do container Linux, Node.js 22 para validadores e testes de contrato, Markdown para runbooks.

**Status:** Em execução — primeiro lote implementado em 2026-09-08  
**Marco:** M1  
**Requisitos:** RF-005, RF-006, RF-010 a RF-014; RNF-001 a RNF-003, RNF-007 a RNF-010  
**ADR:** [ADR-0001](../decisions/ADR-0001-official-hermes-container-and-ens-profile.md)  
**Desenho:** [Hermes oficial e Profile Distribution ENS](2026-08-28-hermes-official-runtime-design.md)

---

## Regras de execução

- Não instalar, atualizar, executar ou configurar o Hermes local sem autorização
  explícita do usuário; este é um computador corporativo.
- Não ler nem copiar `.hermes`, `auth.json`, memórias, sessões, bancos ou
  credenciais locais.
- Não usar o repositório histórico como origem de Compose; ele serve apenas para
  confirmar integração com o Traefik já existente.
- Não montar o Docker socket no Hermes.
- Não usar `latest`, tags flutuantes ou instalação via `curl | bash` em produção.
- Não subir init e runtime concorrentes no mesmo volume.
- Começar cada tarefa com teste falhando, implementar o mínimo e executar o teste
  novamente.
- Criar commits pequenos. Não incluir o `.env.example` local não rastreado nem
  qualquer segredo.

## Constantes aprovadas

```text
HERMES_VERSION=0.20.6
HERMES_IMAGE_TAG=v2026.8.27
HERMES_IMAGE=nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79
HERMES_PROFILE=ens
HERMES_API_PORT=8642
HERMES_DASHBOARD_PORT=9119
HERMES_DASHBOARD_HOST=hermes.solucoes-nexus.tech
```

Se o upstream contradisser um nome de variável durante a implementação, pare,
registre a evidência no desenho e ajuste este plano antes de prosseguir. Não
adivinhe compatibilidade.

## Registro de execução

| Data | Tarefa | Estado | Evidência |
| --- | --- | --- | --- |
| 2026-09-08 | 1. Contrato da distribuição | Concluída | Validador e 2 testes aprovados; `hermes_requires >=0.20.6`; nenhum segredo/provider distribuído |
| 2026-09-08 | 2. Inicializador idempotente | Implementada, gate Linux pendente | Contrato estrutural aprovado; 4 cenários POSIX automatizados ficaram skipped porque este Windows não possui shell POSIX e nada foi instalado |
| 2026-09-08 | 3. Compose base | Concluída estruturalmente | Compose v5.4.0 renderizou; 3 testes aprovados; imagem fixada por digest; API sem `ports`; sem Docker socket |

Commits do lote: `e819c04`, `cdf2fbd`, `e8f244d` na branch
`codex/hermes-m1`. Nenhuma imagem foi baixada e nenhum container foi iniciado.

Durante a Tarefa 1, a auditoria do tag fixado confirmou que o runtime `0.20.6`
ainda lê `mcp_servers` de `config.yaml`, não o `mcp.json` da distribuição. O
desenho registra a camada de compatibilidade adotada e o requisito de reavaliá-la
quando o pin mudar.

## Estrutura final esperada do marco

```text
agents/ens/
  distribution.yaml
  config.yaml
  mcp.json
  SOUL.md
  skills/
infra/hermes/
  compose.yaml
  compose.production.yaml
  hermes.env.example
  profile-init.sh
scripts/
  validate-hermes-distribution.mjs
  smoke-hermes-runtime.mjs
test/hermes/
  distribution-contract.test.mjs
  profile-init.test.mjs
  compose-contract.test.mjs
docs/operations/
  hermes-local-development.md
  hermes-first-deploy.md
  hermes-update-rollback.md
  hermes-backup-restore.md
```

---

### Task 1: Fixar e validar o contrato da Profile Distribution

**Files:**

- Create: `test/hermes/distribution-contract.test.mjs`
- Create: `scripts/validate-hermes-distribution.mjs`
- Modify: `agents/ens/distribution.yaml`
- Modify: `agents/ens/config.yaml`
- Modify: `agents/ens/mcp.json`
- Modify: `package.json`

**Step 1: Escrever o teste de contrato falhando**

O teste deve executar o validador em `agents/ens` e afirmar:

- `name` é exatamente `ens`;
- `hermes_requires` não aceita versão menor que `0.20.6`;
- `distribution_owned` contém somente caminhos existentes e não contém estado;
- `config.yaml` não define provider, modelo, token ou segredo;
- Marketing Ops aparece uma única vez na fonte canônica de MCP;
- variáveis usadas pelo profile estão declaradas em `env_requires`;
- nenhum arquivo rastreável possui nomes proibidos: `.env`, `auth.json`,
  `state.db`, `sessions`, `memories`, `mcp-tokens`.

Use `node:test`, `node:assert/strict` e `child_process.spawnSync`. Não adicione
dependência só para analisar YAML nesta tarefa; o validador pode fazer parsing
restrito dos campos do manifesto e JSON nativo para `mcp.json`.

**Step 2: Executar e observar a falha**

Run:

```powershell
rtk node --test test/hermes/distribution-contract.test.mjs
```

Expected: FAIL porque o validador ainda não existe e o requisito atual é
`>=0.12.0`.

**Step 3: Implementar o validador mínimo**

`scripts/validate-hermes-distribution.mjs` deve:

- receber o diretório como primeiro argumento, com default `agents/ens`;
- retornar código `0` e imprimir um resumo curto em sucesso;
- acumular todos os erros e retornar código `1`, sem parar no primeiro;
- não abrir arquivos fora do diretório resolvido;
- ignorar conteúdo de diretórios não versionados;
- exportar funções puras para o teste e executar CLI somente quando chamado como
  entrypoint.

**Step 4: Alinhar a distribuição**

- atualizar `hermes_requires` para o menor requisito upstream compatível
  confirmado para `0.20.6`;
- usar `config.yaml#mcp_servers` como fonte canônica do Marketing Ops no pin
  `0.20.6`, pois a auditoria confirmou que o runtime ainda não consome o
  `mcp.json` distribuído;
- manter `mcp.json` vazio e impedir duplicação entre as duas fontes;
- manter provider e modelo ausentes;
- manter `${NEXUS_MARKETING_OPS_MCP_URL}` como variável, nunca um endpoint real;
- não usar `--force-config` como solução para mudança de configuração.

**Step 5: Adicionar scripts raiz**

Adicionar em `package.json`:

```json
"test:hermes": "node --test test/hermes/*.test.mjs",
"validate:hermes-profile": "node scripts/validate-hermes-distribution.mjs agents/ens"
```

Incluir `npm run test:hermes` no agregador `test` somente quando todos os testes
do marco estiverem estáveis.

**Step 6: Verificar**

Run:

```powershell
rtk npm run validate:hermes-profile
rtk node --test test/hermes/distribution-contract.test.mjs
rtk git diff --check
```

Expected: comandos exit `0`; nenhum provider ou segredo encontrado.

**Step 7: Commit**

```powershell
rtk git add agents/ens package.json scripts/validate-hermes-distribution.mjs test/hermes/distribution-contract.test.mjs
rtk git commit -m "test(hermes): validate ENS profile distribution"
```

Critério atendido: RF-005, RF-006, RF-013, RNF-001.

---

### Task 2: Implementar o inicializador idempotente do profile

**Files:**

- Create: `infra/hermes/profile-init.sh`
- Create: `test/hermes/profile-init.test.mjs`

**Step 1: Criar um Hermes falso no teste**

O teste deve copiar `profile-init.sh` para um diretório temporário, colocar um
executável `hermes` falso primeiro no `PATH` e registrar argumentos em um arquivo.
Cubra três cenários:

1. `hermes profile info ens` falha: chama `profile install /distribution --name ens --yes`;
2. profile existe: chama `profile update ens --yes`;
3. install/update falha: não chama `profile use ens` e termina diferente de zero.

Em sucesso, o último comando deve ser `hermes profile use ens`. Em nenhum cenário
pode aparecer `--force-config`.

**Step 2: Executar e observar a falha**

```powershell
rtk node --test test/hermes/profile-init.test.mjs
```

Expected: FAIL porque `infra/hermes/profile-init.sh` ainda não existe.

**Step 3: Implementar o script mínimo**

Requisitos do script:

```sh
#!/bin/sh
set -eu

profile_name="${HERMES_PROFILE_NAME:-ens}"
distribution_dir="${HERMES_DISTRIBUTION_DIR:-/distribution}"

test -f "${distribution_dir}/distribution.yaml"

if hermes profile info "${profile_name}" >/dev/null 2>&1; then
  hermes profile update "${profile_name}" --yes
else
  hermes profile install "${distribution_dir}" --name "${profile_name}" --yes
fi

hermes profile use "${profile_name}"
hermes profile info "${profile_name}"
```

Antes de aceitar esse conteúdo, confirmar no tag `v2026.8.27` que `profile info`,
`install`, `update`, `use` e esses argumentos são suportados. Se a CLI oficial
divergir, atualizar teste e desenho com a forma confirmada.

**Step 4: Verificar cenários**

```powershell
rtk node --test test/hermes/profile-init.test.mjs
rtk rg --fixed-strings -- "--force-config" infra/hermes/profile-init.sh
```

Expected: teste PASS; `rg` não encontra ocorrência e retorna `1`, resultado
esperado para essa checagem negativa.

**Step 5: Commit**

```powershell
rtk git add infra/hermes/profile-init.sh test/hermes/profile-init.test.mjs
rtk git commit -m "feat(hermes): add idempotent ENS profile initializer"
```

Critério atendido: profile instalado/atualizado antes do runtime, sem sobrescrever
configuração manual.

---

### Task 3: Criar o Compose base fixado por digest

**Files:**

- Create: `infra/hermes/compose.yaml`
- Create: `infra/hermes/hermes.env.example`
- Create: `test/hermes/compose-contract.test.mjs`
- Modify: `.gitignore` somente se um nome de arquivo de exemplo precisar de exceção

**Step 1: Escrever teste estrutural falhando**

O teste deve executar `docker compose -f infra/hermes/compose.yaml config --format
json` quando Docker Compose estiver disponível. A inspeção do JSON deve provar:

- serviços exatos `hermes-profile-init` e `hermes`;
- ambos usam a mesma imagem com tag e digest aprovados;
- ambos usam o mesmo volume nomeado em `/opt/data`;
- somente init monta `../../agents/ens:/distribution:ro` e o script `:ro`;
- runtime depende de init com `condition: service_completed_successfully`;
- restart do init é `no` e do runtime é `unless-stopped`;
- nenhum serviço monta `/var/run/docker.sock`;
- API `8642` não aparece em `ports`;
- dashboard não é publicado pelo Compose base;
- há healthcheck para o runtime;
- `HERMES_HOME=/opt/data` e profile ativo é `ens`;
- arquivo não contém valor de provider ou segredo.

Se Docker Compose não existir, o teste deve ser marcado como skipped com mensagem
explícita, e um teste textual mínimo ainda deve verificar imagem/digest e ausência
do socket. O gate M1 não pode ser concluído com o teste principal skipped.

**Step 2: Executar e observar a falha**

```powershell
rtk node --test test/hermes/compose-contract.test.mjs
```

Expected: FAIL porque o Compose não existe.

**Step 3: Implementar `hermes.env.example`**

Documentar apenas chaves sem valores sensíveis:

```dotenv
HERMES_PROFILE_NAME=ens
NEXUS_MARKETING_OPS_MCP_URL=http://marketing-ops:3001/mcp
API_SERVER_KEY=
HERMES_DASHBOARD_OAUTH_CLIENT_ID=
HERMES_DASHBOARD_PUBLIC_URL=https://hermes.solucoes-nexus.tech
```

O arquivo precisa explicar que o operador cria um arquivo não versionado e gera
`API_SERVER_KEY` forte. Não duplicar o `.env.example` local existente do usuário.

**Step 4: Implementar o Compose base**

Use extensão YAML para centralizar imagem, volume e ambiente sem criar uma imagem
derivada. O init executa `/profile-init.sh`; o runtime usa o entrypoint oficial da
imagem. Configure os nomes oficiais confirmados no tag para:

- habilitar API em `0.0.0.0:8642` com `API_SERVER_KEY` obrigatório;
- habilitar dashboard em `0.0.0.0:9119`;
- apontar `HERMES_HOME` para `/opt/data`;
- preservar provider não configurado;
- selecionar o profile `ens` já ativado pelo init.

O healthcheck deve usar ferramenta já presente na imagem e consultar `/health`
localmente. Não instalar pacotes no startup e não depender de internet para
liveness.

**Step 5: Renderizar e validar**

Criar um arquivo de ambiente temporário com placeholders somente para renderizar;
nunca adicionar esse arquivo ao Git.

```powershell
rtk docker compose --env-file infra/hermes/hermes.env.example -f infra/hermes/compose.yaml config
rtk node --test test/hermes/compose-contract.test.mjs
rtk git diff --check
```

Expected: config válida, teste PASS, nenhuma porta publicada.

**Step 6: Commit**

```powershell
rtk git add .gitignore infra/hermes/compose.yaml infra/hermes/hermes.env.example test/hermes/compose-contract.test.mjs
rtk git commit -m "feat(hermes): define pinned official runtime compose"
```

Critério atendido: RF-012, RF-013, RNF-001 a RNF-003.

---

### Task 4: Adicionar exposição temporária do dashboard pelo Traefik

**Files:**

- Create: `infra/hermes/compose.production.yaml`
- Modify: `test/hermes/compose-contract.test.mjs`

**Step 1: Escrever testes negativos e positivos**

Renderizar os dois arquivos Compose juntos e afirmar:

- existe exatamente um router com regra
  `Host(\`hermes.solucoes-nexus.tech\`)`;
- router usa TLS e o cert resolver configurável aprovado;
- service Traefik aponta para a porta interna `9119`;
- não existe regra para `api-hermes`, porta `8642` ou endpoint `/v1`;
- não existe middleware de basic auth legado;
- autenticação do dashboard é Nous OAuth configurada no runtime;
- labels não exigem uma rede Docker `traefik` externa, pois o Traefik histórico
  confirmado usa Docker provider com `network_mode: host`;
- nenhuma porta do container é publicada diretamente no host.

**Step 2: Executar e observar a falha**

```powershell
rtk node --test test/hermes/compose-contract.test.mjs
```

Expected: FAIL nos casos de produção ainda ausentes.

**Step 3: Implementar o override**

Adicionar somente labels e variáveis específicas da exposição. Usar nomes de
router/service com prefixo `ens-hermes-dashboard`. Tornar host, entrypoint e cert
resolver configuráveis com defaults seguros quando o Compose permitir. O OAuth
client ID vem do arquivo de ambiente não versionado; não versionar client secret
se o upstream não exigir um.

**Step 4: Verificar configuração mesclada**

```powershell
rtk docker compose --env-file infra/hermes/hermes.env.example -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml config
rtk node --test test/hermes/compose-contract.test.mjs
rtk rg -n "api-hermes|8642.*loadbalancer|basicauth|docker.sock" infra/hermes
```

Expected: Compose e teste PASS; busca negativa sem ocorrências inseguras, exceto
referências explicativas claramente aceitas no teste.

**Step 5: Commit**

```powershell
rtk git add infra/hermes/compose.production.yaml test/hermes/compose-contract.test.mjs
rtk git commit -m "feat(hermes): route temporary dashboard through Traefik"
```

Critério atendido: RF-010, RNF-002, RNF-004, RNF-009.

---

### Task 5: Criar smoke test do runtime oficial

**Files:**

- Create: `scripts/smoke-hermes-runtime.mjs`
- Create: `test/hermes/smoke-client.test.mjs`
- Modify: `package.json`

**Step 1: Escrever teste contra servidor HTTP falso**

Subir um `node:http` local no próprio teste e cobrir:

- `/health` retorna sucesso sem inferir provider pronto;
- `/health/detailed` usa bearer token e interpreta `provider_unconfigured` como
  degradado esperado;
- `/v1/capabilities` confirma recursos necessários;
- timeout, 401 e JSON inválido produzem mensagens distintas e exit code `1`;
- logs nunca imprimem a chave completa.

**Step 2: Executar e observar a falha**

```powershell
rtk node --test test/hermes/smoke-client.test.mjs
```

Expected: FAIL porque o cliente não existe.

**Step 3: Implementar o smoke script**

Interface:

```text
node scripts/smoke-hermes-runtime.mjs \
  --base-url http://127.0.0.1:8642 \
  --api-key-env API_SERVER_KEY \
  --allow-provider-unconfigured
```

O script deve usar `fetch` nativo, `AbortSignal.timeout`, saída concisa e códigos
de erro. Por padrão, provider não configurado falha; somente a flag explícita
permite o estado durante o primeiro deploy.

**Step 4: Adicionar script npm e verificar**

Adicionar:

```json
"smoke:hermes": "node scripts/smoke-hermes-runtime.mjs"
```

Executar:

```powershell
rtk node --test test/hermes/smoke-client.test.mjs
rtk npm run test:hermes
```

Expected: PASS.

**Step 5: Commit**

```powershell
rtk git add package.json scripts/smoke-hermes-runtime.mjs test/hermes/smoke-client.test.mjs
rtk git commit -m "test(hermes): add authenticated runtime smoke checks"
```

Critério atendido: CA-006, RNF-007.

---

### Task 6: Documentar desenvolvimento local e primeiro deploy

**Files:**

- Create: `docs/operations/hermes-local-development.md`
- Create: `docs/operations/hermes-first-deploy.md`
- Modify: `docs/operations/README.md`
- Modify: `infra/README.md`

**Step 1: Criar checklist de revisão documental**

Antes dos runbooks, registrar no plano de trabalho uma checklist que exija:

- pré-requisitos;
- caminhos absolutos ou relativos ao repositório claramente identificados;
- resultado esperado por comando;
- nenhum valor secreto;
- rollback ou limpeza recuperável;
- diferenciação Windows local, Docker Desktop e VPS Linux.

**Step 2: Escrever `hermes-local-development.md`**

Cobrir:

- verificar versão do Hermes local sem atualizar;
- validar `agents/ens`;
- instalar/atualizar o profile somente após autorização do usuário;
- preservar provider/configuração já existentes;
- apontar o Bridge local para `http://127.0.0.1:8642`;
- quando o Bridge estiver em Docker Desktop, usar
  `http://host.docker.internal:8642`;
- executar smoke com `--allow-provider-unconfigured` quando aplicável;
- desfazer somente o profile criado pelo procedimento, nunca `.hermes` inteiro.

Não incluir `curl | bash` como passo rotineiro.

**Step 3: Escrever `hermes-first-deploy.md`**

Cobrir na ordem:

1. checar arquitetura da VPS e Docker Compose;
2. criar arquivo de ambiente fora do Git;
3. gerar `API_SERVER_KEY` de forma segura;
4. configurar OAuth/Public URL sem provider;
5. `docker compose config` e confirmação do digest;
6. backup do volume se já existir;
7. pull, init e inspeção do exit code;
8. iniciar runtime;
9. health, detailed health e capabilities;
10. validar HTTPS/dashboard e provar que a API pública não existe;
11. configurar provider manualmente pelo dashboard;
12. smoke final e coleta de evidências.

O runbook deve instruir o operador a interromper o deploy se o init falhar, sem
forçar startup do runtime.

**Step 4: Validar links e conteúdo proibido**

```powershell
rtk rg -n "curl.+install\.sh|API_SERVER_KEY=.+|auth\.json|docker\.sock" docs/operations infra/README.md
rtk git diff --check
```

Expected: nenhuma credencial ou instrução insegura; menções negativas devem ser
claramente contextuais.

**Step 5: Commit**

```powershell
rtk git add docs/operations infra/README.md
rtk git commit -m "docs(hermes): add local and first-deploy runbooks"
```

Critério atendido: RF-011 a RF-013, RNF-007 e continuidade operacional.

---

### Task 7: Documentar backup, atualização e rollback

**Files:**

- Create: `docs/operations/hermes-update-rollback.md`
- Create: `docs/operations/hermes-backup-restore.md`
- Modify: `docs/operations/README.md`

**Step 1: Escrever matriz de atualização**

O runbook deve separar:

- atualização da distribuição ENS, mantendo o mesmo core;
- atualização manual do core, alterando tag e digest juntos;
- rollback apenas da distribuição;
- rollback do core e restore de volume quando houver incompatibilidade.

**Step 2: Escrever processo de update/rollback**

Incluir:

- abrir PR com nova versão/digest e evidência upstream;
- conferir release, Docker manifest multiarch e mudanças de API/profile;
- executar todos os testes M1 no Docker Desktop;
- parar runtime antes de qualquer atualização do mesmo `HERMES_HOME`;
- criar backup consistente;
- executar init one-shot;
- subir runtime e rodar smoke;
- restaurar pin e volume compatível se falhar.

Registrar explicitamente que o botão de atualização do dashboard não substitui
esse processo e que não há automação de auto-update em produção.

**Step 3: Escrever processo de backup/restore**

O runbook deve usar um diretório de backup explicitamente configurado e validado,
nunca `$HOME`, `~`, `/` ou glob amplo. Antes de qualquer remoção ou substituição:

- resolver e imprimir o volume alvo;
- parar runtime e confirmar que init não está ativo;
- criar arquivo com timestamp, manifest de versão/digest e checksum;
- restaurar em volume de teste primeiro;
- executar `profile info`, health e smoke;
- registrar RPO/RTO observado, ainda que os objetivos finais estejam pendentes.

**Step 4: Revisar segurança e executar lint documental**

```powershell
rtk rg -n "latest|watchtower|auto.?update|rm -rf|docker.sock" docs/operations
rtk git diff --check
```

Expected: nenhum mecanismo automático ou comando destrutivo amplo. Ocorrências
em avisos precisam estar claramente marcadas como proibidas.

**Step 5: Commit**

```powershell
rtk git add docs/operations
rtk git commit -m "docs(hermes): define backup update and rollback procedures"
```

Critério atendido: RF-014, RNF-003, RNF-010.

---

### Task 8: Executar teste de paridade no Docker Desktop

**Files:**

- Modify: `docs/operations/hermes-first-deploy.md` com evidência do ensaio
- Modify: `docs/migration/roadmap.md`
- Modify: `MIGRATION_STATUS.md`

**Precondition:** autorização explícita do usuário para iniciar containers no
computador corporativo. Sem autorização, registrar **Bloqueado para ensaio**, não
simular sucesso e não executar Docker.

**Step 1: Verificar sem mudar estado**

```powershell
rtk docker version
rtk docker compose version
rtk docker compose --env-file <arquivo-local> -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml config
```

Expected: cliente/daemon acessíveis e configuração renderizada com digest exato.

**Step 2: Baixar a imagem somente com autorização**

```powershell
rtk docker pull nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79
```

Expected: digest resolvido corresponde ao aprovado.

**Step 3: Subir init e runtime**

Usar nome de projeto isolado e arquivo local de ambiente. Nunca usar dados reais
nem montar o Hermes local do Windows.

```powershell
rtk docker compose -p ens-hermes-m1 --env-file <arquivo-local> -f infra/hermes/compose.yaml up hermes-profile-init
rtk docker compose -p ens-hermes-m1 --env-file <arquivo-local> -f infra/hermes/compose.yaml up -d hermes
```

Expected: init exit `0`; runtime healthy; provider pode permanecer não
configurado.

**Step 4: Verificar runtime**

Executar health, detailed health, capabilities e o smoke autenticado a partir de
um contexto autorizado na rede. Confirmar:

- profile ativo `ens`;
- distribuição montada somente no init;
- nenhuma API publicada no host;
- dashboard não é público no Compose base;
- reiniciar runtime não executa init em paralelo;
- executar init novamente preserva configuração manual de teste.

**Step 5: Limpeza recuperável**

Parar o projeto isolado. Remover o volume de teste somente após identificar o
nome exato e receber autorização; por padrão, preservá-lo para inspeção.

```powershell
rtk docker compose -p ens-hermes-m1 --env-file <arquivo-local> -f infra/hermes/compose.yaml down
```

**Step 6: Registrar evidências**

Adicionar ao runbook data, versão do Docker, arquitetura, digest observado,
comandos, resultados e limitações. Não copiar tokens ou logs sensíveis.

**Step 7: Commit**

```powershell
rtk git add docs/operations/hermes-first-deploy.md docs/migration/roadmap.md MIGRATION_STATUS.md
rtk git commit -m "test(hermes): record Docker Desktop parity evidence"
```

Critério atendido: paridade local comprovada, ainda sem declarar deploy VPS.

---

### Task 9: Verificação final do marco M1

**Files:**

- Modify: `docs/migration/roadmap.md`
- Modify: `docs/operations/README.md`
- Modify: `MIGRATION_STATUS.md`
- Modify: este plano, marcando tarefas e evidências reais

**Step 1: Executar verificações automatizadas focadas**

```powershell
rtk npm run validate:hermes-profile
rtk npm run test:hermes
rtk docker compose --env-file infra/hermes/hermes.env.example -f infra/hermes/compose.yaml config
rtk docker compose --env-file infra/hermes/hermes.env.example -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml config
rtk git diff --check
```

Expected: todos exit `0`. O exemplo de env pode exigir placeholders próprios de
renderização documentados; nunca preencher com segredos.

**Step 2: Executar verificação do monorepo**

```powershell
rtk npm run verify:cut
rtk npm run test:chat-bridge
rtk npm run test:artifact-server
```

Registrar separadamente falhas legadas já conhecidas em frontend/Marketing Ops.
Não atribuir ao marco Hermes uma falha preexistente sem investigação.

**Step 3: Auditar exposição e segredos**

```powershell
rtk git grep -n -E "(API_SERVER_KEY=.+|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|docker.sock|api-hermes)"
rtk git status --short
```

Expected: nenhuma credencial, socket ou router público da API. Confirmar que o
`.env.example` local do usuário continua fora dos commits se ainda estiver
untracked.

**Step 4: Revisar os critérios do desenho**

Para cada item em
`docs/plans/2026-08-28-hermes-official-runtime-design.md#critérios-de-aceite`,
registrar uma destas situações:

- **Comprovado:** comando e resultado;
- **Bloqueado:** condição concreta e responsável;
- **Não iniciado:** nunca usar isso para fechar M1.

Deploy real e HTTPS na VPS não podem ser marcados como comprovados apenas pelo
Docker Desktop.

**Step 5: Atualizar estado documental**

Marcar M1 como **Concluído** somente se todos os critérios obrigatórios estiverem
comprovados. Caso o Compose esteja pronto mas ainda não implantado, usar **Pronto
para deploy**, registrar o próximo comando seguro e manter o gate aberto.

**Step 6: Commit final do marco**

```powershell
rtk git add docs/migration/roadmap.md docs/operations/README.md MIGRATION_STATUS.md docs/plans/2026-08-28-hermes-official-runtime-implementation.md
rtk git commit -m "docs(hermes): record M1 acceptance evidence"
```

---

## Gate de aceite M1

M1 só está concluído quando:

- [ ] distribuição ENS é válida no Hermes `0.20.6`;
- [ ] imagem oficial contém tag e digest exatos em todos os serviços;
- [ ] init instala, atualiza e seleciona `ens` de forma idempotente;
- [ ] init termina antes do runtime e nunca concorre no volume;
- [ ] provider permanece manual e configuração existente é preservada;
- [ ] API `8642` é interna e autenticada;
- [ ] dashboard `9119` usa rota TLS aprovada e Nous OAuth;
- [ ] não existe router público da API Hermes;
- [ ] health, detailed health e capabilities foram verificados;
- [ ] provider ausente aparece como degradado esperado, não como ready completo;
- [ ] nenhum Docker socket, segredo ou estado Hermes está no repositório;
- [ ] paridade Docker Desktop foi exercitada com autorização;
- [ ] primeiro deploy VPS foi exercitado ou o marco está explicitamente apenas
  **Pronto para deploy**;
- [ ] backup e restore foram testados;
- [ ] atualização e rollback manual foram ensaiados;
- [ ] runbooks registram evidências sem dados sensíveis.

## Continuação depois de M1

Não acoplar a reescrita completa do Chat Bridge a este gate. Depois de M1, criar
e aprovar um plano M2 específico para:

- cliente Hermes oficial e `/v1/capabilities`;
- Runs e SSE retomável;
- approve/reject/stop oficiais;
- remoção do websocket de aprovação do fork;
- persistência de runs/eventos no PostgreSQL quando M3 disponibilizar o banco;
- testes de contrato entre frontend, Bridge e runtime.

O roadmap é a fonte de verdade para a ordem e dependências desses marcos.

