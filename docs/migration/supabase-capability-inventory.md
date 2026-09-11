# Inventário de capacidades Supabase e destinos locais

**Estado:** Em execução
**Atualizado em:** 2026-09-11
**Marcos:** M3, M4, M5 e M6  
**Fonte histórica:** `projeto-ens-unificado/apps/chat-web/supabase`

## Decisão de produto

Toda capacidade do Supabase usada pelo ENS deve terminar em um componente
operado pelo próprio ENS no ambiente local ou na VPS. O produto não dependerá
do Supabase gerenciado nem de uma instalação self-hosted da plataforma
Supabase.

Isso não significa reconstruir o Supabase inteiro. Cada uso comprovado recebe
um destino explícito, um teste de paridade e um plano de retirada. A linguagem
de implementação pode ser Node.js, Python, PHP ou SQL conforme a fronteira e a
manutenibilidade; a escolha não altera estas regras:

- o navegador conversa somente com a App API/BFF;
- PostgreSQL é a autoridade dos dados estruturados;
- autenticação e autorização pertencem à aplicação e são reforçadas pelo banco;
- arquivos pertencem ao Artifact Server/object storage próprio;
- jobs e eventos possuem estado persistente, idempotência e observabilidade;
- segredos ficam fora do Git e não são transformados em dados comuns do banco.

## Escopo examinado

Este inventário foi produzido a partir de:

- 24 migrations ativas do diretório histórico `supabase/migrations`;
- migrations arquivadas em `legacy_migrations` e `ignored_migrations`, usadas
  somente para investigação e não como baseline nova;
- quatro Edge Functions históricas;
- chamadas atuais do SDK Supabase em `apps/chat-web`;
- contratos e SQL copiados de `services/marketing-ops`.

O inventário de capacidades e tabelas abaixo é suficiente para orientar as
fatias. O gate de M3 continua aberto até existir uma reconciliação automatizada
de todos os objetos DDL — tabelas, colunas, constraints, índices, policies,
funções, triggers, buckets e jobs — com decisão `migrar`, `transformar` ou
`remover` e responsável definido.

## Ledger automatizado e revisão em 2026-09-11

O [ledger sanitizado](supabase-ledger/supabase-object-ledger.md) reconcilia as fontes
allowlisted sem executar SQL e sem versionar corpos SQL, dados ou caminhos
absolutos. Os artefatos verificáveis são o
[manifesto de fontes](supabase-ledger/source-manifest.json), o
[overlay de decisões](supabase-ledger/object-decisions.json) e as
[revisões humanas aprovadas](supabase-ledger/reviews/iam-chat.json).

| Medida | Resultado |
| --- | ---: |
| Fontes classificadas | 87 |
| Migrations SQL ativas | 24 |
| Edge Functions | 4 |
| Fontes apenas históricas | 50 |
| Fontes de componentes retirados | 9 |
| Operações sanitizadas | 2.904 |
| Objetos lógicos | 2.672 |
| Operações não classificadas | 0 |
| Decisões aprovadas (overlay humano) | 166 |
| Decisões propostas restantes | 2.506 |
| Propostas `pending` | 1.070 |

Em 2026-09-11, foi aplicado o primeiro lote de revisão humana seletiva
(`iam-chat.json`), aprovando 166 objetos: 22 grants Supabase obsoletos foram
marcados para remoção (`remove`), o proxy do chatbot foi aprovado para
transformação no Chat Bridge e estruturas canônicas de IAM e Chat Store
receberam destinos nomeados. Conforme a regra de menor privilégio, policies sem
substituto aprovado, triggers entre domínios e campos de credencial/segredos
permaneceram deliberadamente como `proposed`. As 1.070 linhas `pending` continuam
exigindo resolução de domínio/ADR antes do cutover final.

## Matriz de capacidades

