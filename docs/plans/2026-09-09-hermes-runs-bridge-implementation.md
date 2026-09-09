# Hermes Runs Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrar a conversa textual do Chat Bridge para a Runs API oficial do Hermes, preservando o contrato do frontend e mantendo multimodal temporariamente na Session API oficial.

**Architecture:** O Bridge ganha um cliente pequeno e testável para capabilities e Runs, continua sendo o único consumidor do SSE upstream e persiste eventos normalizados no RunStore. A escolha de transporte é determinística: texto e anexos extraídos usam Runs; Picture, imagens e binários sem extração usam Session. Aprovações e stop são vinculados ao Run oficial e falham fechados.

**Tech Stack:** Node.js 20+, ESM, `fetch`, `node:test`, SSE, JSON RunStore e Docker Compose com a imagem Hermes oficial fixada.

---

## Regras de execução

- Executar no worktree `.worktrees/hermes-runs-bridge`, branch
  `codex/hermes-runs-bridge`.
- Aplicar TDD estrito: teste falhando, implementação mínima, teste passando.
- Não modificar, executar ou instalar o Hermes local do usuário.
- Não vendorizar o core Hermes e não adicionar Supabase, Graph ou Neo4j.
- Não acessar nem alterar a VPS durante os lotes de desenvolvimento local.
- Registrar resultados reais, riscos e dívidas no fim de cada lote.

### Task 1: Cliente oficial de capabilities e Runs

**Files:**

- Create: `services/chat-bridge/src/hermes-runs-client.js`
- Create: `services/chat-bridge/test/hermes-runs-client.test.js`

**Step 1: Write the failing capability tests**

Testar um `HermesRunsClient` com `fetchImpl` injetado:

```js
test("assertCapabilities accepts the pinned Runs contract", async () => {
  const fetchImpl = async () => Response.json({
    features: [
      "run_submission", "run_status", "run_events_sse", "run_stop",
      "run_approval_response", "approval_events",
    ],
  });
  const client = new HermesRunsClient({
    baseUrl: "http://hermes:8642",
    apiKey: "test-key",
    fetchImpl,
  });
  await assert.doesNotReject(() => client.assertCapabilities());
});

test("assertCapabilities fails closed when a feature is missing", async () => {
  // Esperar HermesRunsCapabilityError com code hermes_capability_missing.
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test --prefix services/chat-bridge -- --test-name-pattern="capabilit"`

Expected: FAIL porque `hermes-runs-client.js` ainda não existe.

**Step 3: Implement the minimal capability gate**

Implementar:

```js
export const REQUIRED_RUN_FEATURES = Object.freeze([
  "run_submission",
  "run_status",
  "run_events_sse",
  "run_stop",
  "run_approval_response",
  "approval_events",
]);

export class HermesRunsClient {
  constructor({ baseUrl, apiKey = "", fetchImpl = fetch }) {}
  async assertCapabilities() {}
}
```

Validar URL, status HTTP, JSON e lista de features. Cachear somente sucesso.
Erros devem expor `code` seguro e nunca incluir chave ou corpo sensível.

**Step 4: Add failing request-contract tests**

Cobrir:

- `createRun({ bridgeRunId, payload })` envia `POST /v1/runs`;
- `Idempotency-Key` é exatamente o `bridgeRunId`;
- `Authorization` fica restrito ao cliente;
- resposta sem `run_id` falha;
- `getEvents`, `getRun`, `respondApproval` e `stopRun` montam os endpoints
  oficiais e os corpos aceitos pelo pin;
- escolhas de approval fora de `once|session|always|deny` falham antes do fetch.

**Step 5: Run tests to verify they fail**

Run: `npm test --prefix services/chat-bridge -- --test-name-pattern="RunsClient|approval choice"`

Expected: FAIL nas operações ainda ausentes.

**Step 6: Implement the minimal request methods**

Adicionar métodos pequenos, um `request()` interno e erros tipados por classe:
capability incompatível, autenticação, conflito idempotente, indisponibilidade
e resposta upstream inválida.

**Step 7: Run the focused tests**

Run: `npm test --prefix services/chat-bridge -- --test-name-pattern="RunsClient|capabilit|approval choice"`

Expected: PASS.

**Step 8: Commit**

