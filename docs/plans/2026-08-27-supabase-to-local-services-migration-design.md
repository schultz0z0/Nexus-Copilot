# Migração do Supabase para serviços locais ENS

Status: desenho arquitetural registrado, ainda não implementado.

Data: 2026-08-27.

## Objetivo

Remover a dependência operacional do Supabase gerenciado e executar todos os componentes necessários no ambiente local e na VPS, preservando as garantias importantes que hoje são fornecidas pela plataforma: banco relacional, autenticação, autorização por linha, armazenamento, funções, processamento assíncrono e atualizações em tempo real.

A meta não é reimplementar o Supabase inteiro. A meta é substituir somente os recursos efetivamente usados pelo ENS por componentes menores, explícitos e versionados neste monorepo.

## Princípios

- PostgreSQL é a autoridade dos dados estruturados do produto.
- O navegador conversa apenas com a App API/BFF; nunca acessa PostgreSQL, Hermes ou credenciais de infraestrutura diretamente.
- Identidade e autorização são validadas pela aplicação e reforçadas pelo RLS do banco.
- Arquivos pertencem ao Artifact Server ou a um object storage interno; o PostgreSQL guarda somente seus metadados e relações.
- Fluxos externos, IA e regras de orquestração ficam em código de aplicação, não em stored procedures extensas.
- Desenvolvimento local e produção usam a mesma topologia de serviços. Apenas dados, secrets, volumes, domínios e capacidade são diferentes.
- Nenhum serviço gerenciado externo é necessário para o funcionamento normal do produto.
- Migrations, configuração declarativa e contratos de API são versionados no Git; dados e credenciais não são.

## Arquitetura alvo

```text
Browser
   |
   v
App API / BFF ---------> Identity/Auth
   |                         |
   |                         v
   +--------------------> PostgreSQL
   |                         |
   +--------------------> RLS / pgvector / outbox
   |
   +--------------------> Artifact Server -> volume local ou object storage
   |
   +--------------------> Chat Bridge -> Hermes oficial + Profile ENS
   |
   +--------------------> Workers locais
```

O PostgreSQL não será exposto ao navegador. Todas as requisições entram pela App API/BFF, que resolve a sessão, a identidade, o tenant e as permissões antes de abrir uma transação no banco.

## Mapa de substituição

| Recurso atual | Substituição local proposta |
| --- | --- |
| Supabase Database | PostgreSQL vanilla |
| Supabase RLS | RLS nativo do PostgreSQL |
| Supabase Auth | Serviço de identidade ENS ou Keycloak |
| `supabase.from()` | Endpoints da App API/BFF |
| `supabase.rpc()` | Endpoint de aplicação ou função SQL restrita |
| Edge Functions | Rotas Node e workers versionados no monorepo |
| Supabase Storage | Artifact Server com volume local ou API S3 interna |
| Supabase Realtime | SSE/WebSocket e padrão transactional outbox |
| Supabase Cron/Queues | Worker persistente e tabelas de jobs/outbox |
| Vector/RAG | PostgreSQL com `pgvector` |
| Supabase Studio | Ferramenta administrativa local opcional, como pgAdmin ou CloudBeaver |

## PostgreSQL e RLS

O Row-Level Security é nativo do PostgreSQL. As policies do ENS continuarão restringindo leitura e escrita por usuário, tenant, papel e relacionamento de domínio.

O backend deverá usar um papel de aplicação sem `SUPERUSER`, sem `BYPASSRLS` e que não seja proprietário das tabelas protegidas. Tabelas sensíveis devem usar `ENABLE ROW LEVEL SECURITY` e, quando apropriado, `FORCE ROW LEVEL SECURITY`.

Para cada operação autenticada:

1. a App API valida a sessão;
2. inicia uma transação;
3. define `user_id`, `tenant_id`, `session_id` e papel em contexto transacional;
4. executa as queries usando o papel restrito da aplicação;
5. confirma ou reverte a transação.

