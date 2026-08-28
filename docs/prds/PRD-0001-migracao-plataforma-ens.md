# PRD-0001 — Migração da plataforma ENS para infraestrutura própria

**Estado:** Aceito  
**Data:** 2026-08-28  
**Responsável de produto:** ENS  
**Roadmap relacionado:** [roadmap da migração](../migration/roadmap.md)

## Resumo

Migrar o ENS do arranjo legado, dependente de Supabase e de um fork vendorizado
do Hermes, para um monorepo operável localmente e em uma VPS Linux. O produto
usará PostgreSQL e serviços próprios, enquanto o Hermes Agent permanecerá o core
oficial da Nous Research, personalizado exclusivamente por uma Profile
Distribution ENS.

## Problema

O sistema atual funciona, mas mistura responsabilidades do produto, serviços
gerenciados externos e alterações no core do agente. Isso dificulta reproduzir
o ambiente local em produção, controlar atualizações do Hermes e entender quais
dados pertencem ao produto, ao agente ou ao armazenamento de artefatos.

A migração precisa preservar o comportamento útil do produto sem transportar
acoplamentos arquiteturais indesejados.

## Usuários e operadores

- **Usuário ENS:** conversa com o agente e usa funcionalidades do produto pelo
  frontend.
- **Administrador ENS:** configura o agente, provider, skills e integrações.
- **Operador da VPS:** realiza deploy, atualização, backup, rollback e resposta a
  incidentes.
- **Desenvolvedor:** testa integrações no Windows com o Hermes local e valida
  paridade em Docker Desktop antes da VPS.

## Resultados esperados

1. Uma única base de código explica e reproduz a plataforma ENS.
2. O mesmo perfil ENS funciona no Hermes local e no container oficial em
   produção.
3. Dados do produto deixam de depender do Supabase e passam a serviços próprios.
4. O navegador não recebe acesso direto ao banco ou ao Hermes.
5. Atualizações do Hermes são deliberadas, testadas e reversíveis.
6. Uma nova sessão de trabalho consegue retomar a migração por documentação e
   evidências, sem depender de memória de conversa.

## Requisitos funcionais

| ID | Requisito |
| --- | --- |
| RF-001 | O frontend deve acessar dados e ações do produto somente pela App API/BFF. |
| RF-002 | Usuários devem autenticar-se e operar apenas nos tenants e recursos autorizados pela aplicação. |
| RF-003 | A App API deve aplicar identidade, tenant, autorização e políticas de negócio antes de acessar dados ou acionar o agente. |
| RF-004 | O Chat Bridge deve ser a única integração de produto autorizada a acessar a API interna do Hermes. |
| RF-005 | Deve existir um único agente compartilhado, identificado pelo profile `ens`. |
| RF-006 | Skills, plugins, MCPs, SOUL e configuração ENS devem ser distribuídos por `agents/ens`, sem alterar o core do Hermes. |
| RF-007 | O PostgreSQL próprio deve ser a autoridade dos dados estruturados do produto e suportar políticas equivalentes às necessidades atuais de RLS. |
| RF-008 | Arquivos e artefatos devem passar pelo Artifact Server e por object storage próprio, sem blobs no banco. |
| RF-009 | Funções de backend devem ser implementadas em serviços da aplicação ou jobs próprios; funções SQL ficam restritas a invariantes e operações próximas dos dados. |
| RF-010 | O dashboard oficial do Hermes deve ficar temporariamente disponível em `hermes.solucoes-nexus.tech`, protegido pelo mecanismo de autenticação aprovado. |
| RF-011 | O ambiente de desenvolvimento deve usar o Hermes local existente; Docker Desktop será usado para testes de paridade, não para substituir obrigatoriamente o fluxo local. |
| RF-012 | A produção deve instalar e executar a imagem oficial e fixada do Hermes por Docker Compose na VPS. |
| RF-013 | A configuração do provider deve permanecer manual e fora do Git. |
| RF-014 | Deve existir processo verificável de backup, atualização manual e rollback do runtime e dos dados. |

## Requisitos não funcionais

| ID | Requisito |
| --- | --- |
| RNF-001 | Nenhum segredo, token, sessão, memória ou banco do Hermes pode ser versionado. |
| RNF-002 | A API do Hermes deve permanecer em rede interna; apenas o dashboard temporário recebe rota pública. |
| RNF-003 | Toda imagem de produção deve usar versão e digest explícitos. |
| RNF-004 | O sistema deve falhar fechado para autenticação e autorização. |
| RNF-005 | Migrações de banco devem ser versionadas, idempotentes quando aplicável e testadas antes do deploy. |
| RNF-006 | Logs e métricas não devem expor prompts sensíveis, credenciais ou dados pessoais por padrão. |
| RNF-007 | Cada fase precisa de testes automatizados, smoke test e evidência de aceite antes do cutover. |
| RNF-008 | Dev e produção devem compartilhar contratos e configuração declarativa, admitindo apenas diferenças de dados, segredos, endpoints e infraestrutura. |
| RNF-009 | Uma falha ou atualização do dashboard não pode expor a API interna do Hermes. |
| RNF-010 | O sistema deve permitir restaurar a versão anterior do core, da distribuição ENS e dos dados compatíveis. |