```bash
git add services/chat-bridge/src/hermes-runs-client.js services/chat-bridge/test/hermes-runs-client.test.js
git commit -m "feat: add official Hermes Runs client"
```

### Task 2: Normalização de approval e cancelamento

**Files:**

- Modify: `services/chat-bridge/src/hermes-events.js`
- Modify: `services/chat-bridge/test/hermes-events.test.js`

**Step 1: Write failing event tests**

Adicionar casos para:

```js
test("parseHermesEventBlock normalizes approval.request", () => {
  const parsed = parseHermesEventBlock(
    'event: approval.request\ndata: {"run_id":"run_1","request_id":"approval_1","choices":["once","deny"],"command":"rm example"}',
    context,
  );
  assert.deepEqual(parsed.events[0], {
    event: "approval",
    data: {
      run_id: "run_1",
      request_id: "approval_1",
      choices: ["once", "deny"],
      summary: "rm example",
    },
  });
});

test("parseHermesStatusPayload preserves cancelled as cancellation", () => {
  // Esperar evento meta run.cancelled + done, sem converter para run.failed.
});
```

Também cobrir `approval.resolved`, `run.stopping` e payloads incompletos.

**Step 2: Run tests to verify they fail**

Run: `node --test services/chat-bridge/test/hermes-events.test.js`

Expected: FAIL nos eventos novos.

**Step 3: Implement minimal event normalization**

Adicionar branches explícitos para approval, stopping e cancelled. Não incluir
comando completo em logs; o evento destinado ao usuário pode carregar somente o
resumo necessário para a decisão.

**Step 4: Run event tests**

Run: `node --test services/chat-bridge/test/hermes-events.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/chat-bridge/src/hermes-events.js services/chat-bridge/test/hermes-events.test.js
git commit -m "feat: normalize Hermes approval and cancellation events"
```

### Task 3: Roteamento híbrido Runs/Session

**Files:**

- Modify: `services/chat-bridge/src/hermes-payloads.js`
- Modify: `services/chat-bridge/test/hermes-payloads.test.js`

**Step 1: Replace the legacy characterization with failing routing tests**

Testar:

```js
assert.equal(selectHermesBridgeMode([], { experience: "chat" }), "runs");
assert.equal(selectHermesBridgeMode([
  { kind: "file", mime_type: "text/plain", extracted_text: "conteudo" },
], { experience: "chat" }), "runs");
assert.equal(selectHermesBridgeMode([
  { kind: "image", mime_type: "image/png" },
], { experience: "chat" }), "session");
assert.equal(selectHermesBridgeMode([], { experience: "picture" }), "session");
assert.equal(selectHermesBridgeMode([
  { kind: "file", mime_type: "application/pdf" },
], { experience: "chat" }), "session");
assert.equal(selectHermesBridgeMode([], {
  experience: "chat",
  textTransport: "session",
}), "session");
```

**Step 2: Run tests to verify they fail**

Run: `node --test services/chat-bridge/test/hermes-payloads.test.js`

Expected: FAIL porque a função ainda retorna sempre `session`.

**Step 3: Implement the pure selector**

Manter a assinatura compatível e implementar uma decisão sem I/O. Valores de
configuração desconhecidos falham fechados para `session`.

**Step 4: Run payload tests**

Run: `node --test services/chat-bridge/test/hermes-payloads.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/chat-bridge/src/hermes-payloads.js services/chat-bridge/test/hermes-payloads.test.js
git commit -m "feat: route textual chat through Hermes Runs"
```

### Task 4: Integrar o cliente Runs ao executor do Bridge

**Files:**

- Modify: `services/chat-bridge/src/server.js`
- Modify: `services/chat-bridge/test/server-runtime-scope.test.js`
- Modify: `services/chat-bridge/test/hermes-state.test.js`

**Step 1: Write failing structural and state tests**

Exigir que o executor:

- construa um `HermesRunsClient` com URL e chave internas;
- use `bridgeRunId` como idempotency key;
- persista `hermes_run_id` antes de consumir eventos;
- mantenha um consumidor upstream por Run;
- consulte status somente se o SSE fechar sem terminal;
- classifique provider ausente separadamente de processo indisponível.

**Step 2: Run focused tests and observe FAIL**

