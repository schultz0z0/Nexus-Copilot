# Estado da migração

Data da baseline: 2026-08-27

## Verificações executadas

- Instalação por lockfile concluída nos quatro pacotes.
- Typecheck do frontend e Marketing Ops: aprovado.
- Frontend: 39 arquivos de teste e 145 testes aprovados.
- Chat Bridge: 124 testes aprovados.
- Artifact Server: 13 testes aprovados.
- Build de produção do frontend e build TypeScript do Marketing Ops: aprovados.
- Profile Distribution ENS: YAML e JSON carregados e estrutura mínima validada.

## Gate ainda vermelho

O comando agregado `npm test` não está verde porque o Marketing Ops ainda depende da infraestrutura que este corte deliberadamente não trouxe:

- testes de contrato procuram migrations Supabase antigas;
- testes de integração procuram PostgreSQL em `127.0.0.1:55322`;
- alguns testes de delegação carregam premissas temporais/runtime do fork anterior.

Isso será resolvido quando `db/migrations` receber a baseline PostgreSQL vanilla e Marketing Ops for adaptado ao novo contrato de identidade/delegação. A falha não foi mascarada nem removida dos scripts.

## Hermes oficial — M1 concluído na VPS (2026-09-11)

Em 2026-09-08, o primeiro lote do runtime oficial foi implementado na branch
`codex/hermes-m1`:

- contrato automatizado da Profile Distribution ENS aprovado;
- requisito mínimo fixado em Hermes `0.20.6`;
- inicializador idempotente `install/update/use` implementado sem
  `--force-config`;
- Compose base renderizado com a imagem oficial fixada por tag e digest;
- volume `/opt/data` compartilhado sequencialmente entre init e runtime;
- API `8642` mantida sem publicação de porta e nenhum Docker socket montado;
- provider e credenciais continuam ausentes do repositório.

O teste comportamental POSIX do inicializador está escrito. Seus cenários
continuam skipped pelo runner Node do Windows por falta de shell POSIX no host,
mas o próprio inicializador foi executado repetidamente com sucesso dentro da
imagem Linux oficial no ensaio de 2026-09-09.

Compatibilidade conhecida do pin: o Hermes `0.20.6` distribui `mcp.json`, mas seu
runtime ainda carrega MCPs de `config.yaml#mcp_servers`. O ENS mantém somente a
definição funcional em `config.yaml` e valida que não exista duplicação.

O segundo lote M1, também em 2026-09-08, acrescentou:

- override de produção com um único router Traefik para o dashboard `9119`;
- OAuth Nous obrigatório para o dashboard público;
- smoke autenticado para liveness, readiness e capabilities do Runs API;
- falha fechada para provider ausente, salvo tolerância explícita no primeiro
  deploy;
- runbooks de desenvolvimento Windows e primeiro deploy na VPS.

Resultado focado em 2026-09-09: 16 testes Hermes aprovados, 5 cenários POSIX
skipped pelo runner Windows e zero falhas. O init real dentro do container Linux
cobriu o caminho operacional. Também passaram: corte `3/3`, verificação do corte
`397/397`, Chat Bridge `90/90`, Artifact Server `13/13` e renderizações base,
paridade e produção. M1 continua em execução porque VPS, HTTPS/OAuth,
provider manual e rollback do core ainda não foram exercitados; recuperação e
rollback do profile foram comprovados localmente no lote seguinte.

O terceiro lote documentou atualização/rollback e backup/restore, registrou o
bloqueio do ensaio Docker Desktop e executou a auditoria final permitida. A
verificação fresca aprovou:

- Profile Distribution: válida;
- contratos Hermes: 15 aprovados, 4 POSIX skipped, 0 falhas;
- Compose base e produção: renderização aprovada, sem iniciar containers;
- corte inicial: 397 arquivos, 0 divergências e 0 caminhos proibidos;
- Chat Bridge: 90 testes aprovados;
- Artifact Server: 13 testes aprovados;
- verificador do corte: 3 testes aprovados para fim de linha, diferença real e
  binários.

Durante essa auditoria, `verify:cut` inicialmente falhou porque comparava bytes
da árvore histórica em CRLF/CRCRLF com o checkout LF do monorepo. A correção
normaliza apenas fim de linha em texto UTF-8 e mantém igualdade byte a byte para
binários; diferenças substantivas continuam reprovadas.

### Gate Docker Desktop

**Comprovado em 2026-09-09 dentro do escopo autorizado.** O projeto isolado
`ens-hermes-m1` baixou a imagem oficial fixada, criou apenas o volume
`ens-hermes-m1-data` e executou init, runtime, smoke, restart, segundo init e
recriação completa. A API ficou restrita a `127.0.0.1:18642` e o dashboard
permaneceu desabilitado.

O ensaio encontrou e corrigiu quatro incompatibilidades reais: comando inicial
abria a TUI, gateway `default` disputava a porta com `ens`, a capability oficial
usa `run_approval_response`, e o migrador Docker exige um piso de schema para
configs não versionados. O resultado final possui:

