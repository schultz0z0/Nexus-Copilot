# M6: recibos de plano e planejamento sequencial no mesmo chat

## Contexto

A homologação manual do M6 confirmou o fluxo completo de leitura, preparação,
execução pelo botão e aprovação segregada. Ela também revelou duas lacunas de
experiência:

1. depois da execução, a consulta do Chat Web removia o plano terminal da tela,
   deixando o usuário sem um comprovante persistente do resultado;
2. depois de um plano anterior terminar, o Hermes podia interpretar o histórico
   como se o chat inteiro tivesse perdido autorização e recusar um novo plano até
   o usuário insistir ou repetir uma autorização textual.

O backend já aceita planos sequenciais. A segunda falha é de contrato
conversacional, não uma limitação técnica do Marketing Ops.

## Decisão

O M6 terá um card canônico por plano. Enquanto o plano estiver pendente, o card
exibe a revisão e o único botão `Executar plano`. Depois de qualquer estado
terminal, o mesmo card se torna um recibo imutável e continua visível após
refetch ou recarga da página.

Um chat pode ter vários planos ao longo do tempo, mas somente um plano pendente
por vez para aquele usuário e sessão. Um plano pode conter várias ações
relacionadas, como já ocorre. Um novo pedido de mutação feito depois que o plano
anterior ficou terminal inicia um novo Run, recebe uma nova referência opaca e
prepara um novo card. O plano anterior não autoriza o novo e não bloqueia a
continuidade do chat.

## Invariantes de segurança

- O core do Hermes não será alterado.
- Cada mensagem que inicia trabalho de escrita cria um Run novo e recebe uma
  referência opaca nova, vinculada ao usuário, tenant, sessão e Run atuais.
- Tokens, referências opacas, confirmações e resultados do histórico nunca são
  reutilizados para autorizar um Run posterior.
- O Hermes não pede confirmação textual para executar. O usuário executa o
  plano exclusivamente pelo botão autenticado no produto.
- Um plano pendente pode ser revisado pelo mesmo fluxo existente, que invalida a
  versão anterior antes de persistir a nova. Não haverá dois cards executáveis
  simultâneos.
- Um plano terminal (`completed`, `partial`, `failed`, `expired` ou
  `invalidated`) não concede autorização, escopo ou idempotência ao próximo.
- O Hermes só informa que a delegação atual é inválida quando a chamada MCP do
  Run atual realmente retorna uma falha sanitizada de delegação. Ele não infere
  expiração a partir do histórico nem pede que o usuário “autorize novamente”
  por texto.
- A separação de deveres para approvals continua inalterada.

## Contrato conversacional

O profile ENS e o contrato injetado pelo Chat Bridge devem ensinar a mesma
regra:

1. conclua o plano atual e encerre aquele turno;
2. se uma mensagem posterior trouxer um novo pedido de mutação e não houver
   plano pendente, trate-a como novo trabalho no mesmo chat;
3. use somente a referência opaca injetada no Run atual;
4. leia o estado atual necessário, prepare um plano novo e apresente o novo
   card;
5. não trate a conclusão, aprovação, rejeição, expiração ou invalidação do plano
   anterior como encerramento permanente da capacidade de planejar na sessão.

Se ainda houver um plano pendente, uma alteração do usuário continua sendo uma
revisão daquele plano e invalida a versão anterior. Um pedido não relacionado
deve ser esclarecido antes de substituir o plano pendente, evitando dois
compromissos executáveis concorrentes.

## Consulta e persistência dos recibos

O endpoint de listagem continuará seguro e limitado por ator, tenant e
`chat_session_id`. O comportamento padrão permanece `pending` para preservar
compatibilidade. O frontend poderá solicitar uma visão `all`, limitada e
ordenada do mais recente para o mais antigo, para recuperar tanto o plano
pendente quanto recibos terminais da sessão.

O DTO seguro de plano passa a incluir apenas metadados de resultado necessários
à apresentação do recibo:

- status e timestamps de criação, atualização e execução;
- resultado sanitizado já persistido (`completed`, `failed`, `pending` e
  `deep_links`);
- ações e hash já expostos hoje.

Campos internos de delegação, identidade, idempotência e execução continuam
fora do navegador. A resposta permanece limitada; o Chat Web não reconstrói
resultado a partir de mensagens do modelo.

## UX do card

O card mantém sua geometria e linguagem visual atuais e passa a representar os
estados abaixo:

