# M6 — Execução estruturada de planos do Marketing Ops

**Estado:** Aceito; implementação pendente  
**Data:** 2026-09-14  
**Marco:** M6 — gate complementar obrigatório  
**Decisão:** [ADR-0004](../decisions/ADR-0004-structured-marketing-ops-plan-execution.md)

## 1. Objetivo

Substituir a confirmação conversacional baseada em texto por uma confirmação de
produto explícita, determinística e auditável. Depois que o Hermes preparar um
plano pelo MCP, o usuário verá um card estruturado no chat e poderá clicar em
**Executar plano**. O clique executará exatamente o plano exibido, sem criar um
novo turno do Hermes e sem pedir ao modelo que interprete a intenção novamente.

Esta melhoria faz parte do M6. O marco permanece incompleto até que o fluxo seja
implementado, testado no Docker Desktop e homologado na VPS pelo operador.

## 2. Evidência e causa-raiz

### 2.1 O que já foi comprovado

Na produção assistida de 2026-09-14:

- migrations `0001`–`0016` estão aplicadas e a segunda execução foi idempotente;
- backup Restic pré-mudança foi criado e verificado;
- Marketing Ops, App API, Chat Bridge, Chat Web e Hermes ficaram saudáveis;
- a configuração Hermes passou a usar `http://marketing-ops:8091/mcp`;
- o Hermes descobriu as 10 ferramentas do MCP;
- leitura autenticada pelo frontend/BFF passou;
- uma campanha foi criada do zero e lida pelo Hermes;
- flags de leitura, escrita e approvals foram ativadas progressivamente;
- `marketing_ops_prepare_plan_v1` produziu um plano válido;
- nenhum efeito indevido ocorreu quando a execução foi negada.

Campanha de homologação registrada como evidência sanitizada:

- ID: `d32a43e0-30b2-4f4d-bc58-a173e951dabd`;
- nome: `Campanha de Homologação M6 — 2026-09-14`;
- estado observado: `draft`, versão 1.

Plano mais recente da tentativa:

- ID: `8ecdee9b-a0fe-457b-b4e1-d4d6ef08c6c1`;
- hash: `dd1732d71741eace773b0640041850dffaffafa033b95aa10355f933cb070129`;
- ação: submissão de approval operacional inerte;
- resultado: preparado, não executado, sem approval criado.

### 2.2 Falha determinística

`services/chat-bridge/src/server.js` chama
`POST /v1/internal/marketing-ops-decision` no host do Hermes. Esse endpoint não
faz parte da API oficial v2026.8.27. Qualquer não-2xx vira `clarify`; em seguida,
`confirmationIntentForMarketingOpsDecision` só transforma `approve` em
`confirmation_intent=true`. Assim, uma confirmação humana escrita corretamente
continua chegando ao Marketing Ops como não confirmada.

Além disso, `marketing_ops_execute_plan_v1` exige o `plan_token` retornado pela
preparação. Na execução real, esse segredo não estava disponível no novo turno.
Memória do modelo, texto do assistente ou histórico de tool calls não são um
cofre de credenciais nem uma fronteira confiável de confirmação.

## 3. Princípios

1. **O card é dados, não texto.** Ele nasce de um endpoint autenticado, não de
   Markdown ou parsing da resposta do agente.
2. **O clique é a confirmação.** Não existe classificador de linguagem natural
   entre o usuário e a mutação.
3. **Execução exata.** O servidor usa o plano persistido e confirma o hash visto
   pelo cliente.
4. **Autoridade correta.** Marketing Ops controla estado e execução; App API
   controla sessão; PostgreSQL controla persistência/RLS.
5. **Hermes oficial.** Nenhum patch, endpoint privado ou fork é permitido.
6. **Fail-closed.** Qualquer ambiguidade, expiração ou divergência impede escrita.

## 4. Fluxo-alvo

```text
Usuário pede uma mudança
  -> App API / Chat Bridge cria Run autenticada
  -> Hermes oficial chama marketing_ops_prepare_plan_v1
  -> Marketing Ops valida e persiste plano imutável pending
  -> resposta do agente pode explicar o plano, mas não é autoridade
  -> frontend consulta planos pending da sessão pela App API
  -> card exibe ações, riscos, expiração e hash curto
  -> usuário clica "Executar plano"
  -> App API valida sessão e assina a chamada interna exata
  -> Marketing Ops bloqueia a linha, revalida e executa
  -> resultado/auditoria são persistidos e retornados ao card
```

O clique não envia mensagem ao Hermes, não inicia Run e não usa
`marketing_ops_execute_plan_v1`.

## 5. Modelo de dados

Adicionar a migration `0017_marketing_ops_prepared_plans.sql` e a tabela
`marketing_ops.prepared_agent_plans`.