Run: `node --test services/chat-bridge/test/server-runtime-scope.test.js services/chat-bridge/test/hermes-state.test.js`

**Step 3: Replace inline Runs fetches with the client**

Remover a duplicação de `createHermesRun`, `fetchHermesEvents` e
`pollHermesStatus`, preservando `consumeEventsResponse` e o RunStore.

**Step 4: Wire hybrid selection**

Passar `experience` e `HERMES_TEXT_TRANSPORT` ao seletor. Runs é o padrão para
texto; Session permanece para multimodal e rollback explícito.

**Step 5: Run the full Bridge suite**

Run: `npm test --prefix services/chat-bridge`

Expected: todos os testes passam.

**Step 6: Commit**

```bash
git add services/chat-bridge/src/server.js services/chat-bridge/test/server-runtime-scope.test.js services/chat-bridge/test/hermes-state.test.js
git commit -m "refactor: execute Bridge text runs through official client"
```

### Task 5: Aprovações oficiais vinculadas ao Run

**Files:**

- Create: `services/chat-bridge/src/hermes-approvals.js`
- Create: `services/chat-bridge/test/hermes-approvals.test.js`
- Modify: `services/chat-bridge/src/server.js`
- Modify: `services/chat-bridge/test/server-runtime-scope.test.js`
- Verify: `apps/chat-web/src/components/chat/useApprovalStream.ts`

**Step 1: Write failing approval-store tests**

Cobrir associação a usuário/Bridge Run/Hermes Run/request, resolução única,
negação cross-user, escolha inválida e replay de pendências.

**Step 2: Implement the minimal approval registry**

O registro deriva somente de eventos `approval.request` persistidos pelo Bridge.

**Step 3: Replace the legacy upstream approval proxy**

- manter temporariamente o contrato frontend
  `GET /api/approvals/stream` e `POST /api/approvals/respond`;
- remover dependência de `/api/approvals/ws` e `/api/approvals/respond` do fork;
- traduzir a resposta para `POST /v1/runs/{run_id}/approval`.

**Step 4: Run focused and full Bridge tests**

Run: `npm test --prefix services/chat-bridge`

Expected: PASS e nenhum teste estrutural referencia os endpoints privados.

**Step 5: Commit**

```bash
git add services/chat-bridge/src/hermes-approvals.js services/chat-bridge/test/hermes-approvals.test.js services/chat-bridge/src/server.js services/chat-bridge/test/server-runtime-scope.test.js
git commit -m "feat: bridge official run approval flow"
```

### Task 6: Stop oficial e propriedade do Run

**Files:**

- Modify: `services/chat-bridge/src/server.js`
- Modify: `services/chat-bridge/test/server-runtime-scope.test.js`
- Modify: `apps/chat-web/src/components/chat/chatStreamClient.ts`
- Test: `apps/chat-web/src/components/chat/chatStreamClient.test.ts`

**Step 1: Write failing Bridge stop tests**

Cobrir Run inexistente, cross-user, terminal, `stopping` e `cancelled`.

**Step 2: Implement `POST /api/chat/runs/{bridgeRunId}/stop`**

Validar o usuário, buscar o Run, chamar `stopRun` e persistir status/meta sem
marcar conclusão prematura.

**Step 3: Write and implement the frontend client method**

Adicionar somente o método de transporte; o botão visual pode ficar para uma
fatia de UX posterior se ainda não houver local consistente.

**Step 4: Run Bridge and frontend tests**

Run: `npm test --prefix services/chat-bridge`

Run: `npm test --prefix apps/chat-web -- --run`

**Step 5: Commit**

```bash
git add services/chat-bridge/src/server.js services/chat-bridge/test/server-runtime-scope.test.js apps/chat-web/src/components/chat/chatStreamClient.ts apps/chat-web/src/components/chat/chatStreamClient.test.ts
git commit -m "feat: stop Hermes runs through product API"
```

### Task 7: Contrato Docker com o pin oficial

**Files:**

- Create: `infra/hermes/tests/test_runs_contract.py`
- Modify: `infra/hermes/tests/test_smoke.py`
- Modify: `infra/hermes/README.md`

**Step 1: Write the contract test**

