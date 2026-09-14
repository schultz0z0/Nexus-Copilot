# Prompt de handoff — implementar execução estruturada de planos do M6

Copie o bloco abaixo integralmente para o agente responsável pela implementação.

---

Você é o agente implementador do novo monorepo ENS. Implemente a melhoria de
execução estruturada de planos do Marketing Ops seguindo estritamente os
documentos já aprovados no repositório.

## Objetivo

Quando o Hermes oficial chamar `marketing_ops_prepare_plan_v1`, o Marketing Ops
deve persistir o plano imutável. O frontend deve buscar esse plano estruturado
pela App API/BFF, exibir um card confiável e oferecer o botão explícito
**Executar plano**. O clique executa exatamente o ID/hash exibidos, de modo
idempotente e auditado, sem enviar nova mensagem/Run ao Hermes e sem o modelo
reinterpretar a confirmação.

## Leia antes de alterar código

1. `AGENTS.md` e todas as instruções de escopo aplicáveis;
2. `docs/decisions/ADR-0004-structured-marketing-ops-plan-execution.md`;
3. `docs/plans/2026-09-14-structured-marketing-ops-plan-execution-design.md`;
4. `docs/plans/2026-09-14-structured-marketing-ops-plan-execution-implementation.md`;
5. `docs/plans/2026-09-13-m6-marketing-ops-and-cutover-design.md`;
6. `docs/operations/m6-marketing-ops-cutover.md`;
7. `docs/architecture/target-architecture.md`.

O plano de implementação datado de 2026-09-14 é a sequência obrigatória. Use os
skills `executing-plans`, `test-driven-development`,
`verification-before-completion` e `requesting-code-review` se estiverem
disponíveis.

## Regras invioláveis

- Não modifique, vendorize ou faça fork do Hermes Agent.
- Não crie substituto para `/v1/internal/marketing-ops-decision`.
- Não use interpretação de texto para autorizar escrita.
- Não guarde o plano no Chat Bridge ou na memória do modelo.
- Não envie `plan_token`, `delegation_token`, segredo ou credencial ao browser,
  logs, commits ou documentação.
- Não crie cards a partir de Markdown/texto do assistente.
- Browser fala somente com App API/BFF; nunca com Hermes/PostgreSQL/MCP direto.
- PostgreSQL é a autoridade e Marketing Ops é dono do ciclo de vida do plano.
- Não introduza Supabase, Graph MCP ou Neo4j.
- Não acesse nem altere a VPS. Produção é operada exclusivamente pelo humano.
- Não use credenciais reais nem dados pessoais. Use fixtures sintéticas e um
  approval operacional totalmente inerte.
- Não marque M6 como concluído; falta homologação produtiva posterior.

## Método obrigatório

1. Confirme branch/árvore limpa e crie uma branch de feature com prefixo
   `codex/` se nenhuma tiver sido fornecida. Não trabalhe diretamente em `main`.
2. Execute a baseline relevante antes de editar e registre falhas preexistentes.
3. Para cada tarefa do plano: teste vermelho primeiro, menor implementação,
   teste verde focado, suíte afetada, pequeno commit.
4. Não avance quando um teste falhar sem causa explicada.
5. Use `apply_patch` para edições e preserve mudanças alheias já existentes.
6. Depois dos testes de serviço, execute o gate completo e o ensaio no Docker
   Desktop descritos na Task 12.
7. Solicite/revise code review antes de afirmar que a implementação terminou.
8. Prepare o checkpoint de produção, mas pare sem executá-lo.

## Decisões de contrato já tomadas

- Migration: `0017_marketing_ops_prepared_plans.sql`.
- Tabela: `marketing_ops.prepared_agent_plans`, sob `FORCE RLS`.
- Estados: `pending`, `executing`, `completed`, `partial`, `failed`, `expired`,
  `invalidated`.
- Rotas públicas:
  - `GET /api/marketing/agent-plans?chat_session_id=<uuid>&status=pending`;
  - `POST /api/marketing/agent-plans/:planId/execute`.
- Execução recebe apenas `{ "planHash": "sha256" }` e exige
  `Idempotency-Key`.
- Rotas internas equivalentes usam `/v1/agent-plans`.
- Ações vêm sempre do plano persistido; action enviada pelo request é inválida.
- O botão se chama exatamente **Executar plano**.
- Preparação MCP passa a responder `persisted:true` e
  `confirmation:"product_ui_required"`.
- O `plan_token` pode permanecer temporariamente apenas no resultado MCP por
  compatibilidade; ele nunca faz parte do REST/frontend.
- Plano de `approval.submit_*` cria somente uma solicitação `pending`; não decide
  approval e não executa integração externa.
- As flags `MARKETING_OPS_STRUCTURED_PLAN_EXECUTION` e
  `VITE_MARKETING_OPS_STRUCTURED_PLAN_EXECUTION` começam desligadas.

## Evidência mínima exigida

Entregue testes para sucesso e negação de: hash divergente, expiração,
cross-user, cross-tenant, membership revogada, flags desligadas, replay, duplo
clique, concorrência e lease de execução interrompida. Prove também que:

- texto falso do assistente não cria card;
- clique não cria uma nova Run Hermes;
- exatamente um approval `pending` é criado no cenário inerte;
- nenhuma decisão de approval ou ação externa é criada;
- logs/DTO/bundle não contêm tokens;
- a referência ativa ao endpoint Hermes privado foi removida;
- Compose de produção não publica Marketing Ops/Hermes/PostgreSQL.

## Entrega e parada

Ao final, não faça deploy e não mexa na VPS. Não faça merge/push em `main` sem
ordem explícita do responsável. Retorne:

- branch e commits;
- arquivos alterados;
- testes executados com contagens e resultados;
- evidência do Docker Desktop e rollback por flags;
- achados de code review e correções;
- riscos restantes;
- caminho do checkpoint produtivo preparado;
- confirmação explícita de que M6 continua aberto para validação independente e
  homologação humana na VPS.

---