| Campo | Contrato |
| --- | --- |
| `id` | UUID do plano, chave primária |
| `tenant_id` | FK `iam.tenants`, parte de toda autorização |
| `prepared_by` | FK `iam.principals`, usuário que solicitou o plano |
| `chat_session_id` | UUID da conversa do produto |
| `source_run_id` | UUID da Run que preparou o plano |
| `prepared_delegation_jti` | vínculo de auditoria; não é segredo |
| `plan_hash` | SHA-256 hexadecimal do array canônico de ações |
| `actions` | JSONB validado, máximo de 20 ações |
| `required_scopes` | lista canônica derivada das ações |
| `status` | `pending`, `executing`, `completed`, `partial`, `failed`, `expired`, `invalidated` |
| `expires_at` | expiração absoluta, no máximo 30 minutos após criação |
| `execution_key` | chave de idempotência única após primeiro clique |
| `execution_started_at` | início/lease da tentativa atual |
| `execution_attempts` | contador limitado para diagnóstico e recuperação |
| `result` | envelope sanitizado da execução, nulo enquanto pending |
| `executed_by`/`executed_at` | ator e instante da execução |
| `created_at`/`updated_at` | auditoria temporal |

Invariantes no banco:

- `FORCE ROW LEVEL SECURITY`, owner `nexus_owner`, acesso mínimo a `nexus_app`;
- tenant/ator/sessão/hash/actions/escopos imutáveis após insert;
- índice parcial por `(tenant_id, prepared_by, chat_session_id, expires_at)`
  para planos `pending`;
- unicidade de `execution_key` dentro do tenant;
- check de estados e transições; estados terminais são irreversíveis;
- payload e resultado têm limites de tamanho;
- nenhuma coluna armazena `plan_token` ou `delegation_token`.

Planos vencidos podem ser materializados como `expired` por atualização
oportunista na consulta/execução; não é necessário um worker para o primeiro
corte.

## 6. Preparação pelo MCP

`marketing_ops_prepare_plan_v1` continuará validando o schema de ações, flags,
delegação, membership e escopos. A diferença é que a mesma operação criará o
registro `pending` antes de responder.

Resposta pública proposta:

```json
{
  "plan": {
    "id": "uuid",
    "hash": "sha256",
    "status": "pending",
    "expires_at": "ISO-8601",
    "actions": []
  },
  "persisted": true,
  "confirmation": "product_ui_required"
}
```

O `plan_token` deixa de ser necessário para o fluxo de navegador. Durante a
transição, ele pode continuar no resultado MCP somente para compatibilidade da
tool existente, sempre redigido fora do processo. Removê-lo ou versionar o
contrato fica fora deste corte e exige compatibilidade explícita.

Preparação repetida com o mesmo `(tenant, user, run, hash)` deve devolver o
mesmo plano pending, não criar cards duplicados. Preparar novo hash invalida o
plano pending anterior da mesma Run.

## 7. Contrato App API/BFF

Rotas públicas same-origin:

```text
GET  /api/marketing/agent-plans?chat_session_id=<uuid>&status=pending
POST /api/marketing/agent-plans/:planId/execute
```

O `GET` retorna somente planos do usuário/tenant autenticado e usa paginação
limitada. O `POST` recebe:

```json
{ "planHash": "sha256" }
```

e exige `Idempotency-Key`. A App API remove headers de identidade fornecidos
pelo browser, deriva usuário/tenant da sessão e assina método + caminho na
asserção interna BFF existente.

Rotas privadas equivalentes no Marketing Ops:

```text
GET  /v1/agent-plans
POST /v1/agent-plans/:planId/execute
```

Erros estáveis esperados:

- `plan_not_found` — 404 também para plano de outro ator/tenant;
- `plan_hash_mismatch` — 409;
- `plan_expired` — 410;
- `plan_not_pending` — 409;
- `plan_precondition_failed` — 409;
- `feature_disabled` — 503;
- `membership_denied` — 403.

## 8. Execução transacional e concorrência

1. Em uma transação curta com contexto `app.*`, buscar o plano com lock de linha,
   validar tenant/ator/hash/status/expiração e reservar a execução com
   `Idempotency-Key`, `executing` e lease temporal.
2. Executar o executor de planos já existente sem aceitar ações do request. Cada
   ação conserva sua transação/idempotência de domínio e o resultado pode ser
   `completed`, `partial` ou `failed`.
3. Em outra transação curta, persistir resultado terminal, auditoria e
   correlação da tentativa.

A implementação deve reutilizar `executeMarketingOpsPlan`, mas a camada de
serviço não deve fabricar um `DelegatedActor` falso. Ela cria um
`CommandContext` BFF autenticado e um plano validado a partir do registro.

Dois cliques concorrentes não podem repetir efeitos. O segundo aguarda o lock e
recebe o resultado idempotente ou `plan_not_pending` estável. Se o processo cair
em `executing`, somente a mesma chave pode retomar após uma lease curta; o
executor por ação absorve o replay. Uma chave diferente recebe conflito. Se a
execução produz `partial`, o plano é terminal; retry de ações exige novo plano.

## 9. Card e UX

O card aparece associado à sessão de chat e, quando disponível, à Run de origem.
Ele contém:

- estado visível: pronto, executando, concluído, parcial, falhou, expirou ou
  invalidado;
- lista numerada de ações em linguagem de produto, construída por renderers
  tipados de cada `action.type`;