O contexto deve ser definido com escopo local à transação, por exemplo através de `set_config(..., true)`. Não se deve usar um `SET` persistente em conexões compartilhadas, pois pools podem reutilizar a mesma conexão entre usuários.

As policies devem:

- possuir predicados de propriedade ou participação, não apenas verificar se existe um usuário autenticado;
- usar `USING` e `WITH CHECK` nas operações de update;
- ser testadas para acesso permitido, acesso cruzado entre tenants e negação anônima;
- tratar views com `security_invoker` quando forem expostas ao papel da aplicação;
- evitar `SECURITY DEFINER`; quando inevitável, restringir schema, `search_path`, `EXECUTE` e identidade permitida.

RLS é defesa em profundidade. A API continua responsável por validar permissões de negócio, limites, estados e transições.

Referência: [Row Security Policies do PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

## Autenticação e sessões

PostgreSQL pode armazenar usuários e sessões, mas não substitui sozinho um sistema completo de login. O ENS precisa de uma camada responsável por hashing de senhas, cookies, expiração, rotação, revogação, recuperação de conta e proteção contra abuso.

A opção preferida para o primeiro desenho é um serviço de identidade Node dentro do monorepo, usando uma biblioteca de autenticação consolidada e PostgreSQL. Isso reduz o número de containers e permite conservar o contrato de identidade próximo ao produto.

Keycloak permanece como alternativa se o escopo exigir SSO, provedores sociais, MFA, passkeys, federação ou administração avançada. Ele pode executar em container e usar PostgreSQL, mas acrescenta peso operacional.

Requisitos de segurança:

- cookies de sessão `HttpOnly`, `Secure` e com `SameSite` adequado;
- tokens de sessão opacos e revogáveis para o frontend, salvo necessidade comprovada de JWT;
- proteção CSRF para endpoints baseados em cookie;
- rate limit e bloqueio progressivo no login;
- hashes de senha produzidos por algoritmo apropriado e parâmetros versionados;
- separação entre sessões humanas, credenciais de serviço e delegações Hermes/MCP;
- papéis e tenant resolvidos no servidor, nunca aceitos como verdade a partir do browser.

O frontend receberá um novo `AuthContext` que preserve as necessidades atuais de `session`, `user`, `profile`, `signOut` e papéis sem importar tipos ou clientes do Supabase.

Os UUIDs atuais devem ser preservados sempre que possível para não quebrar foreign keys, históricos, autoria e policies. A migração de senhas dependerá da compatibilidade entre o formato dos hashes. Se não houver compatibilidade segura, a estratégia será recriar contas ou exigir redefinição de senha.

Decisão pendente: definir se existirão somente contas criadas por administrador ou também autocadastro, recuperação por e-mail e login social. Recuperação por e-mail implica operar um SMTP próprio ou autorizar um provedor externo.

Referências:

- [Better Auth com banco de dados](https://better-auth.com/docs/installation)
- [Keycloak em containers](https://www.keycloak.org/server/containers)
- [Configuração de produção do Keycloak](https://www.keycloak.org/server/configuration-production)

## App API/BFF

A mudança de maior impacto no frontend é substituir o acesso direto por `supabase-js`. Chamadas `from`, `rpc`, `storage` e `auth` devem migrar para clientes de domínio que conversem com a App API/BFF.

A App API será responsável por:

- autenticar a requisição e carregar o perfil;
- resolver tenant e permissões;
- abrir transações com o contexto correto para o RLS;
- validar payloads e estados de negócio;
- coordenar PostgreSQL, Artifact Server, Chat Bridge e workers;
- emitir eventos e registros de auditoria;
- devolver contratos estáveis ao frontend, sem expor o schema do banco.

Essa fronteira evita que mudanças de tabelas ou de infraestrutura obriguem o frontend a conhecer detalhes internos.

## Funções, triggers e workers

As antigas Edge Functions serão classificadas pelo tipo de responsabilidade:

- funções SQL para invariantes, agregações e operações atômicas próximas aos dados;
- endpoints Node para fluxos HTTP, integrações, IA, Hermes e regras de negócio;
- workers para tarefas demoradas, retries, expirações e processamento assíncrono;
- triggers apenas para consistência que precise ser garantida em qualquer origem de escrita.

Stored procedures não devem acumular orquestração, chamadas de rede ou lógica extensa difícil de testar. O padrão transactional outbox permitirá gravar a mudança de domínio e o evento correspondente na mesma transação; um worker publicará ou processará esse evento com idempotência e retry.

## Storage e arquivos

O Artifact Server permanece como a fronteira de arquivos do ENS. Na primeira etapa ele pode usar um volume persistente local, com metadados no PostgreSQL. O contrato interno deve permitir a troca posterior por um backend compatível com S3 sem alterar o frontend.

Uploads e downloads privados devem usar autorização da App API e URLs temporárias ou streaming autenticado. Nomes recebidos do usuário não devem se transformar diretamente em caminhos de filesystem.

Avatares, anexos, imagens geradas e artefatos existentes precisarão de inventário, cópia, checksum e reconciliação com seus registros no banco antes do corte definitivo.

## Realtime

O produto não precisa reproduzir genericamente o Supabase Realtime. Cada caso de uso será migrado para uma primitiva explícita:

- SSE para streaming unidirecional, progresso e eventos de aprovação;
- WebSocket quando houver comunicação bidirecional persistente;
- outbox e workers para entrega confiável;
- `LISTEN/NOTIFY` apenas como sinal interno, nunca como fila durável.

O Chat Bridge já é a fronteira natural para o streaming do Hermes. Eventos de domínio do Marketing Ops devem passar pela App API ou pelo mecanismo de outbox.

## RAG e vetores

Embeddings e documentos estruturados podem permanecer no PostgreSQL por meio de `pgvector`. Binários e arquivos-fonte permanecem no Artifact Server. A migração deverá recriar índices vetoriais, conferir dimensão e modelo de embedding e validar qualidade de recuperação, não apenas copiar linhas.

## Alternativas consideradas

### 1. Serviços ENS sobre PostgreSQL vanilla — recomendada

Vantagens:

- menor dependência arquitetural;
- contratos de domínio claros;
- mesma topologia local e na VPS;
- componentes adicionados somente quando necessários;
- frontend desacoplado do banco.

Custos:

- maior trabalho inicial de migração;
- responsabilidade por segurança, backups, observabilidade e atualizações;
- necessidade de implementar a App API e a identidade.

### 2. Supabase totalmente self-hosted

É a rota de menor reescrita e não exige o serviço gerenciado. Entretanto, mantém a arquitetura e o ciclo de atualizações do Supabase. A documentação oficial deixa claro que o operador assume hardening, banco, backups, disaster recovery, monitoramento e disponibilidade.

Essa opção pode ser usada como ponte emergencial, mas não é a arquitetura alvo do novo monorepo. Mudanças recentes no self-hosted, como a troca do gateway padrão e upgrades de PostgreSQL, reforçam que ele continua sendo uma plataforma composta a ser operada e atualizada.

Referências:

- [Self-hosting do Supabase](https://supabase.com/docs/guides/self-hosting)
- [Changelog de breaking changes](https://supabase.com/changelog?types=breaking-change)

### 3. Banco vanilla sem RLS e autorização somente na aplicação

Tem menor custo inicial, mas perde uma importante camada contra BOLA/IDOR, falhas de query e acessos cruzados entre tenants. Não é recomendada para o ENS.

## Fases da migração

### Fase 0 — inventário e preservação

- congelar e copiar para uma área de referência as migrations, policies, funções, triggers e configurações do projeto antigo;
- inventariar tabelas, extensions, usuários, buckets, arquivos, Edge Functions, cron jobs e consumers de Realtime;
- identificar todos os usos de `supabase-js`, variáveis de ambiente e service role;
- registrar volume, criticidade, proprietário e estratégia de migração para cada conjunto de dados.

### Fase 1 — baseline PostgreSQL vanilla

- gerar uma baseline limpa em `db/migrations`, sem depender da execução sequencial de todo o histórico Supabase;
- separar schemas de aplicação, identidade, auditoria e infraestrutura quando adequado;
- criar papéis sem `BYPASSRLS` e policies vanilla;
- instalar somente extensions realmente usadas, incluindo `pgvector` quando necessário;
- fazer migrations e testes rodarem contra PostgreSQL local em Docker.

### Fase 2 — identidade

- decidir entre serviço Node embutido e Keycloak;
- definir criação de contas, recuperação, MFA e e-mail;
- preservar UUIDs e migrar perfis, papéis e associações de tenant;
- definir migração ou redefinição de senhas;
- criar sessões humanas e credenciais de serviço separadas;
- adaptar `AuthContext` e os testes de login.

### Fase 3 — App API/BFF e dados

- criar os contratos da API por fatias verticais;
- substituir `supabase.from()` e `supabase.rpc()` gradualmente;
- introduzir contexto transacional de RLS;
- testar acesso cruzado entre usuários e tenants;
- retirar a service role dos fluxos normais da aplicação.

### Fase 4 — storage, realtime e jobs

- migrar buckets e metadados para Artifact Server/storage local;
- substituir assinaturas e URLs Supabase;
- migrar Realtime para SSE/WebSocket e outbox;
- migrar cron e filas para workers locais;
- validar retries, idempotência e recuperação após reinício.

### Fase 5 — migração de dados e corte

- ensaiar export e restore completos;
- validar contagens, checksums, foreign keys, arquivos e permissões;
- executar um período de comparação ou dual-read quando aplicável;
- definir janela de congelamento de escrita;
- fazer backup final, migrar deltas, trocar endpoints e monitorar;
- manter rollback documentado até a aceitação do novo ambiente.

### Fase 6 — remoção do legado

- remover `@supabase/supabase-js`, Supabase CLI e variáveis `VITE_SUPABASE_*`;
- remover scripts e testes dependentes da plataforma antiga;
- revogar chaves, tokens e acessos do projeto antigo;
- arquivar o snapshot de referência e manter somente o necessário para auditoria;
- atualizar runbooks, diagramas e procedimentos de recuperação.

## Testes e critérios de aceite

A migração não estará concluída apenas porque a aplicação abre. Cada fatia deve validar:

- login, logout, expiração e revogação de sessão;
- acesso permitido e negado por papel e tenant;
- tentativas de BOLA/IDOR;
- inserts e updates com `USING` e `WITH CHECK`;
- concorrência, idempotência e rollback;
- upload, download, remoção e URLs expiradas;
- entrega, reconexão e perda controlada de eventos em tempo real;
- restart dos containers e recuperação dos workers;
- restore do PostgreSQL e dos arquivos em ambiente limpo;
- igualdade de contagens e checksums entre origem e destino;
- ausência de chamadas, chaves e hosts Supabase no build final.

Critério final: o ambiente local deve iniciar com a mesma definição usada na VPS, executar os testes de integração sem conexão com o Supabase e poder ser restaurado a partir de backups documentados.

## Operação e backups

Ao abandonar um serviço gerenciado, o ENS assume explicitamente:

- atualizações de PostgreSQL e dos containers;
- TLS, reverse proxy e gestão de secrets;
- backups automáticos do banco e dos arquivos;
- retenção e cópia externa ou em outro host;
- testes periódicos de restore;
- logs, métricas, alertas e health checks;
- capacidade de disco, conexões e crescimento de tabelas;
- plano de indisponibilidade e rollback.

Um backup que nunca foi restaurado em teste não deve ser considerado confiável.

## Decisões pendentes

1. Contas apenas por administrador ou também autocadastro?
2. Recuperação por e-mail será necessária?
3. Haverá login social, SSO, MFA ou passkeys?
4. O primeiro backend de arquivos será volume local ou object storage S3-compatible?
5. Qual janela de indisponibilidade é aceitável para o corte dos dados?
6. Por quanto tempo o Supabase antigo permanecerá disponível para rollback?

Essas decisões devem ser resolvidas antes do plano executável da migração, mas não impedem o inventário da Fase 0.
