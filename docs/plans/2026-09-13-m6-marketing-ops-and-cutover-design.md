# M6 — Marketing Ops, dados e cutover

**Estado:** Em execução; gate complementar de execução estruturada pendente  
**Data:** 2026-09-13  
**Marco:** M6 — migração de dados e cutover  
**Escopo desta etapa:** design somente; nenhuma alteração de runtime, migration ou produção está autorizada por este documento.

## 1. Objetivo

Ativar o domínio Marketing Ops no monorepo ENS sobre o PostgreSQL próprio, publicar sua API apenas por meio da App API/BFF, disponibilizar suas ferramentas MCP ao Hermes oficial e migrar os dados aceitos do legado Supabase com carga idempotente, reconciliação verificável e rollback ensaiado.

O M6 termina quando campanhas, produção, calendário, conteúdo, aprovações e operações assistidas pelo Hermes usam a nova autoridade PostgreSQL sem perda silenciosa e sem dependência de autenticação, roles, claims, SDKs ou endpoints Supabase.

> **Extensão aprovada em 2026-09-14:** a homologação produtiva revelou que a
> confirmação textual de um plano depende de endpoint privado ausente no Hermes
> oficial e da recuperação de um token entre turnos. O M6 não termina sem o card
> estruturado e o botão **Executar plano** definidos no
> [desenho complementar](2026-09-14-structured-marketing-ops-plan-execution-design.md)
> e na [ADR-0004](../decisions/ADR-0004-structured-marketing-ops-plan-execution.md).

> **Extensão aprovada em 2026-09-16:** a primeira homologação do botão falhou
> fechado antes de persistir o plano porque o JWT de delegação atravessava o
> contexto do modelo e foi reconstruído. O M6 também exige a
> [delegação opaca por Run](2026-09-15-opaque-marketing-ops-delegation-design.md),
> mantendo JWTs somente no canal servidor a servidor e sem alterar o core do
> Hermes.

## 2. Restrições invariantes

- O core do Hermes não será vendorizado nem modificado. Toda integração ficará em `agents/ens`, no Chat Bridge e no serviço `services/marketing-ops`.
- Supabase, Graph MCP e Neo4j não entram na arquitetura-alvo.
- O navegador acessa Marketing Ops somente pela App API/BFF, usando a sessão `HttpOnly` existente. Ele não recebe credenciais do PostgreSQL, do serviço Marketing Ops nem do Hermes.
- PostgreSQL é a autoridade dos metadados e dados de domínio. Bytes permanecem no Artifact Server/object storage.
- `iam.tenants`, `iam.principals` e `iam.memberships` continuam sendo a única autoridade de identidade, tenant e papel global.
- `nexus_owner` cria objetos; `nexus_migrator` executa migrations sob advisory lock e `SET LOCAL ROLE nexus_owner`; `nexus_app` é a única role de aplicação e não tem `BYPASSRLS`.
- Nenhum segredo, `.env`, URL com credencial, dump bruto, sessão ou banco local será versionado.
- Desenvolvimento, migrations, carga, reconciliação e validação de containers passam primeiro no Windows + Docker Desktop.
- Produção permanece em modo copiloto estrito. Os comandos de cada checkpoint serão preparados somente depois da aprovação deste design e da validação local.

## 3. Evidências do estado atual

O levantamento do repositório mostra que:

- M0–M5 estão registrados como concluídos; M6 ainda está pendente e exige extratores, transformações, carga idempotente, reconciliação, ensaio de janela, decisão go/no-go e rollback não improvisado.
- `infra/postgres/migrations` termina em `0005_auth_sessions.sql`; ainda não existe schema novo de Marketing Ops na baseline PostgreSQL.
- O serviço `services/marketing-ops` já contém REST, MCP, regras de domínio, idempotência, auditoria, approvals, workers e testes, mas conserva fronteiras Supabase: `verifySupabaseBearer`, `auth.uid()`, `request.jwt.claim.*`, roles `authenticated`/`service_role` e consultas a `marketing_ops.tenants`/`marketing_ops.memberships`.
- `services/marketing-ops/src/migration-contract.test.ts` ainda referencia migrations Supabase que não existem no novo monorepo e deve ser substituído por contratos contra as migrations canônicas de `infra/postgres`.
- O frontend já possui páginas e rotas protegidas para campanhas, produção e aprovações, além de flags. Porém o cliente atual transforma o ID retornado por `/api/auth/me` em um falso Bearer token e chama `/v1` diretamente; esse contrato não pode ser ativado.
- `apps/chat-web/nginx.conf` já encaminha `/api/*` à App API. Não é necessário publicar o serviço Marketing Ops nem criar um segundo host público.
- `agents/ens/config.yaml` já declara `nexus_marketing_ops` usando `NEXUS_MARKETING_OPS_MCP_URL`; `mcp.json` é apenas artefato distribuível e não é consumido pelo Hermes v0.20.6 atual.
- O ledger contém 801 objetos `marketing_ops`, todos como `transform / M5 / proposed / marketing-ops-postgres`. As 19 tabelas históricas incluem `marketing_ops.tenants`, `marketing_ops.memberships` e `marketing_ops.schema_versions`, que não serão copiadas como autoridades paralelas.
- O inventário registra 20 tabelas de origem em `marketing_ops`, mas o ledger atual lista 19. Essa divergência precisa ser reconciliada antes de congelar a matriz de carga.
- Objetos de `public` e `smart_mail` ainda marcados como `pending / M6` não serão importados implicitamente. Cada um precisa de decisão aprovada; a retirada completa do Supabase continua sendo gate do M7.

## 4. Alternativas consideradas

### A. App API como proxy autenticado para o serviço Marketing Ops — recomendada

A App API valida a sessão `HttpOnly`, resolve usuário/tenant/papel e emite uma asserção interna curta e assinada para cada requisição. O serviço Marketing Ops verifica a asserção, cruza a identidade com `iam.memberships` e executa o domínio sob contexto transacional/RLS.

Vantagens: preserva o serviço e o contrato OpenAPI existentes, mantém uma única fronteira pública, reduz reescrita e separa autenticação de sessão da lógica de domínio. Custo: adiciona um pequeno contrato interno assinado e testes de proxy.

### B. Mover todo o REST de Marketing Ops para a App API

A App API passaria a executar diretamente os casos de uso; o serviço separado manteria apenas MCP e workers.

Vantagem: uma camada HTTP pública. Desvantagens: duplica adaptadores, amplia muito a migração e cria risco de divergência entre REST e MCP. Não recomendada para M6.

### C. Expor Marketing Ops e fazê-lo resolver o cookie diretamente

O navegador chamaria o serviço, que consultaria `iam.user_sessions`.

Foi rejeitada porque cria uma segunda fronteira pública de autenticação, aumenta CORS/cookies/roteamento e contraria a regra de que o navegador fala com a App API/BFF.

## 5. Arquitetura-alvo

```text
Browser
  └─ HTTPS /api/marketing/* + cookie HttpOnly
       └─ chat-web / Nginx
            └─ App API/BFF
                 ├─ valida sessão em iam.user_sessions
                 ├─ resolve iam.principals + iam.memberships
                 └─ assina identidade interna de curta duração
                      └─ Marketing Ops REST (rede app-internal)
                           ├─ nexus_app + contexto SET LOCAL
                           ├─ marketing_ops.* sob RLS
                           └─ Artifact Server (bytes)

Chat Bridge ── contexto autenticado da run ──> Hermes oficial
                                              └─ MCP nexus_marketing_ops
                                                   └─ Marketing Ops /mcp
                                                        └─ delegação curta e assinada
```

O container `marketing-ops` não publica porta no host. Ele participa de:

- `app-internal`, para REST vindo da App API e integração com Artifact Server/Chat Bridge;
- `postgres-data`, para PostgreSQL;
- `hermes-net`, exclusivamente para o Hermes alcançar `/mcp` pelo nome interno do serviço.

Adicionar `hermes-net` é necessário para a integração MCP direta. A alternativa de transformar o Chat Bridge em proxy MCP foi descartada porque acrescentaria transporte e estado sem ganho de segurança; o MCP já exige delegação assinada por operação.

## 6. Contratos de identidade e autorização

### 6.1 REST do navegador

