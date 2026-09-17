# Roadmap da migração ENS

**Estado geral:** Em execução  
**Atualizado em:** 2026-09-16

## Regra de progressão

Uma fase só muda para **Concluída** quando todos os critérios de saída têm
evidência verificável. Trabalho da fase seguinte pode ser investigado em paralelo,
mas não autoriza remover a infraestrutura anterior antes do gate correspondente.

| Marco | Estado | Resultado principal |
| --- | --- | --- |
| M0 — baseline e memória do projeto | Concluído | monorepo inicial, restrições e documentação canônica |
| M1 — Hermes oficial | Concluído | runtime/profile, restore e deploy VPS comprovados sob supervisão s6 |
| M2 — protocolo do agente | Concluído | protocolo oficial de Runs, persistência em PostgreSQL e testes do Bridge na VPS validados |
| M3 — fundação PostgreSQL | Concluído | PostgreSQL 18.6, menor privilégio, RLS, migrations 0001-0004 e contratos validados na VPS |
| M4 — Auth e App API/BFF | Concluído | identidade/tenant, sessões HttpOnly, BFF Fastify, RBAC de admin e homologação E2E na VPS |
| M5 — capacidades substitutas | Concluído | stack ens-app, Artifact Server CAS, remoção de dependências Supabase e chat na VPS |
| M6 — dados e cutover | Gate opaco local aprovado; VPS pendente | execução estruturada implantada; correção que retira o JWT do contexto do modelo aprovada localmente |
| M7 — hardening e retirada do legado | Pendente | operação estável, rollback testado e dependências removidas |

## Estimativa de progresso global

Esta estimativa é um sinal de planejamento, não substitui os critérios de saída.
Cada marco tem peso proporcional ao risco e ao volume esperado; trabalho copiado
do legado sem aceite no alvo não conta como concluído.

| Marco | Peso no programa | Crédito atual estimado | Base da estimativa |
| --- | ---: | ---: | --- |
| M0 | 8% | 8% | concluído |
| M1 | 12% | 12% | concluído; paridade local, recuperação e deploy em produção na VPS validados |
| M2 | 14% | 14% | concluído; protocolo oficial de Runs, testes do Chat Bridge (124/124) e smoke test validados na VPS |
| M3 | 18% | 18% | concluído; PostgreSQL 18.6, menor privilégio, RLS, migrations 0001-0004 e contratos (24/24) validados na VPS |
| M4 | 18% | 18% | concluído; migration 0005, App API/BFF Fastify, sessões seguras HttpOnly, rotas admin, frontend desacoplado e homologação E2E na VPS |
| M5 | 14% | 14% | concluído; stack ens-app (App API, Artifact Server, Bridge, Chat Web) saudável, zero Supabase e chat homologado na VPS |
| M6 | 10% | 9% | schema/backup/cutover técnico e execução estruturada implantados; correção opaca aprovada localmente e nova homologação produtiva pendente |
| M7 | 6% | 0% | hardening e retirada do legado ainda não executados |
| **Total** | **100%** | **93% de crédito estimado / 7% restante** | M6 não concluído; estimativa em 2026-09-15 |

## M0 — Baseline e memória do projeto

**Objetivo:** criar a nova fronteira do monorepo e registrar as decisões antes de
reescrever integrações.

**Critérios de saída:**

- componentes iniciais copiados sem dados ou segredos;
- `agents/ens` criado sem vendorizar o Hermes;
- restrições arquiteturais registradas no `AGENTS.md`;
- PRD, arquitetura-alvo, ADR inicial, roadmap e índice de documentos disponíveis;
- estado legado e falhas de baseline explicitados, sem serem confundidos com alvo.

**Evidência:** commits de bootstrap e documentação, `MIGRATION_STATUS.md` e
`docs/README.md`.

## M1 — Runtime Hermes oficial e Profile ENS

**Objetivo:** tornar reproduzível a instalação oficial aprovada sem instalar ou
alterar o Hermes durante o desenvolvimento diário.

**Entrada:** ADR-0001 aceito e versão/digest definidos.

**Entregas:**

- contrato validável de `agents/ens`;
- inicializador one-shot idempotente;
- Compose de runtime e override de produção com labels Traefik;
- volume persistente e segredos externos ao Git;
- health/readiness e smoke tests;
- runbooks de desenvolvimento, primeiro deploy, update, backup e rollback.

**Critérios de saída:** todos os critérios da seção de aceite do
[desenho Hermes](../plans/2026-08-28-hermes-official-runtime-design.md) comprovados
no Docker Desktop e/ou ambiente seguro equivalente, sem tocar o computador
corporativo além do escopo aprovado.