| Estado | Sinal principal | Ação disponível |
|---|---|---|
| `pending` | Pendente, prazo e resumo das ações | `Executar plano` |
| `executing` | Execução em andamento | nenhuma ação duplicada |
| `completed` sem pendência | Concluído, horário e links retornados | abrir recurso, quando houver |
| `completed` com approval pendente | Solicitação enviada para aprovação, horário e link retornado | abrir approval, quando houver |
| `partial` | Concluído parcialmente, contagens e falhas sanitizadas | nenhuma; novo plano é necessário |
| `failed` | Falhou, com mensagem sanitizada | nenhuma; novo plano é necessário |
| `expired` | Expirado | nenhuma |
| `invalidated` | Substituído por revisão | nenhuma |

O feedback terminal será inline e persistente, com `role=status`/região viva
quando a transição ocorre. Toast pode complementar, mas nunca será a única
confirmação. Estados terminais não exibem botão de execução.

O card mais recente fica ancorado junto ao fim da conversa, como hoje. Recibos
anteriores permanecem ordenados e limitados para não crescer a tela ou a
resposta sem controle.

## Fluxo de dados

```text
Novo pedido no mesmo chat
  -> Chat Bridge cria novo Run e injeta nova referência opaca
  -> Hermes lê o estado atual e chama prepare_plan
  -> PostgreSQL persiste um único plano pendente da sessão
  -> Chat Web lista os planos recentes da sessão
  -> usuário clica Executar plano
  -> App API/BFF executa com idempotência
  -> Marketing Ops persiste status e resultado terminal
  -> Chat Web atualiza/refaz a consulta
  -> card permanece como recibo após reload
```

## Tratamento de erro

- Falha de rede durante a execução mantém o card visível e mostra erro inline.
  A mesma chave de idempotência permanece no componente durante a tentativa.
- Resposta terminal persistida prevalece sobre estado local transitório.
- Resultado ausente em um registro legado ainda produz um recibo de status, sem
  inventar recursos ou links.
- Links são renderizados somente quando vierem em `deep_links` do servidor.
- Erros de delegação só alteram a fala do Hermes quando pertencem ao Run atual.

## Estratégia TDD

1. Contrato do profile/Bridge: adicionar testes que falham se o prompt não
   declarar planos sequenciais, referência nova por Run e proibição de
   reautorização textual inferida.
2. Repositório/serviço HTTP: testar listagem `all`, limite/ordenação, DTO
   sanitizado com resultado e manutenção do default `pending`.
3. Cliente/BFF: testar propagação de `status=all` sem ampliar a superfície de
   autorização.
4. Chat Web: testar que consulta planos recentes, mantém recibo terminal após
   refetch, não mostra botão terminal e apresenta sucesso, approval pendente,
   parcial, falha, expiração e invalidação.
5. Integração/E2E: Run A prepara e conclui; Run B, na mesma sessão, recebe outra
   referência e prepara novo plano sem autorização textual; somente o plano
   pendente mais recente é executável.
6. Regressão: executar suites completas de Marketing Ops, App API, Chat Bridge,
   Chat Web, distribuição Hermes, typechecks, builds e smoke local em Docker.

## Rollout e rollback

O profile ENS recebe nova versão para tornar a mudança auditável. O deploy
recria somente os serviços alterados e atualiza o profile oficial. Antes da
recriação, imagens atuais recebem tags de rollback. A ativação não altera banco
nem exige migration: a coluna de resultado já existe em
`marketing_ops.prepared_agent_plans`.

Na VPS, a homologação final deve comprovar:

1. plano A executado e mantido como recibo após reload;
2. novo pedido no mesmo chat gera plano B sem insistência ou autorização textual;
3. plano B usa outro Run/referência e exige novo clique;
4. nenhum card terminal volta a ser executável;
5. approval pendente e sua decisão continuam segregados e visíveis.

## Critérios de aceite

- O usuário vê confirmação persistente de sucesso, pendência de approval,
  falha, expiração ou substituição.
- Recarregar o chat não apaga o recibo.
- Um segundo plano pode ser preparado no mesmo chat depois que o primeiro ficou
  terminal, sem texto de reautorização.
- Nunca existem dois planos executáveis simultâneos para a sessão.
- Cada plano sequencial exige Run, referência opaca, persistência e clique
  próprios.
- Nenhum segredo, token, JTI, idempotency key ou claim interno chega ao browser.
- As fronteiras Browser -> App API/BFF -> Marketing Ops e Chat Bridge -> Hermes
  permanecem intactas.