- um único processo de gateway `hermes -p ens`;
- `default` parado e `/v1/models` anunciando `ens`;
- Profile Distribution `ens@0.1.1`;
- configs raiz/profile migrados ao schema `39` pelo migrador oficial;
- liveness e capabilities aprovadas;
- única degradação de readiness em `model`, esperada sem provider;
- persistência comprovada em restart e `down`/`up`;
- nenhum container ao final e volume de evidência preservado.

### Gate local de recuperação

Em 2026-09-09, o volume isolado `ens-hermes-m1-data` foi arquivado em repouso,
o checksum SHA-256 foi validado e o conteúdo foi restaurado primeiro no volume
novo `ens-hermes-restore-20260909T170349Z`. O profile `ens@0.1.1` e o runtime
restaurados passaram em liveness, capabilities e smoke autenticado, tolerando
somente o provider deliberadamente ausente.

No volume restaurado, um candidato descartável e validado `ens@0.1.2` comprovou
o update manual da distribuição; a reaplicação da distribuição rastreada
`ens@0.1.1` comprovou o rollback. O container temporário foi removido e os dois
volumes e o arquivo de backup ficaram preservados. Nenhum estado do Hermes local
do Windows ou da VPS foi acessado.

Situação de aceite: **M1 100% concluído e validado na VPS em 2026-09-11**.
O deploy foi realizado pelo operador humano assistido pelo copiloto do agente
([runbook de primeiro deploy](docs/operations/hermes-first-deploy.md)).
O container oficial `ens-hermes-hermes-1` está ativo e saudável (`Up healthy`)
sob o supervisor `s6-overlay`. O Profile Distribution `ens@0.1.1` foi instalado
e migrado no volume `ens-hermes-data`. A API interna (`8642`) foi aprovada em
liveness e capabilities via smoke test. O Dashboard oficial (`9119`) está
autenticado com Basic Auth e publicado com segurança via Traefik em
`https://hermes.solucoes-nexus.tech` com HTTPS/TLSv1.3 válido. A API `8642`
permanece inacessível publicamente.

## Hermes Runs Bridge — M2 concluído na VPS (2026-09-11)

Em 2026-09-09, os checkpoints A e B foram aprovados localmente. Texto e arquivos
com conteúdo extraído seguem pelo Runs API oficial; Picture, imagens e binários
sem extração permanecem no Session API. O Bridge agora:

- verifica capabilities obrigatórias de forma fail-closed;
- cria Runs com idempotência e persiste o ID Hermes antes do consumidor SSE;
- normaliza approvals, stopping, cancellation e provider ausente;
- mantém um consumidor upstream por Run e replay por cursor somente no Bridge;
- responde approvals e stop pelos endpoints oficiais com autorização cross-user;
- preserva o contrato do frontend sem expor Hermes ao navegador.

O checkpoint C comprovou o contrato do pin oficial num projeto Docker Desktop
isolado. Em 2026-09-11, o RunStore foi migrado com sucesso para o PostgreSQL (`chat.bridge_runs`).

Em 2026-09-11, a **homologação na VPS foi concluída com sucesso**:
- Teste de contrato oficial Python (`test_runs_contract.py`): aprovado contra `172.16.2.2:8642`.
- Suíte de testes do Chat Bridge na VPS: 124 testes aprovados (`tests 124, pass 124, fail 0`).
- Smoke test oficial Node (`smoke-hermes-runtime.mjs`): liveness aprovada (`PASS`), readiness com `provider_unconfigured (allowed)` e capabilities aprovadas (`PASS`).
- Protocolo oficial Hermes validado ponta a ponta sem qualquer dependência de código ou fork legado.

## Fundação PostgreSQL — M3 concluído na VPS (2026-09-11)

Em 2026-09-10 e 2026-09-11, a fundação PostgreSQL e os schemas de domínio foram implementados e testados:
- PostgreSQL 18.6-bookworm fixado pelo digest `sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af`;
- Rede `ens-postgres-data` interna (`internal: true`) sem exposição pública de portas;
- Papéis e privilégios mínimos (`nexus_owner`, `nexus_migrator`, `nexus_app`, `nexus_backup`) com SCRAM-SHA-256 e senhas armazenadas fora do Git em `/etc/ens/secrets/postgres/`;
- Migrations `0001` a `0004` aplicadas via migrador transacional idempotente com advisory lock;
- Tabelas do domínio `chat` (`bridge_runs`, `chat_sessions`, `chat_messages`, etc.) e evolução do schema `iam` ativas;
- RLS (Row-Level Security) ativo e forçado, verificado em produção assistida via consulta com `nexus_app`;
- Suíte de contratos `test:postgres:contract` com 23/23 testes aprovados na VPS.

M3 está 100% concluído (18% de 18%). O progresso global da migração atinge 52%.

## Auth e App API/BFF — M4 concluído na VPS (2026-09-13)