**Plano ativo:**
[2026-08-28-hermes-official-runtime-implementation.md](../plans/2026-08-28-hermes-official-runtime-implementation.md).

**Situação em 2026-09-11:** M1 **concluído com sucesso na VPS**. O deploy em produção
foi executado pelo operador humano com apoio copiloto do agente em 2026-09-11
([runbook de primeiro deploy](../operations/hermes-first-deploy.md)).
O container `ens-hermes-hermes-1` está ativo e saudável (`Up healthy`) sob
supervisão do `s6-overlay`. O profile `ens@0.1.1` está ativo no volume persistente
`ens-hermes-data` com schemas migrados até a versão 39. A API interna (`8642`)
passou com `PASS` em liveness e capabilities. O Dashboard está seguro e publicado
via Traefik em `https://hermes.solucoes-nexus.tech` com TLSv1.3 e Let's Encrypt,
com autenticação básica ativa. A porta `8642` permanece isolada da internet.

## M2 — Protocolo oficial do agente

**Objetivo:** remover dependências do fork no caminho Chat Bridge -> Hermes.

**Dependência:** M1.

**Entregas:** cliente oficial de Runs, SSE retomável, approvals, stop, sessions e
capabilities; contrato externo estável para o frontend; erros e observabilidade.

**Critérios de saída:**

- testes de contrato cobrem run completo, reconexão, aprovação, rejeição,
  cancelamento e falha;
- nenhuma chamada do Bridge depende dos endpoints privados do fork;
- API Hermes continua interna e autenticada;
- ausência de provider é distinguida de indisponibilidade do processo;
- smoke test real passa com o profile ENS.

**Situação em 2026-09-09:** os checkpoints A, B e C local do
[plano de implementação](../plans/2026-09-09-hermes-runs-bridge-implementation.md)
foram aprovados localmente. O Bridge possui cliente tipado para os endpoints
oficiais de Runs, valida capabilities de forma fail-closed, normaliza approval,
stopping e cancellation e seleciona Runs somente para texto/arquivos extraídos.
Picture, imagens e binários sem extração permanecem em Session. A integração
do executor persiste o ID upstream antes do SSE e limita cada Run a um consumidor.
Approval e stop agora usam endpoints oficiais, mantêm o contrato do frontend e
negam cross-user. No Docker Desktop, um volume realmente vazio revelou e levou
à correção da inicialização ausente do `config.yaml` raiz. O pin oficial iniciou
saudável, rejeitou chamadas Runs sem Bearer token e anunciou todas as
capabilities requeridas; readiness ficou degradada somente por provider ausente,
como esperado. Containers e rede exclusivos foram removidos e o volume de
evidência `ens-hermes-m2-fresh-data` foi preservado.

**Situação em 2026-09-11:** M2 **concluído com sucesso na VPS**. O protocolo oficial
do Hermes Runs e a integração com o Chat Bridge foram homologados em produção
assistida:
1. O teste de contrato oficial Python (`test_runs_contract.py`) contra o IP privado do Hermes (`172.16.2.2:8642`) passou com sucesso (`test_pinned_runtime_exposes_authenticated_runs_contract ... ok`).
2. A suíte de 124 testes unitários e de integração do Chat Bridge foi executada na VPS e aprovou 100% dos cenários (`✔ pass 124, fail 0`).
3. O smoke test oficial Node (`smoke-hermes-runtime.mjs`) validou liveness (`PASS`), readiness autenticada com degradação controlada (`provider_unconfigured (allowed)`) e todas as 5 capabilities oficiais de Runs (`PASS`).
4. O RunStore foi refatorado e migrado para persistência no PostgreSQL (`chat.bridge_runs`).
O marco alcança 14% de 14% concluído. A fundação PostgreSQL segue em M3.

## M3 — Fundação PostgreSQL

**Estado:** M3 **concluído com sucesso na VPS em 2026-09-11**. A fundação do
PostgreSQL oficial (18.6-bookworm fixado por digest SHA256) foi homologada em produção:
1. Container `ens-postgres-postgres-1` ativo e saudável (`healthy`) em rede estritamente interna (`internal: true`).
2. Papéis de menor privilégio criados via bootstrap (`nexus_owner`, `nexus_migrator`, `nexus_app`, `nexus_backup`) com senhas fortes fora do Git em `/etc/ens/secrets/postgres/`.
3. Migrations versionadas `0001` a `0004` aplicadas com sucesso pelo migrador idempotente sob advisory lock.
4. Schemas `infra`, `iam` e `chat` e tabelas do domínio de chat (`chat_sessions`, `chat_messages`, `bridge_runs`, etc.) criadas com `nexus_owner`.
5. Isolamento e proteção de Row-Level Security (RLS) testados e validados conectando como `nexus_app`.
6. Suíte de 23 testes contratuais do PostgreSQL aprovada na íntegra na VPS (`✔ pass 23, fail 0`).
O marco alcança 18% de 18% concluído. A arquitetura de Auth e App API/BFF segue em M4.