## Fora de escopo

- modificar, forkear ou vendorizar o core do Hermes Agent;
- reintroduzir Supabase, Graph MCP ou Neo4j na arquitetura-alvo;
- permitir que o modelo decida identidade, tenant ou autorização;
- automatizar atualização do core Hermes sem aprovação humana;
- publicar diretamente PostgreSQL, Chat Bridge, MCPs ou API Hermes na internet;
- migrar todos os componentes legados em um único deploy;
- decidir neste PRD o provedor de autenticação local definitivo, o object storage
  definitivo ou a estratégia de realtime. Esses itens exigem inventário e ADRs.

## Métricas de sucesso

- 100% dos fluxos críticos selecionados para o cutover passam em testes de
  contrato e smoke tests na VPS.
- 0 chamadas do frontend para SDK/endpoints Supabase no build de produção final.
- 0 componentes do core Hermes copiados ou modificados no monorepo.
- 0 portas públicas não aprovadas para banco, API Hermes, Bridge ou MCPs.
- restauração do backup testada dentro do objetivo de recuperação que será
  definido no ADR operacional.
- documentação de cada fase contém evidência suficiente para retomada por uma
  nova sessão.

## Critérios globais de aceite

- **CA-001:** um usuário autenticado completa o fluxo crítico ponta a ponta pelo
  frontend, App API, Bridge e Hermes oficial.
- **CA-002:** tentativas cross-tenant e sem autenticação são negadas pela
  aplicação e pelo banco conforme o modelo aprovado.
- **CA-003:** o frontend final não depende de Supabase, Graph MCP ou Neo4j.
- **CA-004:** o Hermes executado em produção corresponde ao digest aprovado e
  carrega o profile `ens` sem sobrescrever configuração manual ou dados.
- **CA-005:** somente `hermes.solucoes-nexus.tech` está público para o dashboard;
  a API `:8642` é alcançável apenas pela rede interna autorizada.
- **CA-006:** provider ausente é reportado como estado operacional esperado na
  implantação inicial, sem falso positivo de prontidão completa.
- **CA-007:** backup e rollback são exercitados e documentados antes do cutover.
- **CA-008:** o legado pode ser desligado sem perda de dados aceitos, artefatos ou
  rastreabilidade necessária.
- **CA-009:** o roadmap, os ADRs e os runbooks refletem o estado realmente
  implantado no momento do aceite.

## Dependências

- imagem oficial Hermes Agent `v2026.8.27` / aplicação `0.20.6`, fixada pelo
  digest aprovado no desenho do runtime;
- Docker Compose na VPS Linux e Docker Desktop para testes locais opcionais;
- Traefik externo já operado separadamente na VPS;
- PostgreSQL, autenticação, object storage, jobs e observabilidade próprios a
  selecionar e documentar nas fases correspondentes.

## Riscos principais

| Risco | Tratamento |
| --- | --- |
| Copiar comportamento legado incompatível com a nova arquitetura | Inventário por fluxo, teste de caracterização e migração faseada. |
| Perder facilitadores do Supabase sem substitutos operáveis | Matriz de capacidades, ADR por serviço e gate antes de remover cada dependência. |
| Estado do Hermes ser corrompido por inicializadores concorrentes | Um único volume, inicializador one-shot e runtime iniciado apenas após sucesso. |
| Dashboard temporário ampliar superfície de ataque | OAuth Nous, TLS, sem API pública e plano explícito de retirada. |
| Divergência entre Windows local e Linux VPS | Contratos comuns e smoke test de paridade no Docker Desktop. |
| Atualização upstream quebrar a distribuição ENS | Pin por digest, testes antes da troca, backup e rollback manual. |

## Decisões pendentes

- solução local de autenticação e formato de sessão da App API;
- desenho exato de RLS e propagação de identidade/tenant no PostgreSQL;
- object storage local e política de retenção;
- substitutos para realtime, filas, cron e funções legadas do Supabase;
- SLOs, RPO e RTO definitivos;
- critérios e data para retirar o dashboard Hermes da internet.

Cada decisão estrutural pendente deverá gerar um ADR antes da implementação.