| Capacidade usada | Evidência atual | Destino sob operação ENS | Marco | Gate para retirar Supabase |
| --- | --- | --- | --- | --- |
| Banco relacional | tabelas e migrations históricas | PostgreSQL oficial em `infra/postgres` | M3/M6 | schema de domínio, carga idempotente e reconciliação aprovados |
| RLS | policies e `auth.uid()` | RLS nativo com contexto transacional instalado pela App API | M3/M4 | matriz positiva/negativa por domínio e teste cross-tenant |
| Auth | login, logout, sessão, refresh, recuperação e administração de usuários | serviço de identidade ENS self-hosted e sessões da App API | M4 | ADR, migração de identidades, revogação, recuperação e auditoria testadas |
| Data API | chamadas `supabase.from()` e `rpc()` no navegador | endpoints tipados da App API/BFF | M4/M5 | zero SDK ou endpoint Supabase no build do frontend |
| Edge Functions | administração de usuários e `proxy-chatbot` | rotas/jobs da App API; chat pelo Chat Bridge | M4/M5 | paridade de autorização, erros, auditoria e observabilidade |
| Storage | avatares, anexos e saídas geradas | Artifact Server e object storage/volume próprio | M5/M6 | upload, download, remoção, autorização, backup e reconciliação testados |
| URLs públicas/assinadas | `getPublicUrl` e `createSignedUrl` | URLs mediadas e temporárias emitidas pelo Artifact Server | M5 | expiração, escopo, path traversal e revogação testados |
| Realtime | nenhum `.channel()` ativo encontrado no frontend copiado | não instalar substituto genérico; SSE/WebSocket somente por fluxo | M5 | confirmar inventário e testar os fluxos assíncronos selecionados |
| Cron, filas e workers | expiração de approvals, jobs de imagem e projeções | worker próprio, tabelas de jobs/outbox e scheduler em container | M5 | retries, idempotência, lease, dead letter e recuperação testados |
| Extensões | `pg_stat_statements`, `pg_trgm`, `pgcrypto`, `uuid-ossp`, `vector`, `supabase_vault` | habilitar apenas extensões PostgreSQL necessárias; substituir Vault por secrets de runtime | M3/M5 | ADR por extensão, imagem compatível e restauração comprovada |
| Studio/admin | conveniência operacional | ferramenta local opcional, nunca requisito do runtime público | M7 | operação possível por runbook sem Studio |
| Logs e métricas | painéis/telemetria gerenciada | logs Docker estruturados e stack própria de métricas/alertas a definir | M5/M7 | SLOs, alertas e retenção aprovados sem PII/segredos |

## Registro das Edge Functions

| Função histórica | Destino | Estado |
| --- | --- | --- |
| `admin-create-user` | comando administrativo autenticado e auditado na App API/serviço de identidade | M4 pendente |
| `admin-reset-password` | fluxo administrativo do serviço de identidade, com revogação de sessões | M4 pendente |
| `admin-delete-user` | desativação/remoção controlada na App API, preservando integridade e auditoria | M4 pendente |
| `proxy-chatbot` | Chat Bridge e rotas públicas da App API, sem acesso direto do navegador ao Hermes | substituição iniciada em M2; fronteira pública M4 pendente |

Funções novas de negócio devem preferir código da aplicação ou worker. Funções
SQL ficam reservadas para constraints, integridade, RLS e operações que precisam
ser atômicas junto aos dados.

## Registro das tabelas históricas

Os nomes abaixo são objetos de origem, não autorização para copiá-los
literalmente. IDs aceitos devem ser preservados durante a carga; estrutura,
constraints e ownership serão redesenhados por fatia.

| Grupo de origem | Tabelas encontradas | Destino |
| --- | --- | --- |
| Identidade e integrações | `profiles`, `user_chat_integrations` | schemas `iam` e de configurações da aplicação; credenciais viram referências a secrets, não texto comum |
| Chat e memória operacional | `chat_sessions`, `chat_messages`, `chat_session_hermes_state`, `chat_session_summaries`, `chat_confidence_logs` | schema de chat/RunStore acessado pela App API e Chat Bridge |
| Marketing e campanhas legadas | `ad_sets`, `ads`, `agent_playbooks`, `daily_metrics`, `market_competitor_ads`, `market_competitors`, `market_intelligence_feed`, `market_trends`, `ingestion_logs` | schemas de Marketing Ops e workers próprios; consolidar duplicatas antes da carga |
| Conteúdo e trabalhos | `validated_works` | domínio de conteúdo com referências ao Artifact Server |
| Imagens — legado público | `generated_images`, `picture_workspaces`, `picture_jobs` | serviço Picture, jobs persistentes e Artifact Server |
| Imagens — schema `image_gen` | `jobs`, `job_items`, `job_metrics`, `outputs` | modelo canônico de jobs Picture; não manter duas autoridades |
| Smart Mail | `campaign_requests`, `knowledge_sources` | domínio/worker de comunicação próprio; integração de entrega será decisão operacional separada |
| RAG | `rag_ens`, `rag_marketing`, `rag_email_html` | decisão de domínio pendente; migrar para PostgreSQL/extensão própria somente se o fluxo continuar aprovado |
| Grafo legado | `graph_entities`, `graph_relations` | não migrar como Graph MCP/Neo4j; transformar apenas relações de negócio ainda necessárias em modelo relacional aprovado |
| Marketing Ops — núcleo | `tenants`, `memberships`, `campaigns`, `campaign_members`, `campaign_items`, `campaign_materials`, `item_dependencies` | schema `marketing_ops`; `tenants` e `memberships` devem referenciar a autoridade canônica de `iam` |
| Marketing Ops — conteúdo | `content_assets`, `content_versions`, `item_artifacts` | metadados no PostgreSQL e bytes no Artifact Server |
| Marketing Ops — governança | `approval_requests`, `approval_decisions`, `action_packages`, `delegation_uses` | schema `marketing_ops` com transições e trilha imutável testadas |
| Marketing Ops — eventos e operação | `audit_events`, `domain_events`, `idempotency_records`, `in_app_notifications`, `schema_versions` | audit/outbox/idempotência próprios; substituir `schema_versions` pelo ledger canônico quando aplicável |