**Objetivo:** estabelecer o banco próprio antes de migrar fluxos de produto.

**Dependência:** inventário de tabelas, políticas, funções, triggers e jobs do
legado.

**Entregas:** Compose do PostgreSQL, ferramenta de migrations, roles com menor
privilégio, modelo de tenant, RLS, seed de teste, backup lógico Restic, restore
drill isolado, observabilidade sanitizada e ledger de migração.

**Decisão vigente:** [ADR-0002](../decisions/ADR-0002-postgresql-runtime-roles-and-rls.md)
e [desenho da fundação](../plans/2026-09-10-postgresql-foundation-design.md).
Os procedimentos operacionais estão em
[runbook da fundação](../operations/postgresql-foundation.md),
[runbook de backup e restore](../operations/postgresql-backup-restore.md) e
[runbook de observabilidade](../operations/postgresql-observability.md).

**Critérios de saída:**

- migrations sobem uma base vazia e são testadas em CI/local;
- testes provam negação anônima, cross-tenant e por papel;
- usuário da aplicação não tem `BYPASSRLS` nem privilégios de owner;
- backup lógico e restore drill são exercitados e comprovados;
- inventário Supabase possui destino explícito para cada objeto.

**Inventário vigente:**
[capacidades Supabase e destinos locais](supabase-capability-inventory.md).
O ledger automatizado reconcilia todos os 2.672 objetos DDL e agora integra
revisões humanas incrementais versionadas em `docs/migration/supabase-ledger/reviews/`.

**Plano ativo:**
[2026-09-10-postgresql-recovery-observability-ledger-review-implementation.md](../plans/2026-09-10-postgresql-recovery-observability-ledger-review-implementation.md).

## M4 — Auth e App API/BFF

**Estado:** M4 **concluído com sucesso na VPS em 2026-09-13**. A camada de aplicação,
identidade, controle de acesso e BFF foi homologada em produção:
1. Migration `0005_auth_sessions.sql` aplicada no PostgreSQL de produção sob advisory lock, adicionando tabelas `iam.user_credentials`, `iam.user_sessions`, funções de segurança `iam.authenticate_by_email` e `iam.resolve_session` e hardening de RLS.
2. Tenant principal (`prometeus`, display name: `Prometeus Marketing`) e primeiro usuário administrador provisionados com hash bcrypt seguro (12 rounds) de forma atômica no banco.
3. Papel `nexus_app` validado conectando na rede interna do PostgreSQL (`172.16.6.2:5432`) utilizando o secret `/etc/ens/secrets/postgres/app`.
4. Serviço App API (`services/app-api`) implementado com Fastify 5, sessões por cookies `HttpOnly`/`SameSite=Lax`, rotas de auth (`/api/auth/*`), chat (`/api/chat/*`) e administração protegida por RBAC (`/api/admin/users/*`).
5. Suíte de testes da App API executada na VPS: 74/74 testes aprovados (`✔ pass 74, fail 0`).
6. Suíte de testes do frontend `chat-web`: 164/164 testes aprovados (40 arquivos), tela `UserManagement.tsx` 100% migrada das Edge Functions do Supabase para a API nativa.
7. Homologação integrada E2E executada com sucesso no runtime de produção da VPS (`test_app_api_e2e`):
   - Negação de senha incorreta (`401 Unauthorized`);
   - Login com credenciais válidas (`200 OK` + emissão do cookie seguro `ens_session`);
   - Resolução de sessão autenticada (`200 OK` com dados do admin e tenant);
   - Negação anônima de endpoint administrativo (`401 Unauthorized`);
   - Acesso autorizado a `/api/admin/users` retornando listagem do tenant;
   - Encerramento de sessão via `POST /api/auth/logout` (`200 OK`);
   - Revogação imediata comprovada pós-logout (`401 Unauthorized`).

O marco alcança 18% de 18% concluído. O progresso global da migração atinge 70%. As capacidades locais substitutas seguem em M5.

**Objetivo:** centralizar identidade, tenant, autorização e contratos públicos.

**Dependência:** ADR de Auth/sessões e M3.

**Entregas:** login/logout/refresh, sessão segura, middleware de autorização, App
API/BFF e migração gradual do frontend.