1. O browser envia somente o cookie `ens_session`, headers funcionais (`Idempotency-Key`, `If-Match`, conteúdo) e o payload.
2. A App API resolve a sessão e rejeita sessão ausente, inválida, expirada ou revogada.
3. O tenant vem da sessão/seleção validada pela aplicação. `X-Tenant-Id`, `Authorization` e qualquer header de identidade fornecido pelo browser são removidos antes do encaminhamento.
4. A App API assina uma asserção interna com `sub`, `tenant_id`, `actor_role`, `correlation_id`, método, caminho, `iat`, `nbf`, `exp`, `jti`, emissor, audiência e `kid`.
5. Marketing Ops aceita REST de domínio apenas com essa asserção, valida algoritmo/emissor/audiência/tempo/método/caminho e confirma que a membership IAM continua ativa.
6. A chave da asserção BFF é distinta da chave de delegação MCP, suporta chave ativa/anterior para rotação e entra por secret de runtime.

O prefixo público será `/api/marketing`; a App API remove esse prefixo ao encaminhar para os endpoints existentes `/v1/*`. O Nginx continua com um único proxy `/api/*` para a App API.

### 6.2 Contexto PostgreSQL

O serviço deixa de usar `auth.uid()`, `request.jwt.claim.sub`, `request.jwt.claim.role`, `authenticated` e `service_role`. Cada operação de domínio ocorre numa transação que define localmente:

- `app.user_id`;
- `app.tenant_id`;
- `app.actor_role`;
- `app.correlation_id`;
- `app.actor_type` e `app.origin` quando aplicável.

As funções auxiliares ficam em schema privado, sem `EXECUTE` para `PUBLIC`. RLS usa `current_setting(..., true)` por meio de helpers estáveis. A ausência ou invalidade do contexto resulta em negação, nunca em acesso amplo.

### 6.3 MCP do Hermes

O fluxo existente de delegação curta é preservado, com chaves fora do Git, escopos mínimos, `jti`, vínculo à run/sessão/tenant e confirmação explícita para escrita. Ao verificar a delegação, Marketing Ops também confirma usuário, tenant e papel em `iam.memberships`; claims não se tornam autoridade sozinhos.

As ferramentas de leitura continuam diretas. O MCP prepara um plano imutável,
mas, no navegador, a confirmação e execução ocorrem pelo card estruturado da App
API/BFF. A confirmação não depende de texto livre, de um endpoint privado no
Hermes nem da memória do modelo. Replay é bloqueado pelo registro durável do
plano, por `delegation_uses` e por `idempotency_records`.

## 7. Modelo PostgreSQL canônico

### 7.1 Migrations propostas

As migrations serão novas, cumulativas e não destrutivas:

- `0006_marketing_ops_core.sql`: schema, tipos, tabelas, FKs e constraints estruturais;
- `0007_marketing_ops_security.sql`: grants, helpers privados, RLS/`FORCE RLS` e políticas;
- `0008_marketing_ops_integrity.sql`: máquinas de estado, imutabilidade, prevenção de ciclos, versão otimista e funções atômicas justificadas;
- `0009_marketing_ops_indexes.sql`: índices de FKs, filas, calendário, paginação e outbox baseados nas consultas reais.

Nenhuma migration manterá um ledger paralelo como `marketing_ops.schema_versions`; `infra.schema_migrations` continua canônico.

### 7.2 Tabelas alvo

| Grupo | Tabelas canônicas | Invariantes principais |
| --- | --- | --- |
| Campanhas | `campaigns`, `campaign_members`, `campaign_materials` | tenant obrigatório; criador/participante referencia `iam.principals`; um owner primário; versão otimista; archive explícito |
| Produção | `campaign_items`, `item_dependencies` | item e dependência na mesma campanha/tenant; sem auto-dependência ou ciclos; datas coerentes; transições válidas |
| Conteúdo | `content_assets`, `content_versions`, `item_artifacts` | versão de conteúdo append-only; ponteiros coerentes; somente metadados de artefato no banco |
| Governança | `approval_requests`, `approval_decisions`, `action_packages` | alvo compatível com tipo; decisão append-only; transições fechadas; payload/hash autorizados imutáveis |
| Operação | `audit_events`, `domain_events`, `idempotency_records`, `delegation_uses`, `in_app_notifications` | auditoria imutável; outbox reprocessável; unicidade por tenant/ator/operação/chave; replay negado |

`marketing_ops.tenants` e `marketing_ops.memberships` não serão recriadas. Todas as FKs de tenant apontam para `iam.tenants`; atores apontam para `iam.principals`; autorização global consulta `iam.memberships`. `campaign_members` permanece porque representa participação específica numa campanha, não identidade global.

