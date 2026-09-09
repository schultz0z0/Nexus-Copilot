# Desenho M2 — Chat Bridge sobre a Runs API oficial do Hermes

**Estado:** Aceito

**Data da decisão:** 2026-09-09

**Marco:** M2 — protocolo oficial do agente
**Requisitos relacionados:** RF-004, RF-005, RNF-002, RNF-004, RNF-006,
RNF-007 e RNF-008

## Objetivo

Remover do caminho de conversa textual as dependências de endpoints privados do
fork antigo, mantendo o contrato público usado pelo frontend e integrando o Chat
Bridge à Runs API oficial do Hermes Agent `v2026.8.27` / `0.20.6`.

O Hermes continua sendo uma dependência oficial, interna e autenticada. O
monorepo não vendoriza nem altera seu core.

## Decisão

Adotar um adaptador híbrido, orientado às capacidades verificadas no pin oficial:

- conversa textual sem anexos usa `POST /v1/runs`;
- arquivos com `extracted_text` podem compor a entrada textual do Run;
- Picture, imagens e anexos binários sem texto extraído continuam
  temporariamente na Session API oficial;
- o frontend mantém seus endpoints de produto e nunca acessa Hermes
  diretamente;
- o Bridge é o único consumidor da API interna do Hermes e preserva os eventos
  normalizados para replay por cursor;
- aprovação e cancelamento passam a ser operações oficiais, vinculadas ao Run;
- a seleção de transporte admite rollback explícito para Session API sem
  alterar o contrato do browser.

Essa é uma compatibilidade temporária, não uma segunda arquitetura permanente.
Picture e anexos multimodais migram para Runs quando um pin oficial testado
oferecer contrato multimodal suficiente.

## Contrato preservado no produto

O browser continua usando a fronteira do produto:

```text
POST /api/chat/runs
GET  /api/chat/runs/{bridgeRunId}/events?cursor=N
GET  /api/chat/runs/{bridgeRunId}
POST /api/chat/runs/{bridgeRunId}/stop
```

O identificador exposto ao browser é o `bridgeRunId`. O `hermesRunId` permanece
interno e só é usado pelo Bridge para falar com o Hermes. A App API/BFF assumirá
essa fronteira pública no M4; o M2 não antecipa identidade ou autorização de
negócio.

## Fluxo alvo

```text
Browser
  -> App API/BFF (fronteira alvo; ainda em migração)
    -> Chat Bridge / RunStore
      -> capability gate
      -> Runs API oficial (texto)
      -> Session API oficial (multimodal temporário)
        -> Hermes oficial + profile ens
```

### Submissão textual

1. O Bridge valida o pedido e cria um `bridgeRunId` estável.
2. O adaptador verifica `/v1/capabilities` de forma preguiçosa e armazena apenas
   um resultado válido em cache.
3. O Bridge envia `POST /v1/runs`, com `Idempotency-Key` derivada do
   `bridgeRunId`, `session_id` estável e entrada textual.
4. A resposta vincula o `hermesRunId` ao Run do produto.
5. Um único consumidor lê o SSE do Hermes e persiste cada evento normalizado no
   RunStore.
6. O browser consome e retoma eventos pelo cursor do Bridge.
7. Se o stream upstream encerrar antes de um estado terminal, o Bridge consulta
   `GET /v1/runs/{run_id}` como fallback de estado; isso não é replay do SSE.

### Seleção de transporte

Runs é selecionado quando todas as condições abaixo forem verdadeiras:

- a experiência não é Picture;
- nenhum anexo é imagem;
- todo anexo presente possui texto extraído não vazio.

Caso contrário, o pedido usa a Session API oficial. A variável
`HERMES_TEXT_TRANSPORT=session` permite rollback operacional temporário do
tráfego textual; o padrão alvo é `runs`.

## Capabilities e falha fechada

Antes do primeiro Run, o cliente exige as capacidades oficiais usadas pelo M2:

- `run_submission`;
- `run_status`;
- `run_events_sse`;
- `run_stop`;
- `run_approval_response`;
- `approval_events`.

Ausência de uma capacidade, resposta inválida ou endpoint incompatível impede
a submissão por Runs e produz erro operacional identificável. Não haverá
downgrade silencioso, pois isso esconderia divergência de versão. O rollback
para Session é uma decisão explícita de configuração.

Provider ausente deve ser distinguido de Hermes indisponível: capabilities e
health podem estar saudáveis mesmo quando um Run não consegue chamar um modelo.

## Eventos, reconexão e estado