**Critérios de saída:**

- fluxos de autenticação e recuperação aprovados passam;
- aplicação estabelece contexto PostgreSQL com segurança transacional;
- frontend não usa o banco ou Hermes diretamente;
- testes negativos cobrem sessão inválida, expirada, replay e cross-tenant;
- auditoria registra ações administrativas relevantes.

## M5 — Capacidades locais substitutas

**Estado:** M5 **concluído com sucesso na VPS em 2026-09-13**. A stack de aplicação substituta dos serviços gerenciados (Supabase) e a operação de chat em produção foram homologadas:
1. Stack Docker `ens-app` criada (`infra/app/compose.yaml` e `compose.production.yaml`) contendo 4 serviços orquestrados operando em estado ativo e saudável (`Up healthy`): `app-api` (BFF Fastify 5), `artifact-server` (CAS de anexos/avatares), `chat-bridge` (Runs/SSE Bridge gateway) e `chat-web` (React 18 + Nginx reverse proxy).
2. Traefik configurado em modo `host` roteando HTTPS com TLSv1.3 e certificados válidos Let's Encrypt para a porta 8080 do `chat-web`.
3. Smoke test integrado automatizado (`scripts/smoke-app-stack.mjs`) executado com sucesso na VPS validando conectividade e health dos 4 componentes (`PASS`).
4. Homologação manual E2E de ponta a ponta no navegador confirmando ausência total de dependências ou chamadas para `supabase.co` e execução de conversa real com resposta em streaming do Hermes no perfil `ens`.
5. Eliminação de legado: arquivo `@/lib/supabase` completamente removido do repositório, URLs de anexos/avatares migradas para a App API, expurgo do módulo `ValidatedWorks` e desacoplamento do `services/marketing-ops/src/config.ts`.

O marco alcança 14% de 14% concluído. O progresso global da migração atinge 84%. A ativação do ecossistema Marketing Ops, schemas restantes e cutover de dados seguem em M6.

**Objetivo:** substituir facilitadores do Supabase por componentes operáveis na
VPS.

**Escopo a decidir por ADR:** object storage, URLs assinadas, funções, jobs,
filas, cron, realtime e envio de eventos. Todas as decisões devem resultar em
componentes operados pelo ENS e não podem reintroduzir uma dependência da
plataforma Supabase.

**Critérios de saída:**

- cada capacidade usada pelo legado tem substituto ou remoção aprovada;
- Artifact Server controla blobs sem armazená-los no PostgreSQL;
- jobs são idempotentes e observáveis;
- retries e dead letters são testados onde houver processamento assíncrono;
- Marketing Ops MCP não depende de credenciais Supabase.

## M6 — Migração de dados e cutover

**Objetivo:** transportar dados aceitos e trocar tráfego sem perda silenciosa.

**Dependências:** M3, M4, M5 e ensaio de migração.

**Entregas:** extratores, transformações, cargas idempotentes, reconciliação,
janela de freeze ou dual-write aprovado, plano de cutover e rollback.

**Critérios de saída:**

- contagens, checksums e invariantes reconciliam por tenant;
- amostras funcionais e artefatos são validados;
- ensaio completo mede duração e limites da janela;
- decisão go/no-go e responsáveis estão registrados;
- rollback não depende de improviso durante a janela.

**Situação em 2026-09-14:** a origem legada foi deliberadamente descartada pelo
responsável e o domínio começou vazio. Migrations `0001`–`0016`, backup Restic,
containers privados, BFF, flags progressivas, criação/leitura de campanha e
consulta MCP pelo Hermes oficial foram comprovados na VPS. A tentativa de
executar um plano após confirmação textual falhou fechado: o Chat Bridge dependia
de `/v1/internal/marketing-ops-decision`, ausente no Hermes oficial, e o
`plan_token` não atravessou o novo turno. Nenhuma mutação ou approval foi criado.

**Gate complementar local aprovado em 2026-09-15:** o
[card estruturado e botão Executar plano](../plans/2026-09-14-structured-marketing-ops-plan-execution-design.md)
conforme a [ADR-0004](../decisions/ADR-0004-structured-marketing-ops-plan-execution.md),
passou o [plano de implementação TDD](../plans/2026-09-14-structured-marketing-ops-plan-execution-implementation.md),
o smoke autenticado 14/14 e o rollback por flags. O ensaio repetiu um plano
inerte com a mesma chave e comprovou 1 plano, 1 approval pendente, 0 decisões e
0 ações externas. O Hermes oficial descobriu as 10 ferramentas na rede
descartável; o Playwright real validou o card persistido, enquanto 7 cenários
controlados provaram o clique sem segunda Run. O checkpoint produtivo pelo operador
ainda é obrigatório; até sua validação, M6 permanece **não concluído**. O
procedimento completo está preparado como Checkpoint 5 no
[runbook de cutover](../operations/m6-marketing-ops-cutover.md), sem autorização
para execução automática na VPS.

