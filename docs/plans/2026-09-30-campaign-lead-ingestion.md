# Campaign Lead Ingestion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Alimentar campanhas e dashboards com contatos/leads reais, captura de formulários e resultados semanais revisados.

**Architecture:** Marketing Ops possui o domínio e PostgreSQL aplica RLS. App API é a fronteira autenticada e também expõe um adapter público estreito para fontes configuradas. Hermes usa planos preparados com confirmação humana, nunca uma mutação inferida da conversa.

**Tech Stack:** PostgreSQL, TypeScript/Zod/Express, Fastify, React/TanStack Query/Radix/Recharts, CSV e XLSX via utilitários existentes quando possível.

---

## Acompanhamento

- [x] Domínio, migration, rotas e revisão de conformidade/qualidade do backend.
- [x] BFF público, identidade de cliente assinada e testes do adapter.
- [x] Contrato/executor/presentação Hermes para relatórios com execução humana.
- [x] Cliente da interface e parser CSV/TSV/XLSX.
- [x] Interface de fontes, leads, relatórios e dashboards reais.
- [x] Migration `0019` no banco local de avaliação e serviços BFF/MOPS saudáveis.
- [x] Smoke pelo BFF real: importação, captura/replay, revisão/resultados e revogação.
- [x] Revisões da interface, testes finais e avaliação visual desktop/mobile.

Meta Ads, Google Ads e LinkedIn Ads terão aplicativos próprios da empresa,
preparados em cada instalação white label. O fluxo de conexão dentro do app está
especificado em `docs/integrations/ads-white-label.md`; não confundir essa próxima
etapa com as fontes/importações disponíveis nesta entrega.

## 1. Domínio e banco

Criar `infra/postgres/migrations/0019_marketing_ops_lead_ingestion.sql`,
`services/marketing-ops/src/domain/leads.ts` e testes, e
`services/marketing-ops/src/http/routes/leads.ts`. Registrar rotas no router.

Implementar fontes, contatos, participações, prévias de importação vinculadas ao
ator, identificadores externos, eventos de captura/clique e relatórios com
revisões. Usar FKs compostas por tenant, políticas por campanha, acesso de
owner/editor para escrita e viewer para leitura. Confirmação idempotente e
atômica; verificar novamente fonte/permissões/duplicados ao confirmar.

Rotas autenticadas sob `/v1`: campanhas/:id/lead-sources,
campanhas/:id/leads, campanhas/:id/lead-imports/preview e confirmação;
campanhas/:id/result-reports; `/results` para resumo global e por campanha.
Os nomes HTTP usarão `campaigns` (padrão existente), não a tradução acima.

Prévia distingue `new`, `duplicate`, `possible_duplicate`, `invalid`.
Confirmação permite `create`, `link`, `skip`; nenhuma união implícita por contato.
Dados frios usam classificação `cold`, captados `lead`. Relatórios preservam
valores desconhecidos e não geram contatos. Limitar tamanho/linhas e paginação.

Escrever testes regressivos primeiro; executar Vitest com PostgreSQL isolado,
verificar RLS, replay, concorrência, múltiplas campanhas e janelas sobrepostas.

## 2. BFF e captura pública

Modificar `services/app-api/src/marketing/routes.js` e testes para o adapter
`/api/capture/:publicId`. MOPS mantém rotas públicas limitadas correspondentes,
registradas fora da autenticação de sessão. Identidade decorre da fonte ativa,
não de campos recebidos do formulário. Origem permitida e limites são aplicados
no servidor; não aceitar URL arbitrária ou headers de ator no adapter público.
WhatsApp redireciona somente para destino configurado/validado, conta um clique,
nunca cria um lead. Cadastro exige submissionId para replay e contato válido.

Testes antes do código: origem, revogação, payload, replay, host de redirect e
isolamento. Sem dados pessoais na resposta pública.

## 3. Interface por campanha