Em 2026-09-12 e 2026-09-13, a camada de aplicação, autenticação, gerenciamento de sessões e administração foi implementada, testada e homologada na VPS de produção:
- Migration `0005_auth_sessions.sql` aplicada no PostgreSQL de produção com sucesso (`iam.user_credentials`, `iam.user_sessions`, funções seguras `iam.authenticate_by_email` e `iam.resolve_session`, e hardening de RLS);
- Tenant principal (`prometeus`, display name: `Prometeus Marketing`) e primeiro usuário administrador provisionados com hash bcrypt seguro (12 rounds) de forma transacional e sem exposição de senhas;
- Role `nexus_app` validada com acesso de menor privilégio na rede interna Docker (`172.16.6.2:5432`) utilizando o secret `/etc/ens/secrets/postgres/app`;
- App API Fastify 5 (`services/app-api`) implementada com autenticação baseada em cookie `HttpOnly` seguro (`SameSite=Lax`), injeção de contexto PostgreSQL (`SET LOCAL app.user_id`, `SET LOCAL app.tenant_id`) e rotas RBAC de administração (`/api/admin/users/*`);
- Tela `UserManagement.tsx` em `apps/chat-web` 100% desacoplada das Edge Functions legadas do Supabase, migrada para os endpoints nativos da App API;
- Suíte completa de 74 testes da App API aprovada na VPS (`✔ pass 74, fail 0`);
- Suíte de 24 testes contratuais de PostgreSQL aprovada na VPS (`✔ pass 24, fail 0`);
- Suíte de 164 testes do frontend aprovada (`164 passed across 40 test files`);
- Homologação E2E integrada em produção (`test_app_api_e2e`) executada e aprovada com 100% de sucesso contra o banco real, validando login negativo/positivo, emissão e parsing de cookie de sessão, consulta autorizada RBAC de admin, negação anônima, logout e invalidação imediata de sessão.

M4 está 100% concluído (18% de 18%). O progresso global da migração atinge 70%.

## Capacidades locais substitutas — M5 concluído na VPS (2026-09-13)

Em 2026-09-13, a stack de aplicação substituta dos serviços gerenciados (Supabase) e a operação de chat em produção foram implementadas, unificadas e homologadas na VPS de produção (`https://app.solucoes-nexus.tech`):
- Stack Docker `ens-app` criada (`infra/app/compose.yaml` e `compose.production.yaml`) contendo 4 serviços orquestrados operando em estado ativo e saudável (`Up healthy`):
  1. `ens-app-app-api-1`: BFF Fastify 5 nativo com sessões por cookies seguros `HttpOnly` e proxy seguro para serviços internos;
  2. `ens-app-artifact-server-1`: CAS (Content-Addressable Storage) interno para anexos e avatares com URLs temporárias HMAC assinadas e expiração configurada;
  3. `ens-app-chat-bridge-1`: Runs/SSE Bridge em modo gateway autenticado, conectado ao PostgreSQL e ao Hermes oficial;
  4. `ens-app-chat-web-1`: Frontend React 18 sob Nginx reverse proxy unificado roteando chamadas `/api/` internamente na rede Docker `ens-app-internal`.
- Traefik configurado em modo `host` roteando tráfego HTTPS com TLSv1.3 e certificados válidos Let's Encrypt para a porta 8080 do `chat-web`.
- Smoke test integrado automatizado (`scripts/smoke-app-stack.mjs`) executado na VPS: todos os 4 serviços (App API, Chat Bridge, Artifact Server e Chat Web) passaram com 100% de sucesso (`PASS`).
- Homologação manual E2E de ponta a ponta no navegador em ambiente real:
  - Login administrativo nativo via cookie `HttpOnly` seguro;
  - Zero requisições ou dependências para `supabase.co` na aba Network do navegador;
  - Envio de mensagem de chat via SSE (`/api/chat/runs/.../events`) e resposta real em streaming do Hermes oficial no perfil `ens`: *"Olá, Raphael. Como posso te ajudar hoje?"*.
- Limpeza e saneamento do codebase:
  - Arquivo stub `@/lib/supabase` completamente deletado do repositório;
  - URLs de download e upload de anexos e avatares migradas integralmente para a App API nativa;
  - Módulo `ValidatedWorks` inteiramente removido do sistema a pedido do usuário;
  - Desacoplamento de credenciais Supabase obrigatórias no serviço `services/marketing-ops/src/config.ts`.

M5 está 100% concluído (14% de 14%). O progresso global da migração atinge 84%.


## Dívida de dependências herdada

- Frontend: 2 vulnerabilidades moderadas e 2 altas reportadas por `npm ci`.
- Marketing Ops: 1 vulnerabilidade alta reportada por `npm ci`.

Nenhum `npm audit fix` automático foi aplicado para evitar mudanças sem revisão no corte inicial.

## Avisos de build herdados

- bundle principal do frontend acima de 500 kB;
- importação estática e dinâmica simultânea do cliente Supabase legado;
- base Browserslist desatualizada.
