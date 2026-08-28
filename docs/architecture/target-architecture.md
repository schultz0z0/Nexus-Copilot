# Arquitetura-alvo da plataforma ENS

**Estado:** Aceito como direção; detalhes marcados como pendentes exigem ADR  
**Data:** 2026-08-28

## Visão geral

```text
Internet
   |
Traefik + TLS
   |-----------------------> Frontend
   |-----------------------> App API / BFF
   `-----------------------> Dashboard Hermes (temporário, OAuth)

Frontend
   `-> App API / BFF
          |-> PostgreSQL
          |-> Artifact Server -> object storage
          `-> Chat Bridge -> Hermes API interna (:8642)
                                `-> Profile ENS -> MCP Marketing Ops

Operador
   `-> Docker Compose / backups / atualização manual
```

O navegador nunca acessa PostgreSQL, Hermes, MCPs ou object storage diretamente.
URLs assinadas de curta duração para artefatos poderão ser emitidas pela App API
ou Artifact Server quando o desenho de storage for aprovado.

## Autoridade e responsabilidades

| Domínio | Autoridade | Responsabilidade |
| --- | --- | --- |
| Identidade e sessão | solução de Auth + App API | autenticar e estabelecer o principal |
| Tenant e autorização de negócio | App API, reforçada no PostgreSQL | impedir acesso indevido independentemente do agente |
| Dados estruturados do produto | PostgreSQL | persistência, integridade, auditoria e políticas de linha |
| Arquivos e artefatos | Artifact Server + object storage | upload, download, metadados e retenção |
| Orquestração conversacional | Chat Bridge | adaptar contratos do produto à API oficial do Hermes |
| Execução do agente | Hermes oficial | runs, sessões, ferramentas, aprovações e eventos |
| Personalidade e integrações ENS | `agents/ens` | SOUL, skills, plugins, MCPs e configuração distribuível |
| Operações de marketing | Marketing Ops MCP | ferramentas de domínio autorizadas e auditáveis |
| Entrada pública e TLS | Traefik externo | roteamento somente dos endpoints aprovados |

## Componentes

### Frontend

É cliente da App API/BFF. Nenhum SDK Supabase ou segredo de infraestrutura deve
permanecer no build final. O frontend pode manter contratos de streaming e
aprovação expostos pelo produto, sem conhecer o protocolo interno do Hermes.

### App API / BFF

É a fronteira pública do backend. Resolve sessão, tenant, autorização, validação,
rate limiting e composição de dados. O desenho físico poderá evoluir do serviço
existente, mas essa responsabilidade não pode ser delegada ao frontend ou ao
modelo.

### PostgreSQL

É a autoridade dos dados do produto. RLS nativo é tecnicamente suportado e será
usado onde trouxer defesa em profundidade. A aplicação deverá estabelecer o
contexto de identidade/tenant por transação e usar papéis sem `BYPASSRLS`.
Funções SQL serão reservadas a invariantes, operações transacionais e consultas
próximas dos dados; lógica de integração fica nos serviços.

### Chat Bridge

É o adaptador entre contratos do ENS e a API oficial do Hermes. Deve:

- criar e acompanhar Runs oficiais;
- consumir SSE e preservar retomada por cursor/evento;
- encaminhar decisões de aprovação e cancelamento;
- traduzir falhas sem vazar credenciais ou detalhes internos;
- consultar capabilities e distinguir saúde de prontidão;
- persistir estado de produto no PostgreSQL quando a fase de dados for concluída.

### Hermes Agent

Produção executa a imagem oficial fixada por versão e digest. Um inicializador
one-shot instala ou atualiza a distribuição local montada em `agents/ens`; após
sucesso, um único container persistente inicia o runtime. Provider e credenciais
são configurados manualmente e nunca entram no Git.

O desenho detalhado está em
[Hermes oficial e Profile Distribution ENS](../plans/2026-08-28-hermes-official-runtime-design.md).

### Profile Distribution ENS

`agents/ens` contém apenas extensão suportada pelo upstream: configuração base,
SOUL, skills, plugins, MCPs e cron. Atualizações preservam configuração manual e
dados do usuário. O repositório não contém `.hermes`, sessões, memórias ou banco
do runtime.

### Artifact Server e object storage

O Artifact Server controla acesso e metadados; o storage guarda blobs. A escolha
do storage e as políticas de assinatura, retenção, backup e antivírus permanecem
pendentes de ADR.

### Marketing Ops MCP

Permanece interno. Recebe contexto e credenciais controlados pela aplicação e
expõe ferramentas explícitas. Referências legadas ao Supabase serão substituídas
na fase de dados e integrações.

## Ambientes

| Aspecto | Desenvolvimento Windows | Produção VPS Linux |
| --- | --- | --- |
| Hermes | instalação local já existente | imagem oficial via Docker Compose |
| Profile ENS | instalada/atualizada a partir de `agents/ens` | inicializador one-shot antes do runtime |
| Provider | configuração manual local | configuração manual no volume persistente |
| Aplicação | processos locais e/ou Docker Desktop | containers do Compose |
| Entrada | localhost | Traefik externo com TLS |
| Dados | base local descartável ou restaurada | volumes e backups operacionais |

Docker Desktop serve como teste de paridade da composição Linux. O fluxo diário
de desenvolvimento não instala outro Hermes automaticamente.

## Redes e exposição

- pública: frontend, App API/BFF e dashboard Hermes temporário;
- interna de aplicação: App API, Bridge, Artifact Server e serviços de domínio;
- interna de agente: Bridge, Hermes e MCPs;
- dados: PostgreSQL e object storage, sem publicação na internet.

O Traefik é um Compose externo com Docker provider e `network_mode: host`. O
projeto fornece labels compatíveis, sem gerenciar nem acoplar-se ao Compose do
Traefik. A API Hermes não recebe router público.

## Fluxo de identidade e tenant

1. Auth autentica o usuário e emite uma sessão verificável.
2. App API valida a sessão e resolve usuário, tenant e permissões.
3. A transação PostgreSQL recebe contexto mínimo e políticas RLS reforçam o
   filtro.
4. Ao acionar o agente, App API/Bridge passam apenas o contexto autorizado e
   necessário.
5. Hermes e o modelo não podem elevar privilégios nem selecionar outro tenant.

O mecanismo exato de Auth e a forma do contexto transacional aguardam ADR.

## Fluxo de conversa

1. Frontend envia a solicitação autenticada à App API/BFF.
2. A aplicação autoriza e cria o registro de produto.
3. Chat Bridge cria um Run na API interna oficial do Hermes.
4. Bridge consome eventos SSE, normaliza-os e os transmite ao frontend.
5. Aprovações humanas voltam ao Bridge e são enviadas ao endpoint oficial do Run.
6. Estado durável e auditoria de produto são persistidos no PostgreSQL.

## Restrições invariantes

- sem fork ou cópia do core Hermes;
- sem Supabase, Graph MCP ou Neo4j no alvo;
- sem acesso navegador -> banco/Hermes;
- sem identidade ou autorização decidida pelo modelo;
- sem dois processos escrevendo simultaneamente no mesmo `HERMES_HOME`;
- sem Docker socket montado no Hermes;
- sem segredo ou estado de runtime versionado;
- sem atualização automática do core em produção.

## Qualidades operacionais

- health indica processo vivo; readiness indica dependências necessárias;
- provider ausente é estado explícito na implantação inicial;
- logs estruturados usam IDs de correlação e aplicam redação;
- backups abrangem PostgreSQL, object storage e volume Hermes, com restauração
  exercitada;
- deploys usam artefatos fixados e rollback conhecido;
- contratos externos do produto são testados contra simuladores e, no gate final,
  contra o runtime real.

## Decisões que exigem ADR

- Auth e sessões;
- modelo RLS e pool de conexões;
- object storage;
- jobs, filas, cron e realtime;
- observabilidade e retenção;
- SLO, RPO e RTO;
- retirada do dashboard público;
- topologia final dos serviços da App API.