Total inicial: **51 tabelas** — 25 em `public`, 4 em `image_gen`, 2 em
`smart_mail` e 20 em `marketing_ops`.

## Registro de RPCs, funções SQL e triggers

### Identidade e administração

- `admin_update_profile`, `admin_upsert_user_chat_integration`;
- `create_user_by_admin`, `delete_user_by_admin`, `handle_new_user`;
- `current_app_profile_role`, `is_admin`.

**Destino:** App API/serviço de identidade para comandos e autorização; SQL
somente para constraints e alterações atômicas. Os RPCs não serão expostos ao
navegador.

### Busca e RAG

- `match_rag_ens`, `match_rag_marketing`, `match_rag_email_html`;
- `kw_match_rag_ens`, `kw_match_rag_marketing`;
- `delete_rag_chunks_by_file_id`.

**Destino:** contrato de busca próprio somente após decisão do fluxo RAG. Nenhuma
função será portada automaticamente nem continuará apontando para Supabase.

### Atualização, contagem e integridade

- `update_updated_at_column`, `touch_picture_updated_at`;
- `touch_chat_session_hermes_state_updated_at`;
- `touch_validated_works_updated_at`;
- `update_chat_session_message_count`;
- `smart_mail.set_updated_at`.

**Destino:** constraints/triggers PostgreSQL ou código transacional, decidido por
objeto e coberto por teste de concorrência.

### Marketing Ops

As funções privadas históricas cobrem contexto de tenant/ator, acesso e edição
de campanhas, participantes, timeline, calendário de produção, dependências,
versionamento de conteúdo, approvals, notificações, idempotência e proteção de
imutabilidade.

**Destino:** regras de autorização e transição na App API/serviço Marketing Ops,
com RLS e constraints PostgreSQL como segunda barreira. `auth.uid()` e claims do
Supabase devem desaparecer. Funções `SECURITY DEFINER` só podem permanecer com
justificativa, `search_path` seguro, grants seletivos e teste específico.

## Buckets e artefatos

| Origem | Uso observado | Destino |
| --- | --- | --- |
| `avatars` | upload, remoção e URL pública | coleção privada do Artifact Server; entrega autenticada ou URL temporária |
| anexos de chat | upload, remoção e URL assinada | Artifact Server + Chat Bridge, com limite de tamanho/tipo e isolamento por tenant |
| saídas de geração de imagem | arquivos gerados e referências em tabelas | Artifact Server + serviço Picture, com reconciliação de metadados |

O nome exato do bucket histórico de anexos e saídas será confirmado pelo ledger
automatizado antes de M6. Nenhum bucket público é recriado por conveniência.

## Extensões e componentes que não serão carregados automaticamente

- `supabase_vault`: remover; usar secrets Docker/arquivos de runtime e rotação
  operacional;
- `uuid-ossp`: preferir UUID nativo/moderno quando a versão suportar o caso;
- `pgcrypto`: habilitar apenas para uma necessidade documentada, nunca para
  guardar senha reversível;
- `pg_trgm`: manter somente com consulta e índice de paridade medidos;
- `vector`: depende do ADR de RAG e de imagem PostgreSQL restaurável;
- `pg_stat_statements`: candidato aprovado para observabilidade, após definir
  configuração e política de dados;
- schemas `auth`, `storage`, `realtime`, roles e grants internos do Supabase: não
  pertencem à baseline nova.

## Gates ainda abertos

- [x] gerar ledger automatizado, sanitizado e determinístico com uma proposta
  explícita para cada um dos 2.672 objetos;
- [ ] revisar as 2.672 propostas, resolver as 1.070 ações `pending` e aprovar
  destino/responsável sem reintroduzir componentes retirados;
- [ ] aprovar ADR de autenticação/sessão self-hosted e implementar M4;
- [ ] migrar cada domínio em migration nova e testes de RLS/integridade;
- [ ] aprovar object storage, retenção e URLs temporárias;
- [ ] implementar jobs/outbox e confirmar se algum realtime adicional é
  necessário;
- [ ] decidir o destino dos fluxos RAG e eliminar Graph MCP/Neo4j;
- [ ] exercitar backup/restore do PostgreSQL e dos artefatos como um conjunto;
- [ ] definir RPO/RTO, TLS/`pg_hba.conf`, observabilidade e alertas;
- [ ] executar extração/carga idempotente, reconciliação e ensaio de cutover;
- [ ] provar zero uso de SDK, endpoint, chave ou infraestrutura Supabase no
  build e runtime finais;
- [ ] revogar credenciais e retirar o Supabase somente após a janela de retorno.

## Critério de conclusão deste inventário

Este documento deixa de estar **Em execução** apenas quando o ledger
automatizado cobrir todos os objetos ativos e cada linha tiver destino,
transformação ou remoção aprovada, teste responsável e marco de entrega. Até lá,
ele é uma fronteira de escopo e um mapa confiável, mas não é prova de paridade
nem autorização de cutover.