Criar cliente/tipos específicos em `apps/chat-web/src/lib/marketingOps/leads.ts`
e componentes em `components/marketing-ops/`. Integrar abas Fontes e Leads,
prévia de CSV/Excel, mapeamento, candidatos à revisão, confirmação e recibo.
Preservar draft/versões existentes. Editar CampaignOverview para indicadores
reais e resultados semanais em diálogo; nenhuma fixture vinculada por nome.

Testar parser, client, confirmação e papéis com Vitest. Verificar teclado/foco
e 390/1440 px com Playwright pelo BFF real.

## 4. Hermes e dashboard

Adicionar proposta de registro de relatório aos contratos/executor dos planos,
de escopo `campaign:write`; o MCP de preparação existente recebe a nova ação.
Atualizar apresentação/recibo, testes de contrato e documentação da skill
existente `agents/ens/skills/marketing-ops-operator/` sem criar uma skill nova.

Conectar visão real resumida em MarketingDashboardPage ao read model `/results`.
Preservar acesso explícito à demonstração e filtros aplicáveis. Dados ausentes
impedem declarar saúde da operação; gráficos refletem somente registros reais.

## 5. Validação e localhost

Executar testes de serviços e frontend, lint/typecheck/build relevantes e
smoke do caminho importar → confirmar → visualizar, captura → campanha e
relatório → dashboard, incluindo rejeições. Aplicar a migration somente ao
banco local de avaliação depois de validar no banco de teste; reconstruir os
serviços locais afetados preservando configuração e dados existentes.

Documentar contrato HTTP, exemplo de landing page, colunas de arquivo e operação
humana da VPS (impacto, parada e rollback). Relatar com precisão o que está
implementado e quais integrações externas continuam dependendo do operador.

## Verificação final — 30/09/2026

- Marketing Ops: 330 testes passaram no PostgreSQL isolado; 2 testes de
  containers, fora desta execução, foram ignorados. Migration ledger 0001–0019 e
  replay idempotente conferidos.
- App API: 97 testes passaram, incluindo o adapter público e identidade assinada.
- Chat Web: 232 testes passaram em 49 arquivos; a checagem direta
  `npx tsc --noEmit -p tsconfig.app.json` passou. Lint sem erros, com 10 avisos
  anteriores. Build Docker do frontend concluído e container saudável.
- Playwright: 2 fluxos completos reais, desktop 1440 px e celular 390 px,
  passaram: importar, confirmar/recibo, captura/replay sem duplicar, revisar
  relatório pela interface, histórico, dashboards e revogação da fonte. Axe sem
  violações nos diálogos de revisão e dashboard avaliados, com movimento reduzido.
- Playwright: 4 regressões da demonstração/planejamento passaram, incluindo
  teclado, foco, filtros e larguras de 320 a 1440 px.
- Campanhas e esteira: smoke de leitura pelo BFF autenticado real passou.
- Revisões independentes de especificação e qualidade aprovadas após corrigir
  exibição da ação antes de gravar relatório, data UTC próxima da meia-noite e
  foco indevido do SVG decorativo da pizza.
- Localhost: `http://127.0.0.1:8088`; Chat Web, App API, Marketing Ops,
  Chat Bridge e Artifact Server responderam 200; `nginx -t` passou. Campanhas
  fictícias de avaliação arquivadas; nenhum deploy na VPS executado.

Correções pontuais de tipagem anteriores foram incluídas para validar o projeto
real da interface: literals do menu, discriminação do resultado de lote, objetos
de filtros e mocks compatíveis com Vitest. Não alteram o comportamento de negócio.

**Próxima etapa ainda não implementada:** conectores OAuth e sincronização
automática de Meta Ads, Google Ads e LinkedIn Ads, seguindo
`docs/integrations/ads-white-label.md`. Cadastrar uma fonte não autoriza uma conta
nem ativa sincronização. O CRM completo permanece fora desta entrega.