### 7.3 Ownership, grants e RLS

- Todos os objetos pertencem a `nexus_owner`.
- `PUBLIC` não recebe uso do schema nem privilégios em tabelas, sequências ou funções.
- `nexus_app` recebe apenas `USAGE` e operações necessárias por tabela/função.
- Todas as tabelas tenant-scoped têm `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`.
- Políticas exigem `tenant_id = app_private.request_tenant_id()` e, quando necessário, papel/participação no recurso.
- Auditoria, versões de conteúdo e decisões são append-only; update/delete são negados por privilégio e por trigger/constraint.
- Funções `SECURITY DEFINER` serão exceções documentadas, com `search_path` fixo, parâmetros validados, owner sem login, grants seletivos e testes positivos/negativos.
- Índices cobrem toda FK e as ordens reais de cursor: filas de approval, calendário por intervalo, campanhas atualizadas, notificações e outbox pendente.

### 7.4 Eventos e consistência

Mutação de domínio, auditoria, evento de outbox e registro de idempotência são gravados na mesma transação. `domain_events` adota entrega pelo menos uma vez: consumidores precisam ser idempotentes, e publicação usa tentativas, `available_at`, `published_at` e erro sanitizado. Falha de integração externa não deixa alteração de domínio parcialmente confirmada.

## 8. Serviço `services/marketing-ops`

### 8.1 Autenticação e configuração

- Remover `supabaseUrl`, `supabaseAnonKey` e `verifySupabaseBearer` do caminho ativo.
- Introduzir verificação da asserção interna BFF para `/v1/*`.
- Manter o verificador de delegação independente para `/mcp`.
- Trocar consultas de `marketing_ops.tenants/memberships` por `iam.tenants/iam.memberships`.
- Trocar o contexto SQL legado por `app.*`, sem `SET LOCAL ROLE authenticated/service_role`.
- Ler senha PostgreSQL e chaves por arquivos de secret; valores de produção ausentes ou placeholders falham no startup.
- Tornar RAG opcional/fail-soft para as telas que não dependem dele. A ausência do RAG não pode derrubar campanhas, calendário ou approvals; apenas a busca de referência retorna indisponibilidade explícita.

### 8.2 REST e proxy BFF

O contrato OpenAPI existente permanece a fonte do REST. A App API ganha um módulo isolado de proxy que:

- autentica antes de abrir conexão upstream;
- encaminha método, path, query e corpo em streaming, inclusive uploads;
- limita tamanho e timeout por tipo de rota;
- preserva `Content-Type`, `ETag`, `X-Correlation-Id`, status e envelope de erro;
- não segue redirects upstream;
- remove hop-by-hop e headers de identidade do cliente;
- mapeia timeout/indisponibilidade para erro BFF estável sem expor topologia interna.

### 8.3 Health, readiness e workers

- `/health` comprova apenas processo vivo.
- `/ready` exige PostgreSQL e Artifact Server quando a rota necessita artefatos; RAG aparece como dependência degradada, não como indisponibilidade global.
- `/metrics` continua interno e autenticado.
- O worker de expiração de approvals só inicia com `write && approvals`; usa operação SQL atômica e lote limitado.
- O outbox terá métrica de profundidade, tentativas e idade do evento mais antigo.

## 9. Docker Compose e topologia

`infra/app/compose.yaml` receberá `marketing-ops` com build local, usuário não-root já definido no Dockerfile, restart, healthcheck, `depends_on` apenas quando útil para ordem de readiness e sem `ports` na configuração base/produção.

O serviço usará a senha de `nexus_app`, secret da asserção BFF, chaves de delegação, chave do Artifact Server e URLs internas. Defaults que se pareçam com segredo serão permitidos somente em override local explícito; produção falha fechada.

A App API receberá a URL interna Marketing Ops e a chave de assinatura BFF. O Chat Bridge continuará emitindo delegações para o Hermes. O override de desenvolvimento poderá publicar a porta 8091 apenas em loopback para diagnóstico local; o override de produção não publicará host/Traefik para Marketing Ops.

## 10. Frontend `apps/chat-web`

### 10.1 Cliente e rotas

