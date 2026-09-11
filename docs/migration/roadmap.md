# Roadmap da migração ENS

**Estado geral:** Em execução  
**Atualizado em:** 2026-09-11

## Regra de progressão

Uma fase só muda para **Concluída** quando todos os critérios de saída têm
evidência verificável. Trabalho da fase seguinte pode ser investigado em paralelo,
mas não autoriza remover a infraestrutura anterior antes do gate correspondente.

| Marco | Estado | Resultado principal |
| --- | --- | --- |
| M0 — baseline e memória do projeto | Concluído | monorepo inicial, restrições e documentação canônica |
| M1 — Hermes oficial | Em execução; paridade e recuperação local aprovadas | runtime/profile e restore comprovados; VPS e rollback do core pendentes |
| M2 — protocolo do agente | Em execução; checkpoint C local aprovado | contrato Bridge/Runtime comprovado sem provider; aceite real com provider e VPS pendentes |
| M3 — fundação PostgreSQL | Em execução; fundação, recuperação e observabilidade locais aprovadas | schema, migrações, RLS, backup Restic, restore drill e observabilidade comprovados; VPS e domínios pendentes |
| M4 — Auth e App API/BFF | Pendente | identidade/tenant e frontend sem acesso direto ao legado |
| M5 — capacidades substitutas | Pendente | storage, funções, jobs, realtime e integrações locais |
| M6 — dados e cutover | Pendente | migração validada, reconciliação e troca de tráfego |
| M7 — hardening e retirada do legado | Pendente | operação estável, rollback testado e dependências removidas |

## Estimativa de progresso global

Esta estimativa é um sinal de planejamento, não substitui os critérios de saída.
Cada marco tem peso proporcional ao risco e ao volume esperado; trabalho copiado
do legado sem aceite no alvo não conta como concluído.

| Marco | Peso no programa | Crédito atual estimado | Base da estimativa |
| --- | ---: | ---: | --- |
| M0 | 8% | 8% | concluído |
| M1 | 12% | 9% | paridade e recuperação locais; produção e rollback do core pendentes |
| M2 | 14% | 12% | protocolo local comprovado; RunStore migrado para PostgreSQL; provider real e VPS pendentes |
| M3 | 18% | 16% | fundação, backup/restore, observabilidade e schemas de domínio chat/iam aprovados com Docker; VPS pendente |
| M4 | 18% | 0% | ainda sem aceite de Auth e App API/BFF |
| M5 | 14% | 0% | substitutos ainda não migrados e aceitos |
| M6 | 10% | 0% | dados e cutover ainda não executados |
| M7 | 6% | 0% | hardening e retirada do legado ainda não executados |
| **Total** | **100%** | **45% concluído / 55% restante** | estimativa conservadora em 2026-09-11 |

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

**Situação em 2026-09-09:** a
[paridade Docker Desktop](../operations/hermes-docker-desktop-parity.md) foi
exercitada no projeto isolado `ens-hermes-m1`. Init/update real, um único
gateway `ens`, health/capabilities, restart, recriação e persistência passaram;
o volume de evidência foi preservado e nenhum container ficou ativo.

Em um segundo exercício local, backup/checksum, restore em volume novo e
update/rollback do Profile ENS passaram com smoke autenticado. Os volumes de
origem e restore foram preservados e nenhum container permaneceu ativo.

M1 não está concluído: rollback do core entre dois pins auditados e o deploy VPS
com HTTPS/OAuth real continuam sem exercício. Na produção, o responsável humano
executará os comandos fornecidos e devolverá saídas/logs redigidos para validação;
o agente não acessará a VPS diretamente. A matriz detalhada está no
[plano de implementação](../plans/2026-08-28-hermes-official-runtime-implementation.md#matriz-de-aceite-em-2026-09-09).

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

O M2 permanece em execução: run completo, approval, rejeição e cancelamento com
provider real dependem da configuração manual do operador; a validação de VPS
também continua pendente e não autoriza operação direta pelo agente. O RunStore
foi migrado para o PostgreSQL (tabela `chat.bridge_runs` com PostgREST e cache em
memória ativo) em 2026-09-11; a fronteira pública na App API/BFF segue em M4.

## M3 — Fundação PostgreSQL

**Estado:** Em execução. O runtime, migrations, menor privilégio, RLS e a operação
básica foram aprovados em 2026-09-10. Em 2026-09-11, o lote de recuperação e observabilidade
foi concluído (`nexus_backup`, backup Restic, restore drill e observabilidade com RPO/RTO).
Na sequência, o lote de schemas de domínio (`chat` e evolução de `iam`) foi implementado
através da migration `0004_chat_store.sql` e verificado via Docker Desktop:
tabelas `chat_sessions`, `chat_messages`, `chat_session_summaries`, `chat_confidence_logs`,
`chat_session_hermes_state` e `bridge_runs`, índices em FKs, triggers automáticas de
`updated_at`, e extensão de `iam.principals` (email único, full_name) e `user_chat_integrations`.
Todos os testes contratuais e de integração contra contêiner PostgreSQL 18.6 real foram
aprovados. O deploy assistido na VPS continua pendente antes do encerramento deste marco.

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