- recursos afetados, riscos, precondições e expiração;
- hash curto e ID copiáveis para suporte, sem segredos;
- botão primário **Executar plano**;
- botão secundário **Descartar plano** apenas numa extensão posterior; neste
  corte, deixar expirar é suficiente.

O botão:

- só aparece com `write=true`; ações `approval.*` também exigem
  `approvals=true`;
- fica desabilitado durante a chamada e após estado terminal;
- pede confirmação nativa somente para risco crítico definido pelo servidor;
- usa uma chave UUID de idempotência criada no primeiro clique e preservada
  durante retries do mesmo card;
- atualiza o card com o resultado sem enviar conteúdo ao chat.

Em `approval.submit_*`, o texto após sucesso deve dizer claramente
“Solicitação de aprovação criada — pendente”. Nunca usar “ação aprovada” ou
“ação executada externamente”.

Acessibilidade: botão alcançável por teclado, nome acessível explícito, estado
busy anunciado por `aria-live`, foco preservado e cores não usadas como único
sinal.

## 10. Remoção da dependência do fork

Depois que o novo fluxo passar:

- remover `resolveRunMarketingOpsDecision` e a chamada
  `/v1/internal/marketing-ops-decision` do Chat Bridge;
- remover `marketing_ops_decision` do caminho de confirmação de planos;
- não instruir o modelo a interpretar “sim”, “aprovo” ou equivalentes para
  executar o plano do navegador;
- manter emissão de delegação de leitura/preparação com
  `confirmation_intent=false`;
- atualizar a skill ENS para explicar que a confirmação ocorre no card;
- manter o core e a imagem do Hermes sem alterações.

Uma remoção maior das estruturas de delegação só pode ocorrer após inventário de
outros MCPs que ainda as utilizem.

## 11. Observabilidade

Métricas mínimas, sem labels de usuário/tenant/plano:

- `marketing_ops_prepared_plans_total{result}`;
- `marketing_ops_plan_execution_total{result}`;
- `marketing_ops_plan_execution_latency_seconds`;
- `marketing_ops_pending_plans`;
- `marketing_ops_plan_expirations_total`;
- `marketing_ops_plan_idempotency_total{result}`.

Logs usam correlation ID, `plan_id`, hash curto, tipo/quantidade de ações e
estado. Não registram tokens nem payloads completos. Auditoria de domínio deve
ligar preparação e execução pelos IDs de plano, Run e sessão.

## 12. Flags e rollout

Adicionar uma flag server-side e uma de build do frontend:

- `MARKETING_OPS_STRUCTURED_PLAN_EXECUTION`;
- `VITE_MARKETING_OPS_STRUCTURED_PLAN_EXECUTION`.

As duas nascem `false`. Ordem:

1. migration e backend com flag desligada;
2. frontend com card oculto;
3. gate local completo no Docker Desktop;
4. backup e migration na VPS pelo operador;
5. habilitar backend e validar plano pending via API;
6. habilitar frontend e homologar um plano inerte;
7. remover a dependência privada do Bridge apenas após o gate produtivo;
8. manter rollback images e backup até fechamento do M6.

Rollback imediato: desligar as duas flags e recriar Marketing Ops/Chat Web. Os
planos pending ficam inertes e podem expirar; não apagar tabela nem dados.

## 13. Critérios de aceite

O gate complementar do M6 só fecha com evidência de que:

- Hermes oficial prepara e persiste um plano sem fork;
- o card aparece somente ao usuário/tenant/sessão corretos;
- texto do assistente não cria card falso;
- o botão executa exatamente o hash exibido sem nova Run Hermes;
- expiração, hash divergente, cross-user, cross-tenant, flags desligadas e replay
  são negados;
- duplo clique/retry não repete efeitos;
- plano de approval inerte cria exatamente uma solicitação `pending` e nenhuma
  decisão/ação externa;
- auditoria correlaciona preparação, clique e resultado;
- o código ativo não referencia `/v1/internal/marketing-ops-decision`;
- suítes focadas, integrações PostgreSQL, serviços, frontend, Compose, smoke MCP
  e Playwright passam no Docker Desktop;
- o operador repete a homologação na VPS com impacto, resultado, parada e
  rollback registrados.

## 14. Fora de escopo

- modificar ou fazer fork do Hermes;
- interpretar confirmação escrita para executar planos;
- aprovar automaticamente solicitações de governança;
- executar integrações externas reais durante o primeiro gate;
- guardar plano no Chat Bridge ou no estado do modelo;
- redesenhar a fila de approvals existente;
- desativar toda delegação MCP de uma vez.

## 15. Riscos principais

| Risco | Mitigação |
| --- | --- |
| card não corresponde ao plano | resposta estruturada + hash + plano server-side |
| clique duplicado | lock de linha + idempotência persistente |
| autorização envelhecida | membership/flags revalidadas no clique |
| action ficou obsoleta | versões e precondições revalidadas pelo executor |
| plano sensível exposto | sem tokens no browser/log; renderers allowlistados |
| deploy parcial | flags independentes, backend primeiro, rollback por flags |
| falsa sensação de approval | copy específica: criação `pending`, sem autoaprovação |