- O cliente passa a usar base same-origin `/api/marketing` e `credentials: same-origin`.
- O falso Bearer baseado no ID do usuário é removido.
- Nenhuma URL pública separada de Marketing Ops é necessária.
- As rotas existentes de campanhas, workspace, produção lista/semana/mês/item e approvals permanecem lazy-loaded e protegidas.
- Sidebar e TopBar navegam somente quando a flag de leitura está ativa; o botão `Marketing ENS` da TopBar passa a ter destino explícito em campanhas.
- Componentes de mutação consultam a flag de escrita; approvals exigem simultaneamente `enabled`, `read` e `approvals`.

### 10.2 Feature flags

As flags públicas continuam kill-switches de interface e não substituem autorização server-side:

- `VITE_MARKETING_OPS_ENABLED`;
- `VITE_MARKETING_OPS_READ`;
- `VITE_MARKETING_OPS_WRITE`;
- `VITE_MARKETING_OPS_APPROVALS`;
- `VITE_MARKETING_OPS_KILL_SWITCH`.

Como Vite embute valores no build, o Dockerfile deve declarar os build args correspondentes. Localmente, todas serão testadas como `true`. No cutover, o build candidato nasce com `enabled/read=true` e `write/approvals=false`; escrita e approvals só são liberadas após carga, reconciliação e smoke autenticado. O estado final aprovado terá as quatro flags solicitadas como `true` e kill switch `false`.

## 11. Integração Hermes MCP

- `agents/ens/config.yaml` permanece a configuração consumida pelo Hermes v0.20.6 e aponta `NEXUS_MARKETING_OPS_MCP_URL` para o DNS interno do container.
- A distribuição continua sem credenciais; somente placeholders de ambiente são versionados.
- A skill `agents/ens/skills/marketing-ops-operator` será revisada contra os nomes reais das tools e o fluxo preparar/confirmar/executar.
- O gate MCP valida `initialize`, capabilities, leitura de campanha/calendário, negação sem delegação, negação cross-tenant, expiração/replay e uma escrita confirmada idempotente.
- Falha do MCP não expõe REST nem PostgreSQL e não derruba o chat geral; a capacidade aparece indisponível de forma explícita.

## 12. Migração de dados

### 12.1 Escopo e decisão do ledger

Antes de extrair, será produzida uma revisão humana versionada do grupo Marketing Ops no ledger:

- aprovar transformação dos objetos ainda necessários;
- marcar `marketing_ops.tenants` e `marketing_ops.memberships` como consolidação em IAM;
- marcar `marketing_ops.schema_versions` como remoção/substituição por `infra.schema_migrations`;
- resolver a divergência 20 versus 19 tabelas;
- registrar coluna, transformação, responsável, teste e destino de cada objeto aceito.

Dados `public.*` e `smart_mail.*` ainda pendentes recebem decisão própria. Eles não entram na carga por semelhança de nome. `validated_works` permanece fora, coerente com sua remoção em M5.

### 12.2 Artefatos versionáveis e não versionáveis

Serão versionados:

- código dos extratores e loaders;
- schemas de manifesto e mapeamento;
- fixtures sintéticas pequenas;
- regras de validação e relatórios sem PII;
- checksums esperados apenas para fixtures.

Não serão versionados:

- dumps reais;
- arquivos exportados;
- URLs de conexão;
- dados pessoais, tokens ou secrets;
- relatórios de produção com valores identificáveis.

Arquivos reais ficam em diretório local ignorado ou storage operacional aprovado, criptografados e com retenção definida.

### 12.3 Pipeline idempotente

O pipeline terá quatro comandos lógicos separados, implementados em `scripts/migration/marketing-ops/`:

1. **extract** — leitura consistente do legado, preferencialmente por snapshot, gerando JSONL/CSV determinístico por tabela, manifesto, contagens e SHA-256;
2. **transform** — valida tipos, normaliza enums/timezones, remapeia tenant/usuário para IAM, separa metadados de bytes e produz quarentena para linhas inválidas;
3. **load** — staging isolado, valida FKs e executa upserts determinísticos sob transação/lotes; IDs legados aceitos são preservados;
4. **reconcile** — compara origem, staging e destino por tenant/tabela, contagens, chaves, checksums canônicos e invariantes de negócio.

