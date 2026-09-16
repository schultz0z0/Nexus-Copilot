# M6 — Referência opaca de delegação do Marketing Ops

**Estado:** Aceito  
**Data:** 2026-09-15  
**Marco:** M6 — gate complementar obrigatório  
**Decisão relacionada:** [ADR-0004](../decisions/ADR-0004-structured-marketing-ops-plan-execution.md)

## 1. Objetivo

Retirar o JWT de delegação do contexto do modelo sem modificar o core do
Hermes. Durante uma Run, o Hermes recebe apenas uma referência opaca curta. O
Marketing Ops resolve essa referência diretamente com o Chat Bridge por uma
rota interna autenticada e só então valida o JWT real.

O contrato externo das ferramentas permanece compatível: o argumento continua
se chamando `delegation_token`, mas, no canal Hermes do navegador, seu valor é
uma referência `mopref_...`, não um JWT. Automações internas existentes ainda
podem enviar um JWT assinado diretamente.

## 2. Incidente que motivou a correção

Na homologação produtiva de 2026-09-16, uma leitura autenticada passou, mas a
preparação do plano falhou com `delegation_invalid`. A coleta sanitizada
comprovou:

- relógios de host, Chat Bridge e Marketing Ops idênticos;
- TTL emitido de 90 segundos e limite de 120 segundos;
- `kid`, chaves internas e URL de refresh coerentes;
- falha cerca de 43 segundos após o início da Run;
- JWT oficial da Run com fingerprint `8d8aa0d20c32f2f2` e 936 caracteres;
- valor enviado pelo modelo ao `prepare_plan` com fingerprint
  `ea9e310df5df11a3` e 915 caracteres;
- o segundo valor preservou `iat`, `exp` e a Run, mas alterou `jti` e removeu
  `content:write`, invalidando a assinatura.

O Marketing Ops recusou a chamada corretamente. Nenhum plano, approval ou
efeito externo foi criado. A causa-raiz é arquitetural: um segredo longo e com
estrutura semântica estava sendo transportado pelo contexto probabilístico do
modelo e dependia de reprodução literal em cada tool call.

## 3. Opções consideradas

### A. Referência opaca efêmera no Chat Bridge — escolhida

O Bridge cria uma referência aleatória curta, guarda somente seu hash associado
à Run ativa e a entrega ao Hermes. O Marketing Ops envia a referência ao
Bridge por uma rota interna autenticada e recebe um JWT novo por canal
servidor-servidor.

Vantagens: o JWT nunca chega ao modelo; não há migration; a referência não
revela claims; restart ou término da Run a invalida; o core Hermes não muda.
Limitação aceita: uma Run em andamento não sobrevive ao restart do Bridge, o que
já corresponde ao comportamento operacional atual.

### B. Referência persistida no PostgreSQL

Permitiria sobreviver a restart e múltiplas réplicas, mas adicionaria migration,
limpeza, estado durável de credencial e uma superfície maior sem necessidade no
deployment atual de réplica única. Fica fora do M6.

### C. JWT menor ou instruções mais fortes ao modelo

Rejeitada. Reduzir claims, aumentar TTL ou reforçar prompt não remove o modelo
do transporte do segredo e não oferece garantia determinística.

## 4. Arquitetura

```text
Chat Bridge cria Run autenticada
  -> registra hash(mopref aleatória) -> run_id em memória
  -> envia somente mopref ao Hermes oficial
  -> Hermes chama tool MCP com delegation_token=mopref
  -> Marketing Ops reconhece o prefixo mopref_
  -> POST interno /internal/marketing-ops/delegations/resolve
  -> Chat Bridge valida chave interna, referência, TTL e Run ativa
  -> Chat Bridge emite JWT real com ator/tenant/sessão/Run/scopes oficiais
  -> Marketing Ops valida assinatura, claims, membership e scopes
  -> ferramenta executa leitura ou prepara plano
  -> término da Run revoga a referência
```

O navegador continua sem acesso ao Hermes, ao MCP, à referência e ao JWT. O
botão **Executar plano** continua chamando apenas a App API/BFF e não reutiliza
essa delegação.

## 5. Componentes e contratos

### 5.1 Registro efêmero no Chat Bridge

Um módulo isolado mantém dois índices em memória:

- hash SHA-256 da referência para `{runId, expiresAt}`;
- `runId` para o hash atual, tornando emissão idempotente por Run.

A referência usa 18 bytes aleatórios em base64url com prefixo `mopref_`. O
valor bruto nunca aparece em logs. O registro:

- aceita apenas o formato canônico;
- expira no máximo na janela de refresh configurada;
- usa relógio injetável nos testes;
- revoga por Run no bloco de finalização;
- remove entradas expiradas oportunisticamente.

### 5.2 Resolução interna

Nova rota privada:

```text
POST /internal/marketing-ops/delegations/resolve
X-Internal-Key: <chave já compartilhada para refresh>
{ "delegation_reference": "mopref_..." }
```

O Bridge retorna `{delegation_token, expires_at}` apenas quando:

- a chave interna é válida;
- a referência existe e não expirou;
- a Run vinculada ainda está `running`;
- a Run ainda corresponde ao ator, tenant, sessão e papel persistidos.

Referência ausente, alterada, expirada, revogada ou ligada a Run terminal
retorna uma negação genérica, sem revelar qual verificação falhou.

### 5.3 Resolução no Marketing Ops

O verificador de delegação recebe uma credencial:

- `mopref_...`: resolve uma vez no Bridge e valida o JWT retornado;
- JWT com três segmentos: mantém o fluxo atual para automação compatível;
- qualquer outro formato: falha como `delegation_invalid`.

A resolução tem timeout curto, tamanho de resposta limitado e usa a mesma
chave interna do refresh. Falha de rede, resposta inválida ou status de negação
nunca vira permissão implícita.

## 6. Segurança

- O JWT real não entra no prompt, histórico, tool arguments produzidos pelo
  modelo ou banco de sessões do Hermes.
- A referência é uma capacidade efêmera e deve receber a mesma redação de
  logs aplicada a tokens.
- O Bridge é a única autoridade que transforma referência em identidade e
  scopes; o Marketing Ops nunca confia em claims enviados pelo modelo.
- O endpoint de resolução fica somente na rede interna e exige comparação em
  tempo constante da chave compartilhada.
- O JWT retornado ainda passa por todas as validações atuais de assinatura,
  issuer, audience, lifetime, membership e scopes.
- A referência não participa da execução pelo botão; o clique conserva o
  contrato BFF e a idempotência do plano persistido.

## 7. Erros e observabilidade

Erros externos permanecem sanitizados como `delegation_invalid` ou
`delegation_scope_denied`. Logs estruturados podem registrar somente:

- resultado `resolved`, `unknown`, `expired`, `revoked`, `run_not_active` ou
  `upstream_error`;
- correlation ID e Run ID quando já conhecidos internamente;
- duração e contador, nunca referência, JWT, hash integral ou payload.

O texto de produto não deve afirmar que uma credencial expirou sem evidência
específica; deve informar apenas que a autorização segura da operação falhou.

## 8. Testes TDD

1. Registro emite referência curta, opaca e estável por Run.
2. Referência desconhecida, alterada, expirada e revogada falha fechada.
3. Rota exige chave interna e Run ativa.
4. Prompt do Hermes recebe `mopref_...` e não recebe JWT.
5. Cliente do Marketing Ops resolve a referência e rejeita respostas inválidas.
6. Verificador aceita referência resolvida e preserva JWT direto compatível.
7. MCP prepara plano usando referência sem expor o JWT ao modelo.
8. Compose passa a configurar a rota interna sem publicar portas.
9. Testes de regressão confirmam refresh, RLS, BFF, card e execução idempotente.

Cada comportamento deve ser observado falhando antes da implementação.

## 9. Rollout e rollback

O rollout reconstrói somente Chat Bridge e Marketing Ops. App API, Chat Web,
PostgreSQL, Hermes oficial e profile ENS não precisam de mudança de contrato.
Uma nova sessão de chat é obrigatória depois do deploy para evitar histórico
com JWT antigo.

Rollback restaura as imagens anteriores de Chat Bridge e Marketing Ops em
conjunto. Não há migration para desfazer. Durante rollout parcial, o sistema
deve falhar fechado; nunca habilitar fallback que aceite referência sem
resolução.

## 10. Critérios de aceite

- nenhum JWT de delegação aparece nas mensagens armazenadas da nova Run;
- a mesma referência é copiada em leituras e preparação, sem claims editáveis;
- uma referência adulterada é negada e não aciona refresh permissivo;
- o plano inerte é persistido e o card confiável aparece;
- o clique executa pelo BFF sem nova Run e cria exatamente um approval pending;
- nenhuma decisão de approval ou ação externa é executada;
- testes locais, smoke Docker e homologação produtiva sanitizada passam;
- M6 permanece aberto até toda essa evidência ser revisada.