Validar no container fixado que `/v1/capabilities` anuncia todos os recursos
exigidos e que endpoints protegidos rejeitam ausência de autenticação. Não
exigir provider.

**Step 2: Run the test against Docker Desktop**

Usar um nome de projeto Compose exclusivo do M2 e volumes exclusivos. Resultado
esperado: capabilities e autenticação passam; execução de modelo fica fora deste
smoke.

**Step 3: Tear down only M2 containers**

Remover containers e rede do projeto M2; preservar ou remover volume somente
conforme o runbook e após conferir o nome absoluto.

**Step 4: Commit**

```bash
git add infra/hermes/tests/test_runs_contract.py infra/hermes/tests/test_smoke.py infra/hermes/README.md
git commit -m "test: verify pinned Hermes Runs contract"
```

### Task 8: Evidências, status e publicação

**Files:**

- Modify: `docs/migration/roadmap.md`
- Modify: `MIGRATION_STATUS.md`
- Modify: `docs/README.md`
- Modify: `docs/plans/2026-09-09-hermes-runs-bridge-implementation.md`
- Create: `docs/operations/hermes-runs-bridge.md`

**Step 1: Run final verification**

Run: `npm test --prefix services/chat-bridge`

Run: `npm test --prefix apps/chat-web -- --run`

Run the existing Artifact Server and relevant Compose render tests.

Expected: suites passam, ou qualquer limitação anterior e não relacionada é
registrada com evidência exata.

**Step 2: Record the acceptance matrix**

Marcar separadamente:

- comprovado localmente;
- pendente de provider;
- pendente de operação na VPS;
- dívida deliberada para M3/M4.

Registrar também que o OAuth do Hostinger Connector foi validado em modo
somente leitura em 2026-09-09; isso não constitui deploy nem altera a fronteira
de produção.

**Step 3: Review secrets and diff**

Run: `git diff --check`

Run buscas direcionadas para `.env`, tokens, credenciais e estado Hermes antes
de adicionar arquivos.

**Step 4: Commit documentation**

```bash
git add docs/migration/roadmap.md MIGRATION_STATUS.md docs/README.md docs/plans/2026-09-09-hermes-runs-bridge-implementation.md docs/operations/hermes-runs-bridge.md
git commit -m "docs: record M2 Runs bridge evidence"
```

**Step 5: Integrate and publish only after all checks pass**

Atualizar a branch `main` sem sobrescrever mudanças do usuário, repetir os
checks essenciais e executar `git push origin main`. Não publicar se houver
divergência ou artefato sensível.

## Registro de execução

### 2026-09-09 — Checkpoint A aprovado localmente

| Tarefa | Evidência | Resultado |
| --- | --- | --- |
| 1 — cliente Runs | `node --test services/chat-bridge/test/hermes-runs-client.test.js` | 10/10; capabilities, idempotência, endpoints oficiais e erros seguros |
| 2 — eventos | `node --test services/chat-bridge/test/hermes-events.test.js` | 17/17; approval request/resolved, stopping e cancellation distintos de falha |
| 3 — roteamento | `node --test services/chat-bridge/test/hermes-payloads.test.js` | 23/23; texto em Runs e fallback explícito/seguro para Session |
| regressão do Bridge | `npm test --prefix services/chat-bridge` | 108/108 |

A primeira execução integral encontrou somente as dependências da worktree
ainda não instaladas (`fflate` e `jose`). `npm ci --prefix
services/chat-bridge`, usando o lockfile versionado, instalou três pacotes sem
vulnerabilidades reportadas; a repetição passou integralmente. Nenhum serviço
externo ou ambiente de produção foi alterado.

Commits funcionais do checkpoint: `3a71e71`, `fc5ea44` e `99e4631`.

## Checkpoints

- **Checkpoint A — após Tasks 1–3:** cliente, eventos e seletor puros aprovados.
- **Checkpoint B — após Tasks 4–6:** servidor integrado, approvals e stop
  aprovados.
- **Checkpoint C — após Tasks 7–8:** contrato Docker, evidências e publicação.

## Gate externo conhecido

O aceite completo de run, approval e stop com modelo exige provider configurado
manualmente pelo operador. A ausência desse smoke não pode ser mascarada por
modo inseguro, mock promovido a evidência real ou alteração do core Hermes.
