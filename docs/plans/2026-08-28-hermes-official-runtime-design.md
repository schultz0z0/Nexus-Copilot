# Hermes oficial e Profile Distribution ENS

Status: aprovado para planejamento da implementação.

Data: 2026-08-28.

## Contexto

O ENS precisa de um único agente compartilhado pelo produto, executável no ambiente de desenvolvimento e na VPS sem manter um fork ou uma cópia do core do Hermes Agent no monorepo.

O repositório histórico `projeto-ens-unificado` permanece somente como fonte de investigação. Seus contratos de produto, domínios, labels do Traefik e fluxos que já funcionam podem orientar a migração, mas o runtime Hermes vendorizado, as adaptações do fork, Supabase, Graph MCP, Neo4j e RAG MCP não fazem parte da arquitetura nova.

## Objetivos

- executar o core oficial do Hermes Agent sem alterações;
- manter toda personalização ENS em `agents/ens`;
- usar o Hermes local já instalado no Windows durante o desenvolvimento;
- executar o Hermes em produção por Docker Compose na VPS Linux;
- manter a API do Hermes interna e acessível somente pelo Chat Bridge;
- publicar temporariamente o dashboard oficial em `hermes.solucoes-nexus.tech`;
- permitir configuração manual do provider e modelo pelo dashboard;
- preservar credenciais, sessões, memória e configuração local durante atualizações;
- tornar instalação, atualização e rollback explícitos, auditáveis e reproduzíveis.

## Não objetivos

- vendorizar, bifurcar ou modificar o core do Hermes Agent;
- construir uma imagem ENS derivada do Hermes;
- instalar o Hermes dentro da árvore do monorepo;
- permitir que o navegador acesse o Hermes diretamente;
- publicar a API do Hermes na internet;
- automatizar atualizações do core;
- configurar provider, modelo ou credenciais do LLM durante o deploy;
- reintroduzir Supabase, Graph MCP, Neo4j ou o runtime legado.

## Decisão

Adotar a imagem oficial do Hermes Agent em produção, fixada por tag e digest OCI, e uma Profile Distribution ENS separada. O runtime oficial será imutável; todo estado mutável ficará em `/opt/data`.

Versão inicial aprovada:

```text
Hermes Agent: 0.20.6
Release:      v2026.8.27
Commit:       5fc308a70719a83cccdbba4c0e39c23f5a8239d5
Imagem:       nousresearch/hermes-agent:v2026.8.27
Digest OCI:   sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79
```

Referência que deverá aparecer no Compose:

```text
nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79
```

O digest é o manifest OCI multi-arquitetura. A tag e o commit da release não possuem assinatura criptográfica verificada pelo GitHub. A origem é a organização oficial e a imagem é publicada pelo workflow oficial após testes, mas essa limitação deve permanecer registrada. Fixar o digest impede que uma alteração futura da tag troque silenciosamente os bytes executados.

## Auditoria do upstream

A auditoria foi realizada contra a tag `v2026.8.27`, não somente contra a documentação em `main`.

O upstream confirma:

- `/opt/hermes` é a árvore imutável da aplicação;
- `/opt/data` é o `HERMES_HOME` persistente;
- o bootstrap usa privilégios apenas para preparar volume, UID/GID e migrações;
- gateway, dashboard e comandos principais são rebaixados para o usuário `hermes`;
- `s6-overlay` supervisiona gateway, dashboard e gateways de profiles;
- a imagem contém Python, Node, Chromium/Playwright, Git, ffmpeg, ripgrep e dependências principais;
- a publicação gera imagens AMD64 e ARM64 e executa testes Docker antes de publicar;
- o código da imagem registra o commit usado no build;
- imagens Docker recusam atualização interna por `hermes update` ou pelo botão do dashboard;
- atualizações de imagem preservam `/opt/data` e executam migrações de configuração com backup;
- a API oficial fornece Runs, SSE, sessões, aprovação, interrupção e capabilities;
- Profile Distributions podem ser instaladas a partir de um diretório local;
- atualização de uma distribuição preserva `.env`, `auth.json`, memória, sessões, banco de estado e logs;
- dashboard em bind não loopback exige um provedor de autenticação e falha fechado sem ele.

