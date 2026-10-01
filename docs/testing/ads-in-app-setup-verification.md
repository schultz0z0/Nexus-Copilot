# Evidência de validação do cadastro Ads

Escopo: configurar e trocar os aplicativos Meta Ads, Google Ads e LinkedIn Ads
pelo app, mantendo autorização e seleção/troca de conta. Plano:
`../plans/2026-09-30-ads-in-app-setup.md`.

## Verificações concluídas

- App API/BFF: **102 testes passaram**, sem falhas ou testes pulados. Inclui
  proxy administrativo, identidade assinada e erros que não expõem o corpo com
  credenciais. Comando: `rtk proxy npm test` em `services/app-api`.
- Marketing Ops: **391 testes passaram, 2 testes antigos pulados**. Banco
  PostgreSQL isolado; migrations **0001–0021** e replay idempotente verificados.
  Execução serial com `tmp/ads-test-serial.mjs --marketing-ops-only`, cópia local
  do harness do repositório com um worker. O ambiente isolado foi removido.
- Casos focados do cadastro incluem persistência cifrada/reinício, chave ausente,
  papéis canônicos e tenant, preservação de segredo vazio, configuração externa,
  conflito de versão, replay, falhas de persistência, callbacks e sincronizações
  em andamento durante troca. O teste de sincronização conserva a medição anterior
  e cancela a operação antiga, sem gravar na configuração nova.
- Build TypeScript do servidor e nomes de volume distintos para dois projetos
  Compose verificados durante a implementação.
- Revisões SPEC e qualidade do servidor aprovadas. A revisão detectou um callback
  persistido que divergia da origem atual após mudança de domínio; a correção
  passou em duas regressões adicionais. Autorização e troca do código usam a
  origem atual; sem origem, metadados permanecem seguros e OAuth fica bloqueado.
  Gate focado após a correção: **37 testes passaram**.
- Migração `0021` aplicada no banco de avaliação local, sem reaplicar migrations
  anteriores. Marketing Ops e App API reconstruídos pelo helper local que
  conserva segredos e sessão existentes.
- Imagem Linux em execução: usuário **1000 (`node`)**, diretório privado **700**,
  arquivo de chave **600**. Reinício real do serviço conserva a chave; readiness
  voltou a responder. A chave e seu hash não foram exibidos.
- BFF real local: GET administrativo seguro dos três provedores, callbacks
  corretos, ausência de credenciais na resposta e bloqueio de autorização sem
  preparo verificados. Nenhum aplicativo fictício foi cadastrado.
- Frontend, App API, Marketing Ops, Chat Bridge e Artifact Server responderam
  **HTTP 200** nos respectivos endpoints locais após a atualização do backend.

- Frontend: **274 testes passaram em 52 arquivos**. TypeScript da aplicação passou; lint terminou com **0 erros e 10 avisos já existentes**. Gates finais executados pelo helper local `tmp/ads-ui-final-gates.py` (unit/types/lint).
- Revisão SPEC da interface aprovada após três regressões: refetch não altera a versão revisada, retry conserva versão/modo/chave e campo Google avançado inválido abre antes de receber foco.
- Revisão de qualidade da interface aprovada, sem achados P1/P2.
- **14 E2E passaram**, com HTTP simulado dos provedores: os três cadastros até
  autorização e conta, troca com segredo preservado, takeover externo, retry,
  conflito, papéis, teclado, foco e telas de 320, 390, 768 e 1440 px.
  Comando: `tmp/ads-ui-final-gates.py fake-e2e`.
- Build Docker final concluído; frontend novo publicado em
  `http://127.0.0.1:8088`. Os serviços afetados estão saudáveis; `nginx -t`
  passou. Os cinco endpoints locais responderam HTTP 200 após o build.
- **3 testes no stack real local passaram**: formulários administrativos dos
  três provedores em desktop e celular, URLs de retorno, DTO sem segredo,
  fechamento com Escape e retorno do foco, reflow e Axe; campanhas e esteira
  carregam pelo BFF autenticado. Comando: `tmp/ads-ui-final-gates.py local`.
  Nenhum cadastro de aplicativo foi gravado nesses testes.
- Na primeira leitura Axe, a animação de entrada ainda estava interpolando a
  opacidade. O teste passou a aguardar o término da animação e opacidade 1 antes
  de medir contraste. Não houve supressão de regras nem mudança de cores.
- O probe real do BFF foi repetido após o build: os três provedores continuam
  honestamente sem aplicativos preparados, com metadados administrativos e
  callbacks corretos, sem segredos retornados.

- Revisão integrada final aprovada, sem lacunas P1/P2: contratos entre interface,
  BFF, Marketing Ops e OpenAPI, papéis, retry/revisão, armazenamento privado,
  troca de aplicativo/conta, invalidação de trabalhos anteriores e conservação
  do histórico. Documentação corresponde ao fluxo implementado.

## Limite da evidência externa

Os testes de ciclo completo usam provedores HTTP simulados e banco isolado.
Credenciais fictícias não são cadastradas no banco de avaliação. Nenhuma conta
real de Meta, Google ou LinkedIn foi autorizada nesta evidência; consentimento,
permissões aprovadas e acesso externo dependem do aplicativo da empresa.
