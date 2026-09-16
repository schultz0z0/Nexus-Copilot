# ADR-0004 — Execução estruturada de planos do Marketing Ops

**Estado:** Aceito  
**Data:** 2026-09-14  
**Marco:** M6 — migração de dados e cutover

## Contexto

O M6 comprovou em produção assistida que o Hermes oficial consegue descobrir e
usar o MCP `nexus_marketing_ops`, inclusive preparar um plano imutável com
`marketing_ops_prepare_plan_v1`. A execução posterior, contudo, dependia de duas
premissas que não existem no runtime oficial:

1. o Chat Bridge consultava o endpoint privado
   `/v1/internal/marketing-ops-decision` para transformar texto livre em
   `approve`, `revise`, `reject` ou `clarify`;
2. o modelo precisava recuperar o `plan_token` secreto de um tool result antigo
   e usá-lo em outro turno.

No Hermes oficial v2026.8.27, o endpoint privado retorna rota inexistente. O
Bridge converte silenciosamente qualquer resposta não-2xx em `clarify`, emite a
delegação seguinte com `confirmation_intent=false` e o Marketing Ops nega a
execução. Na homologação de 2026-09-14, o plano foi preparado, a confirmação foi
fornecida pelo usuário, nenhuma mutação foi executada e nenhuma aprovação foi
criada. Esse comportamento fail-closed foi seguro, mas mostrou que o fluxo não é
operável sem uma nova fronteira.

## Opções consideradas

### A. Plano durável no Marketing Ops e botão explícito no frontend

O MCP prepara e persiste um plano imutável. A App API expõe esse objeto
estruturado à sessão autenticada. O frontend renderiza um card confiável e o
botão **Executar plano** chama a App API, que ordena a execução exata ao
Marketing Ops. O modelo não interpreta a confirmação e não participa do clique.

### B. Cofre de tokens no Chat Bridge

O Bridge guardaria o token e executaria o MCP após um evento do frontend. Foi
rejeitada porque atribui estado e autoridade de domínio ao adaptador
conversacional, duplica idempotência e mantém um segredo transitando por uma
camada que não precisa dele.

### C. Botão que envia uma nova mensagem ao Hermes

Foi rejeitada porque preserva o modelo no caminho crítico, continua dependendo
da memória entre turnos e permite nova interpretação de linguagem natural após
o usuário já ter aprovado um plano específico.

## Decisão

Adotar a opção A.

- `services/marketing-ops` é a autoridade sobre planos preparados, seu ciclo de
  vida, execução, idempotência e auditoria.
- A App API/BFF é a única fronteira pública para consultar e executar planos.
- O frontend só mostra um card de execução a partir de resposta estruturada da
  App API; nunca extrai ações, IDs, hashes ou estado do texto do assistente.
- O botão **Executar plano** envia apenas o identificador, o hash observado e uma
  chave de idempotência. O plano completo e qualquer material secreto ficam no
  servidor.
- A execução revalida usuário, tenant, membership, flags, expiração, status,
  hash, escopos e precondições de cada ação antes de mutar dados.
- O core do Hermes permanece oficial e inalterado. O fluxo do navegador não
  depende de endpoints privados ou de classificação de texto do Hermes.
- `marketing_ops_execute_plan_v1` pode continuar disponível a canais futuros
  que entreguem confirmação estruturada, mas não é a confirmação do navegador.

### Adendo de segurança — referência opaca por Run (2026-09-16)

A homologação do botão revelou uma segunda fronteira: o JWT curto de delegação
era incluído no contexto do Hermes para ser passado como argumento MCP. O modelo
reconstruiu o valor com outro `jti` e outro conjunto de escopos, invalidando a
assinatura. O serviço falhou fechado, mas a preparação deixou de ser operável.

Fica decidido que o Chat Bridge entrega ao Hermes apenas uma referência
`mopref_...`, curta, aleatória ao observador, estável durante uma única Run e
revogada ao seu término. O Bridge mantém somente o vínculo hash-indexado entre
referência e Run; ele não funciona como cofre de JWT. Quando o Marketing Ops
recebe a referência, usa uma rota interna autenticada para resolvê-la; o Bridge
confirma que a Run ainda está ativa e emite um JWT novo servidor a servidor. O
verificador JWT, os escopos, a membership e as regras de replay permanecem
inalterados. JWT assinado direto continua aceito apenas para automações
compatíveis.

A opção B original continua rejeitada: não há persistência ou recuperação de
token pelo adaptador conversacional. O registro opaco guarda identidade de Run,
tem expiração curta, vive somente em memória e nunca concede autoridade sem a
emissão e verificação criptográfica normais.

## Consequências

### Positivas

- a confirmação humana é um evento inequívoco e ligado ao plano exato;
- o modelo não pode trocar, completar ou reinterpretar ações após o clique;
- expiração, replay e concorrência são controlados pela autoridade de domínio;
- o produto deixa de depender de um fork do Hermes;
- o fluxo pode ser testado deterministicamente no BFF, banco e navegador.

### Custos

- nova migration e repositório de planos preparados;
- novos endpoints internos e públicos, tipos de frontend e card no chat;
- transição explícita de estado e telemetria adicionais;
- o contrato MCP de preparação passa de `persisted:false` para persistência
  controlada.

## Invariantes de segurança

- Não persistir nem retornar `delegation_token` ou `plan_token` ao navegador.
- Não colocar o JWT de delegação no contexto, histórico ou mensagens do Hermes;
  somente a referência opaca pode atravessar a fronteira do modelo.
- Não registrar tokens, ações sensíveis completas ou segredos em logs.
- Um plano pertence a um único tenant, usuário e sessão de chat.
- `plan_hash` é SHA-256 do payload canônico e nunca pode ser alterado.
- Estados terminais não voltam a `pending`; execução repetida retorna o mesmo
  resultado ou conflito estável, nunca repete efeitos.
- Plano expirado, invalidado, já executado, com ator divergente ou precondição
  obsoleta falha fechado.
- Para `approval.submit_*`, executar o plano apenas cria a solicitação
  `pending`; não aprova nem dispara a ação externa.

## Critério de revisão

Revisar esta decisão apenas se o protocolo oficial do Hermes publicar uma
primitiva estruturada de aprovação que preserve todos os vínculos e garantias
acima. A mera disponibilidade de classificação de texto não é suficiente.

## Referências

- [Desenho da melhoria](../plans/2026-09-14-structured-marketing-ops-plan-execution-design.md)
- [Desenho da delegação opaca](../plans/2026-09-15-opaque-marketing-ops-delegation-design.md)
- [Plano TDD da delegação opaca](../plans/2026-09-15-opaque-marketing-ops-delegation-implementation.md)
- [Desenho original do M6](../plans/2026-09-13-m6-marketing-ops-and-cutover-design.md)
- [ADR-0001 — Hermes oficial](ADR-0001-official-hermes-container-and-ens-profile.md)
- [ADR-0003 — App API/BFF](ADR-0003-auth-sessions-and-app-api.md)
- [Hermes Agent v2026.8.27](https://github.com/NousResearch/hermes-agent/tree/v2026.8.27)