Referências:

- [release v2026.8.27](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.27);
- [Dockerfile v2026.8.27](https://github.com/NousResearch/hermes-agent/blob/v2026.8.27/Dockerfile);
- [workflow de publicação Docker](https://github.com/NousResearch/hermes-agent/blob/v2026.8.27/.github/workflows/docker.yml);
- [documentação Docker v2026.8.27](https://github.com/NousResearch/hermes-agent/blob/v2026.8.27/website/docs/user-guide/docker.md);
- [API Server v2026.8.27](https://github.com/NousResearch/hermes-agent/blob/v2026.8.27/website/docs/user-guide/features/api-server.md);
- [Profile Distributions v2026.8.27](https://github.com/NousResearch/hermes-agent/blob/v2026.8.27/website/docs/user-guide/profile-distributions.md);
- [atualizações v2026.8.27](https://github.com/NousResearch/hermes-agent/blob/v2026.8.27/website/docs/getting-started/updating.md).

## Topologia

```text
Internet
   |
   v
Traefik existente na VPS
   |-------------------------------> hermes.solucoes-nexus.tech
   |                                      |
   |                                      v
   |                                Dashboard Hermes :9119
   |
   v
Frontend -> App API/BFF -> Chat Bridge -> Hermes API :8642
                              |               |
                              |               v
                              |         Profile ENS ativo
                              |               |
                              |               v
                              +--------> MCPs internos
                                              |
                                              +-> Marketing Ops
                                              +-> Artifact Server

PostgreSQL <- App API/BFF / Chat Bridge / serviços autorizados
```

O navegador conversa com a App API/BFF. O Chat Bridge é o único consumidor normal da API do Hermes. O dashboard é uma superfície administrativa separada e autenticada.

## Ambientes

### Desenvolvimento no Windows

- usar o Hermes Desktop/CLI oficial já instalado localmente;
- não executar o container Hermes por padrão;
- apontar o Chat Bridge para o Hermes local;
- quando o Bridge estiver em container, usar o endereço de host disponibilizado pelo Docker Desktop;
- instalar ou atualizar a distribuição a partir do diretório local `agents/ens`;
- manter credenciais, memórias e sessões no `HERMES_HOME` local, fora do Git;
- disponibilizar futuramente um profile opcional de Compose somente para testes de paridade com produção.

O instalador correto para Windows nativo é o `install.ps1` oficial. O `install.sh` é destinado a Linux, macOS, WSL2 e Termux. Nenhum instalador será executado automaticamente pelo monorepo.

### Produção na VPS Linux

- executar PostgreSQL, App API/BFF, Chat Bridge, Marketing Ops, Artifact Server e Hermes por Docker Compose;
- usar a imagem oficial fixada, sem `build` ou Dockerfile derivado;
- usar um único container persistente para o runtime Hermes;
- usar um único profile ativo chamado `ens`;
- manter o profile `default` inativo;
- persistir `/opt/data` em volume ou bind mount dedicado;
- não montar o Docker socket no Hermes;
- manter o backend de terminal `local` dentro do próprio container: nesse
  contexto, "local" é o filesystem do container e o volume `/opt/data`, não o
  host; não trocar por backend Docker aninhado mediante socket do host;
- conectar o Hermes somente às redes e volumes necessários.

## Inicialização da Profile Distribution ENS

Um serviço one-shot chamado conceitualmente `hermes-profile-init` usará a mesma imagem oficial do runtime. Ele terá acesso de escrita ao volume `/opt/data` e acesso somente leitura a `agents/ens`, montado como `/distribution`.

Sequência:

1. o Docker Compose obtém a imagem oficial fixada;
2. o inicializador prepara o volume usando o entrypoint oficial;
3. se o profile `ens` não existir, executa `hermes profile install /distribution --name ens --yes`;
4. se o profile já existir, executa `hermes profile update ens --yes`;
5. nunca usa `--force-config` durante uma atualização normal;
6. carimba somente configs ainda sem `_config_version`, recusa versões
   explícitas abaixo do piso suportado e executa o migrador oficial para a raiz
   e o profile;
7. persiste o gateway `default` como parado;
8. torna `ens` o profile ativo com `hermes profile use ens`;
9. valida a versão da distribuição e a compatibilidade `hermes_requires`;
10. termina com sucesso;
11. somente depois o container persistente inicia explicitamente
    `hermes -p ens gateway run --no-supervise` sob o supervisor do container.

O inicializador e o runtime nunca escreverão simultaneamente no mesmo `/opt/data`. O Compose deverá exigir `service_completed_successfully` antes de iniciar o runtime.

O caminho `/distribution` é uma origem local registrada pelo Hermes. Toda atualização feita pelo deploy volta a montar o mesmo diretório. O core não é copiado para o monorepo nem para a distribuição.

## Propriedade da configuração

### Distribuição ENS

Pode controlar:

- `distribution.yaml`;
- `SOUL.md`;
- `skills/`;
- `mcp.json`;
- jobs `cron/` explicitamente aprovados;
- configurações padrão que não contenham provider, modelo, credenciais ou estado local.

### Compatibilidade MCP no pin v0.20.6

A auditoria do código oficial fixado em `v2026.8.27` confirmou uma assimetria
upstream: Profile Distribution reconhece e distribui `mcp.json`, mas o carregador
MCP do runtime `0.20.6` consulta `mcp_servers` em `config.yaml` e os MCPs portáteis
de plugins. Ele não consulta o `mcp.json` instalado pelo profile.

Por isso, enquanto o core permanecer em `0.20.6`:

- `config.yaml#mcp_servers` é a única fonte funcional do MCP Marketing Ops;
- `mcp.json` permanece vazio, versionado apenas para manter o formato oficial da
  distribuição e facilitar uma migração futura;
- o validador rejeita definição duplicada entre os dois arquivos;
- provider, modelo, credenciais e estado continuam fora da distribuição;
- uma atualização de endpoint/configuração MCP em profile já instalado exige
  migration explícita, pois `profile update` preserva `config.yaml` por padrão.

Essa exceção é uma camada de compatibilidade da distribuição ENS, não uma
alteração do core Hermes. O contrato deve ser reavaliado ao mudar o pin.

### Ambiente e operador

Controlam:

- provider e modelo ativos;
- `.env` e `auth.json`;
- tokens OAuth;
- chave do API Server;
- configuração de autenticação do dashboard;
- memória, sessões e banco de estado;
- ajustes locais de `config.yaml` realizados pelo dashboard;
- volumes, domínios, limites e secrets do deploy.

O upstream preserva `config.yaml` em `profile update` por padrão. O inicializador não usará `--force-config`, protegendo os ajustes manuais feitos pelo operador. Mudanças futuras de configuração ENS que precisem sobrescrever valores locais exigirão uma decisão e uma migration explícitas.

## Provider e primeiro acesso

O deploy não exigirá um provider configurado para criar o volume e iniciar o dashboard. O usuário configurará provider e modelo manualmente depois do primeiro acesso administrativo.

Enquanto nenhum provider estiver operacional:

- `/health` pode permanecer como liveness do processo;
- `/health/detailed` deve indicar readiness degradada;
- o Chat Bridge não deve entrar em crash loop;
- o frontend deve receber um erro operacional explícito de agente ainda não configurado;
- nenhuma credencial de provider será inventada, incluída no Compose ou versionada.

## Contrato Chat Bridge -> Hermes

O Chat Bridge usará somente a API oficial autenticada por bearer token.

Fluxo canônico:

1. consultar `GET /v1/capabilities` na inicialização;
2. falhar fechado se faltarem as capacidades obrigatórias;
3. criar ou correlacionar uma sessão oficial;
4. iniciar uma execução em `POST /v1/runs`;
5. acompanhar `GET /v1/runs/{id}/events`;
6. encaminhar aprovação técnica por `POST /v1/runs/{id}/approval`;
7. interromper por `POST /v1/runs/{id}/stop`;
8. reconciliar o estado final por `GET /v1/runs/{id}`;
9. usar `X-Hermes-Session-Id` para o transcript e `X-Hermes-Session-Key` para o escopo estável de memória quando aplicável.

Capabilities mínimas:

- `run_submission`;
- `run_status`;
- `run_events_sse`;
- `run_stop`;
- `run_approval_response` (feature; o endpoint continua nomeado `run_approval`);
- criação e leitura de sessões;
- streaming de sessão ou Runs;
- autenticação bearer obrigatória.

O Runs API é o contrato canônico porque suporta detach/reconnect, status, eventos, aprovação e cancelamento. O Bridge preserva sua própria fronteira de autenticação, tenant, usuário, autorização, idempotência e replay para o navegador.

O browser nunca recebe `API_SERVER_KEY` e não precisa de CORS para o Hermes.

## Estado durável e arquivos

`/opt/data` contém o estado interno do Hermes:

- `.env` e `auth.json`;
- `config.yaml`;
- SOUL e skills instaladas;
- sessões, memória e `state.db`;
- logs e receipts de atualização;
- cache e HOME interno de subprocessos.

PostgreSQL continua sendo a autoridade dos dados do produto. O estado de runs e eventos necessário para autenticação, replay, auditoria e recuperação do ENS será persistido pelo Chat Bridge/PostgreSQL, não inferido somente do banco interno do Hermes.

Arquivos de usuário pertencem ao Artifact Server/object storage. O Hermes recebe referências autorizadas, conteúdo extraído ou acesso por MCP. Não receberá mounts amplos do host ou da árvore completa da VPS.

## Dashboard e Traefik

O dashboard oficial ficará disponível em:

```text
https://hermes.solucoes-nexus.tech
```

Regras:

- habilitar o dashboard no mesmo container supervisionado do gateway;
- bind interno na porta `9119`;
- definir `HERMES_DASHBOARD_PUBLIC_URL=https://hermes.solucoes-nexus.tech`;
- usar OAuth da Nous com `HERMES_DASHBOARD_OAUTH_CLIENT_ID`;
- registrar o client OAuth por procedimento administrativo oficial;
- não usar `--insecure` nem autenticação legada do antigo Kanban;
- não publicar a porta `8642` em domínio público;
- manter a possibilidade de remover somente o router/labels do dashboard no futuro, sem alterar o runtime.

O Traefik existente é operado por outro Compose com `network_mode: host` e Docker provider. O novo stack não cria outro proxy nem uma rede externa chamada `traefik`; apenas adiciona labels. Esse padrão foi confirmado no Compose do projeto histórico.

Labels devem criar somente o router HTTPS do dashboard, apontar o service para `9119` e usar o cert resolver existente. O router antigo de `api-hermes.solucoes-nexus.tech` não será recriado.

## Segurança

- fixar tag e digest da imagem;
- nunca montar `/var/run/docker.sock` no Hermes;
- não usar `privileged`;
- não adicionar capabilities de host sem justificativa;
- expor ao Hermes somente volumes e redes necessários;
- executar serviços supervisionados como usuário `hermes`;
- gerar uma chave forte e exclusiva para `API_SERVER_KEY`;
- manter a API em rede interna;
- usar OAuth Nous no dashboard público;
- não habilitar CORS amplo;
- configurar limites de CPU, memória e PIDs quando compatíveis com a VPS;
- habilitar hard stop para loops de ferramentas em gateway não assistido;
- manter redaction de secrets ativa;
- limitar toolsets e MCPs ao necessário para o agente ENS;
- nunca versionar `.env`, tokens, logs, sessões, memória ou bancos;
- não passar tenant, papel ou autorização de negócio como decisão confiada ao modelo.

## Health, readiness e ordem de startup

O upstream não define `HEALTHCHECK` na imagem nem no Compose de exemplo. O stack ENS adicionará seus próprios checks.

- liveness: `GET /health`;
- readiness: `GET /health/detailed` com bearer token e inspeção do campo de status;
- dashboard: endpoint HTTP protegido ou check local apropriado;
- Chat Bridge: só fica ready depois de alcançar o Hermes e validar capabilities;
- App API/BFF: pode iniciar antes do provider, mas expõe estado degradado do agente;
- dependências devem usar retry com backoff, não sleeps fixos.

Um readiness degradado por ausência de provider não deve reiniciar indefinidamente o container Hermes. Falhas estruturais, como profile incompatível, chave ausente, OAuth ausente em dashboard público ou volume sem permissão, devem impedir o deploy de ser considerado saudável.

## Atualização do core

Não haverá atualização automática, Watchtower nem acesso do dashboard ao Docker daemon.

Procedimento controlado:

1. identificar uma release oficial;
2. revisar release, tag, workflow e mudanças de configuração;
3. obter o novo digest OCI;
4. alterar tag e digest no arquivo versionado do Compose;
5. testar no Docker Desktop com cópia descartável do estado;
6. executar smoke tests de gateway, dashboard, API, profile e MCPs;
7. criar backup do `/opt/data` da produção;
8. executar `docker compose pull` e `docker compose up -d` na VPS;
9. verificar migrações, logs, versão, readiness e capabilities;
10. manter a imagem anterior e o backup disponíveis até a aceitação.

O dashboard pode indicar que existe atualização, mas em instalação gerenciada por imagem ele recusa a troca interna e mostra o comando externo correto.

## Atualização da distribuição ENS

A distribuição e o core têm ciclos independentes.

- alterações em `agents/ens` aumentam `distribution.yaml.version`;
- o deploy executa o inicializador;
- profiles existentes usam `hermes profile update ens --yes`;
- provider, `.env`, `auth.json`, memória, sessões e estado são preservados;
- `config.yaml` não é forçado;
- no pin `0.20.6`, mudanças ENS em `mcp_servers` exigem migration explícita e
  seletiva, sem substituir provider ou ajustes manuais do operador;
- a aplicação do profile deve ser idempotente;
- a versão aplicada deve ficar verificável com `hermes profile info ens`.

## Backup e rollback

Antes de atualizar core ou distribuição:

- criar snapshot consistente de `/opt/data`;
- registrar versão do core, digest e versão da distribuição;
- garantir espaço e permissões do backup;
- impedir escrita simultânea durante restauração.

Rollback do core:

1. parar o runtime;
2. restaurar a referência da imagem anterior;
3. avaliar incompatibilidade de configuração;
4. restaurar o snapshot de `/opt/data` quando necessário;
5. subir o runtime e executar health/capabilities/smoke tests.

Rollback da distribuição:

1. retornar `agents/ens` ao commit/tag anterior;
2. aumentar ou registrar a versão de rollback de maneira explícita;
3. reaplicar pelo inicializador;
4. não apagar dados locais;
5. validar SOUL, skills, MCPs e provider preservado.

## Observabilidade

Registrar e monitorar:

- versão do core e digest em execução;
- versão e origem da distribuição ENS;
- status do gateway e dashboard;
- liveness e readiness;
- falhas de autenticação do API Server;
- runs ativos, concluídos, falhos, interrompidos e aguardando aprovação;
- duração e reconexões do SSE;
- falhas de MCP;
- consumo de CPU, memória e disco;
- crescimento do `/opt/data`;
- logs persistentes em `/opt/data/logs`;
- receipts e backups de atualização.

Secrets, prompts privados, payloads integrais e tokens não devem aparecer em métricas ou logs agregados.

## Falhas esperadas e comportamento

| Falha | Comportamento esperado |
| --- | --- |
| Imagem não disponível ou digest incorreto | Deploy falha antes de iniciar o runtime |
| Distribuição incompatível com a versão do Hermes | Inicializador falha e runtime anterior permanece disponível |
| Profile ausente | Inicializador instala `ens` |
| Profile existente | Inicializador atualiza sem forçar config |
| Provider ausente | Dashboard disponível; readiness do agente degradada |
| API key ausente com bind não loopback | Hermes falha fechado |
| OAuth ausente com dashboard público | Dashboard falha fechado; deploy não é aceito |
| Chat Bridge incompatível com capabilities | Bridge falha fechado e sinaliza incompatibilidade |
| SSE desconectado | Bridge reconecta e reconcilia por status persistido |
| MCP indisponível | Run recebe erro controlado; serviço e readiness registram degradação |
| Volume sem permissão | Inicialização falha explicitamente |
| Atualização incompatível | Rollback para imagem e/ou snapshot anteriores |

## Testes

### Distribuição

- validar YAML e JSON;
- validar `hermes_requires` contra `0.20.6`;
- instalar em `HERMES_HOME` temporário;
- atualizar uma instalação existente;
- provar preservação de `.env`, `auth.json`, config, memória e sessões;
- provar que nenhum secret ou estado é distribuído.

### Container

- confirmar versão e digest;
- confirmar `/opt/hermes` não gravável pelo runtime;
- confirmar processos do gateway e dashboard como usuário `hermes`;
- confirmar ausência de Docker socket;
- reiniciar container e validar persistência;
- validar liveness, readiness e logs;
- validar limites de recursos.

### API e Bridge

- autenticação bearer obrigatória;
- capabilities mínimas presentes;
- criar run, receber eventos, aprovar, interromper e reconciliar;
- reconectar SSE;
- isolamento entre sessões de usuários;
- ausência de acesso direto pelo navegador;
- erro explícito quando provider não está configurado.

### Dashboard e Traefik

- HTTPS válido em `hermes.solucoes-nexus.tech`;
- redirecionamento OAuth e callback corretos;
- acesso anônimo negado;
- Host e Origin inválidos negados;
- API `8642` não acessível publicamente;
- remoção dos labels encerra a exposição sem parar o agente.

### Atualização e rollback

- dashboard detecta que Docker não é atualizável internamente;
- atualização manual preserva estado;
- migração de config produz backups;
- rollback restaura a versão anterior;
- profile ENS pode avançar e voltar independentemente do core.

## Critérios de aceite

1. Não existe core Hermes, fork, submodule ou vendor no monorepo.
2. O Compose usa a imagem oficial `v2026.8.27` fixada pelo digest aprovado.
3. `agents/ens` é a única fonte versionada de personalização Hermes.
4. O profile `ens` é instalado ou atualizado por um inicializador idempotente.
5. Inicializador e runtime nunca escrevem simultaneamente em `/opt/data`.
6. Provider e credenciais não são exigidos nem sobrescritos pelo deploy.
7. O Chat Bridge usa Runs API oficial e valida capabilities.
8. O navegador não conhece a URL interna nem a chave do Hermes.
9. A API `8642` não possui router público no Traefik.
10. O dashboard responde somente por HTTPS em `hermes.solucoes-nexus.tech` e exige OAuth Nous.
11. O Hermes não recebe Docker socket, privilégios amplos ou mounts do host fora do escopo.
12. Estado sobrevive a restart e recriação do container.
13. Atualização do core é manual, versionada e reversível.
14. Atualização da distribuição preserva estado e configuração manual.
15. Health checks distinguem liveness de readiness.
16. Testes de integração e smoke tests passam no Docker Desktop antes do deploy na VPS.

## Decisões futuras

- quando remover a exposição pública do dashboard;
- política definitiva de toolsets permitidos ao agente ENS;
- limites de CPU/memória adequados à VPS real;
- estratégia de backup externo do `/opt/data`;
- política de retenção de sessões e logs Hermes;
- necessidade futura de executar o terminal do agente em sandbox adicional.

Essas decisões não impedem a implementação da baseline, mas deverão receber ADR ou atualização deste documento antes de alterar a fronteira de segurança.