Reexecução do mesmo lote produz o mesmo estado. Cada execução possui `migration_run_id`, fingerprint do manifesto e status. Uma mesma fingerprint concluída não duplica dados; fingerprint divergente exige nova execução explícita.

### 12.4 Ordem de carga

1. Mapear tenants, principals e memberships legadas para IAM sem criar duplicatas.
2. Carregar campanhas.
3. Carregar participantes e materiais.
4. Carregar itens de produção e dependências.
5. Carregar assets, versões e vínculos de artefato.
6. Carregar action packages, approval requests e decisões.
7. Carregar auditoria, eventos, idempotência, usos de delegação ainda válidos e notificações.
8. Validar/reconstruir índices derivados e estatísticas após a carga.

Eventos técnicos expirados, tokens/delegações vencidos e registros puramente Supabase não são carregados sem regra aprovada. Material sem blob correspondente fica em quarentena; nunca recebe link fictício.

### 12.5 Reconciliação obrigatória

O relatório go/no-go contém, por tenant e tabela:

- contagem de origem, aceitos, rejeitados, destino e diferença;
- conjunto de PKs ausentes/excedentes;
- checksum canônico por faixa de PK;
- FKs órfãs e violações de unicidade;
- campanhas sem owner primário;
- dependências cíclicas;
- versão atual de conteúdo divergente;
- approval terminal sem decisão correspondente;
- action package autorizado sem approval válido;
- metadado de artefato sem objeto CAS verificável;
- idempotency keys duplicadas;
- eventos não publicáveis e idade do outbox.

Qualquer diferença não explicada bloqueia cutover. Quarentena precisa de decisão explícita: corrigir e repetir, excluir por regra aprovada ou abortar.

## 13. Estratégia de cutover e rollback

### 13.1 Abordagem recomendada

Usar **freeze curto + delta final**, não dual-write. O legado continua como fonte até a janela; o ensaio mede a exportação completa. Na janela, escrita de Marketing Ops no legado é suspensa, aplica-se o delta desde o watermark, reconcilia-se, libera-se leitura no novo sistema e depois escrita/approvals.

Dual-write foi descartado porque exigiria resolver conflitos entre modelos diferentes e criaria um novo componente temporário de alta criticidade.

### 13.2 Gates

- **Gate D0 — design:** este documento aprovado.
- **Gate D1 — schema:** migrations e contratos PostgreSQL passam em banco vazio e upgrade de baseline.
- **Gate D2 — serviço:** REST/BFF/MCP passam com RLS e negações.
- **Gate D3 — migração ensaiada:** carga integral local idempotente e duração medida.
- **Gate D4 — reconciliação:** diferenças zero ou exceções formalmente aprovadas.
- **Gate D5 — candidato:** stack Docker Desktop saudável, smoke e E2E locais aprovados.
- **Gate P1 — migrations:** operador executa e devolve evidência sanitizada; falha interrompe antes de atualizar containers.
- **Gate P2 — containers:** serviço sobe interno com flags de escrita desligadas.
- **Gate P3 — dados/smoke:** carga final e smoke autenticado aprovados.
- **Gate P4 — homologação:** campanhas, calendário, approvals e comandos via Hermes aprovados; somente então escrita e approvals ficam ativas.

### 13.3 Rollback conceitual

Antes da liberação de escrita, rollback é retirar o novo tráfego/flags e manter o legado como autoridade. Depois da liberação de escrita, rollback exige interromper novas escritas, exportar o delta produzido no PostgreSQL novo e aplicar o procedimento de retorno ensaiado; não se alterna autoridade enquanto houver divergência.

O plano operacional de cada checkpoint trará comando exato, impacto, saída esperada, condição de parada e rollback imediato. Esses comandos não fazem parte desta fase de design.

## 14. Estratégia de testes locais

### 14.1 PostgreSQL

- contrato estático das migrations novas e ausência de referências Supabase;
- migration em banco vazio e upgrade `0001`–`0009`;
- checksum/advisory lock/idempotência do runner;
- ownership e grants mínimos;
- RLS: anônimo/sem contexto, mesmo tenant, cross-tenant, papel insuficiente e owner sem bypass acidental;
- concorrência: versão otimista, owner primário, dependências, idempotência e decisões;
- imutabilidade: auditoria, versões e decisões;
- planos `EXPLAIN` das filas/listagens críticas com massa sintética.