**Incidente de homologação em 2026-09-15:** o Checkpoint 5 implantou a release
`f2a598f`, a migration `0017`, as flags estruturadas e o profile ENS. Todos os
serviços e o MCP ficaram saudáveis. A leitura autenticada funcionou, mas a
preparação do plano falhou fechado com `401 delegation_invalid`. A análise
sanitizada da sessão comprovou que o JWT oficial emitido para a Run tinha
fingerprint `8d8aa0d20c32f2f2`, enquanto o argumento enviado pelo modelo tinha
fingerprint `ea9e310df5df11a3`, comprimento diferente, outro `jti` e um escopo a
menos. `iat`, `exp` e vínculo da Run permaneciam iguais. Portanto, não houve
falha de relógio, TTL, chave, OAuth ou refresh: o modelo reconstruiu uma
credencial assinada que deveria ter sido copiada byte a byte. Nenhum plano,
approval ou efeito externo foi criado.

A correção aprovada está no
[desenho de delegação opaca](../plans/2026-09-15-opaque-marketing-ops-delegation-design.md):
o Chat Bridge entrega ao Hermes somente `mopref_...`, resolve a referência por
canal interno autenticado e emite o JWT real apenas servidor a servidor. O
Hermes oficial e o fluxo do botão permanecem inalterados. O gate produtivo só
pode reabrir depois da suíte local integral e do novo Checkpoint 6 do runbook.

**Gate local da correção aprovado em 2026-09-16:** o runner PostgreSQL isolado
validou frontend 193/193, Marketing Ops 291 testes aprovados com 2 E2E
deliberadamente ignorados, Chat Bridge 131/131, Artifact Server 13/13 e App API
87/87. Typechecks, builds, contratos App 11/11, contratos Hermes 22/22 e profile
ENS também passaram. O ensaio integral da stack descobriu 10 ferramentas no
Hermes oficial, passou Playwright real, smoke autenticado 14/14, comprovou 1
plano, 1 approval pendente, 0 decisões, 0 ações externas e rollback por flags.
O próximo gate é exclusivamente o Checkpoint 6 operado pelo responsável na VPS.

**Incidente de homologação em 2026-09-17:** o botão **Executar plano** concluiu
uma vez o pacote inerte e criou exatamente uma solicitação operacional pendente,
sem decisão nem ação externa. A ausência de botão para o solicitante foi
confirmada como separação de funções: uma solicitação operacional exige um
manager/admin diferente para decidir. A tentativa de criar esse segundo gestor
pelo painel falhou fechada com PostgreSQL `42501` em `iam.principals`. O
diagnóstico confirmou App API conectada como `nexus_app`, grants presentes e a
ausência, no banco histórico, das políticas RLS de escrita/leitura administrativa
para `iam.principals` e `iam.memberships`. A correção versionada é a migration
`0018_iam_admin_tenant_rls.sql`, acompanhada de contexto transacional na App API.
Após sua aplicação, a listagem funcionou, mas a criação continuou negada porque o
`INSERT ... RETURNING` exigia uma política `SELECT` antes de a membership do novo
principal existir. A correção complementar remove esse `RETURNING`, preserva a
transação principal/credencial/membership e possui teste de regressão. Ela requer
somente rebuild/recreate da App API na VPS; a decisão humana e o encerramento de
M6 continuam bloqueados até a criação do segundo gestor e a decisão do pacote
inerte serem homologadas.

## M7 — Hardening e retirada do legado

**Objetivo:** operar a nova plataforma como sistema oficial e remover acessos
temporários.

**Critérios de saída:**

- CA-001 a CA-009 do PRD comprovados;
- SLOs, alertas, retenção, RPO e RTO aprovados;
- restauração e rollback exercitados na topologia de produção;
- Supabase, Graph MCP, Neo4j e fork Hermes não aparecem no caminho de produção;
- dashboard Hermes público é retirado ou possui nova decisão explícita;
- credenciais antigas são revogadas e infraestrutura legada é desativada de
  forma recuperável.

## Rastreabilidade mínima

Cada PR ou commit de fase deve citar:

- o marco (`M1`, `M2`, ...);
- requisitos (`RF-*`/`RNF-*`) afetados;
- teste ou comando que comprova o critério;
- ADR aplicável;
- risco ou dívida deliberadamente adiada.