O SSE oficial do pin atual é uma fila transitória e não oferece contrato de
replay com cursor ou `Last-Event-ID`. Portanto:

- somente o Bridge mantém a conexão upstream;
- cada evento aceito recebe cursor monotônico no RunStore;
- reconexões do browser retomam pelo cursor do Bridge;
- o Bridge não abre consumidores upstream concorrentes para o mesmo Run;
- após reinício do processo, um Run local não terminal continua sendo marcado
  como interrompido até a persistência PostgreSQL ser implementada no M3.

Os eventos normalizados incluem deltas, status, arquivos, metadados, solicitação
de aprovação, conclusão, falha e cancelamento.

## Aprovações

O proxy WebSocket legado para `/api/approvals/ws` deixa de ser a fonte de
aprovações. O Bridge consome `approval.request` no SSE do Run, persiste o pedido
normalizado e o associa simultaneamente ao usuário, `bridgeRunId`,
`hermesRunId` e `request_id`.

A resposta do produto é traduzida para:

```text
POST /v1/runs/{hermesRunId}/approval
```

Somente escolhas aceitas pelo contrato oficial (`once`, `session`, `always` e
`deny`) podem ser encaminhadas. Pedidos inexistentes, já resolvidos,
pertencentes a outro usuário ou a outro Run falham fechados.

Existe risco externo conhecido no comportamento de aprovações seguras da versão
`0.20.6`. O contrato será automatizado localmente, mas o aceite ponta a ponta de
aprovar e negar exige provider configurado pelo operador. Não será habilitado
modo inseguro para contornar o upstream.

## Stop e estados terminais

`POST /api/chat/runs/{bridgeRunId}/stop` valida propriedade do Run e chama
`POST /v1/runs/{hermesRunId}/stop`. A resposta intermediária `stopping` não é
tratada como conclusão. O Run termina somente ao observar estado `cancelled`,
`completed` ou `failed` pelo SSE ou pela consulta de status.

## Segurança e observabilidade

- a chave do Hermes existe somente no processo do Bridge;
- URLs, chaves, prompts completos e corpos sensíveis não entram em logs;
- erros registram classe, status HTTP, Run interno quando seguro e request ID;
- idempotência evita criar dois Runs upstream para a mesma submissão;
- a API Hermes e o Bridge permanecem sem publicação direta;
- identidade, tenant e autorização continuam responsabilidade da aplicação.

## Alternativas consideradas

### 1. Adaptador híbrido orientado a capabilities — escolhida

Entrega imediatamente o protocolo oficial para texto, preserva Picture enquanto
o pin não suporta a entrada necessária e mantém rollback explícito.

### 2. Migrar todo o tráfego, inclusive imagens, para Runs

Rejeitada neste pin. O parser de entrada de Runs em `v2026.8.27` é orientado a
texto e descarta partes multimodais que o produto precisa preservar.

### 3. Expor o protocolo Hermes diretamente ao frontend

Rejeitada. Vazaria acoplamento e credencial interna, impediria aplicar
autorização de produto e tornaria o browser dependente de mudanças upstream.

## Testes e evidências

O M2 deve produzir:

- testes unitários do cliente Runs, capabilities, idempotência e taxonomia de
  erros;
- testes do parser para aprovação, cancelamento e estados terminais;
- testes de seleção Runs/Session por tipo de entrada;
- testes de servidor para submissão, replay por cursor, aprovar, negar e stop;
- smoke autenticado de `/v1/capabilities` no container oficial fixado;
- teste real com provider para run completo, aprovação, rejeição e
  cancelamento antes do aceite final.

## Critérios de aceite

1. Conversa textual usa somente endpoints oficiais de Runs.
2. Picture e multimodal continuam funcionais pela Session API oficial, com a
   dívida explicitamente registrada.
3. O contrato público atual do frontend continua compatível.
4. Replay do browser usa cursor persistido pelo Bridge e não depende de replay
   inexistente no SSE upstream.
5. Aprovação, negação e stop são vinculados ao Run e falham fechados.
6. Capabilities incompatíveis impedem Runs sem downgrade silencioso.
7. Nenhuma credencial, estado Hermes ou alteração de core entra no Git.
8. Testes locais registram resultados reais; smoke com provider fica pendente
   até configuração manual pelo operador.

## Dívidas deliberadamente adiadas

- mover o RunStore de JSON para PostgreSQL no M3;
- colocar integralmente o endpoint público atrás da App API/BFF no M4;
- migrar Picture e binários para Runs após novo pin oficial compatível;
- executar o smoke com provider e a validação na VPS, sempre pelo operador
  humano conforme os runbooks.