### 14.2 Backend

- App API rejeita anônimo e headers de identidade injetados;
- asserção BFF inválida, expirada, path/método divergente, chave desconhecida e membership revogada;
- proxy preserva corpo, upload, query, status, ETag e correlation ID;
- REST cobre leitura/escrita/approvals e feature flags;
- MCP cobre capabilities, delegação, escopos, confirmação, replay e idempotência;
- readiness degrada corretamente quando RAG falha;
- workers são atômicos e bounded.

### 14.3 Frontend e E2E

- matriz completa das cinco flags;
- rotas e navegação desktop/mobile;
- sessão via cookie, sem Authorization fabricado;
- campanhas, workspace, calendário lista/semana/mês, conteúdo e approvals;
- conflitos `If-Match`, erros e kill switch;
- Network sem `supabase.co` e sem chamada direta a Marketing Ops/Hermes/PostgreSQL.

### 14.4 Stack Docker Desktop

O gate local exige todos os containers saudáveis, migration runner concluído, App API alcançando Marketing Ops, Hermes alcançando MCP, PostgreSQL sem porta pública no compose de produção e um smoke automatizado cobrindo health/readiness, REST autenticado e MCP.

## 15. Fatias verticais de implementação

Após aprovação, o plano de implementação detalhará passos TDD e commits pequenos nesta ordem:

1. Contratos e migrations canônicas do schema.
2. IAM/RLS e substituição dos contratos de migration legados.
3. Autenticação interna App API → Marketing Ops.
4. Proxy BFF e cliente frontend same-origin.
5. Compose, health/readiness e smoke local.
6. MCP do Hermes e gates de delegação.
7. Extrator, transformador, staging/loader e reconciliação.
8. Ensaio local completo e relatório go/no-go.
9. Runbook de produção em quatro checkpoints, sem execução pelo agente.
10. Homologação e atualização de `MIGRATION_STATUS.md` e `docs/migration/roadmap.md` somente com evidência real.

Cada fatia começa com teste que falha, implementa o mínimo para passar, executa testes focados e depois a suíte afetada. Nenhum marco será declarado concluído por código copiado ou por expectativa.

## 16. Critérios de aceite do M6

1. `marketing_ops` nasce das migrations canônicas em PostgreSQL vazio e em upgrade da baseline atual.
2. Não existem `marketing_ops.tenants`, `marketing_ops.memberships` ou `marketing_ops.schema_versions` como autoridades paralelas.
3. Não há `auth.uid()`, role/claim Supabase, SDK, URL ou chave Supabase no caminho ativo de Marketing Ops.
4. Navegador usa somente `/api/marketing/*` com sessão `HttpOnly`; chamadas diretas e headers forjados são negados.
5. RLS e RBAC negam cross-tenant e papel insuficiente em REST, MCP e worker.
6. REST, frontend e MCP preservam idempotência, concorrência otimista, trilha de auditoria e confirmação de writes do agente.
7. Metadados de arquivo apontam apenas para objetos válidos do Artifact Server.
8. Exportação, transformação, carga e reconciliação são reexecutáveis e não expõem PII/secrets no Git ou logs.
9. Contagens, checksums, PKs/FKs e invariantes reconciliam por tenant; exceções são explicitamente aprovadas.
10. O ensaio local mede duração da janela e comprova rollback.
11. Docker Desktop, testes automatizados, smoke REST/MCP e E2E local passam antes de qualquer proposta de produção.
12. Os quatro checkpoints de produção são executados somente pelo operador, um de cada vez, com logs sanitizados e autorização para prosseguir.
13. As quatro flags finais ficam ativas apenas após o gate P4; o kill switch permanece disponível.
14. Documentação oficial só registra M6 como concluído após evidência local e de produção.

## 17. Decisões solicitadas ao operador

A aprovação deste design confirma conjuntamente:

1. App API/BFF com asserção interna assinada como única entrada REST;
2. IAM como autoridade única, sem tabelas duplicadas de tenant/membership em Marketing Ops;
3. `marketing-ops` ligado também à `hermes-net`, sem porta/host público;
4. cutover por freeze curto + delta final, sem dual-write;
5. ativação progressiva `read → write → approvals`, apesar do estado final exigir todas as flags `true`.

Até essa aprovação, nenhuma implementação nem instrução de produção deve começar.
