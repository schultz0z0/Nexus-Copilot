# Web Analytics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Entregar GA4 e Clarity nativos, conexão amigável, resultados gerais e por campanha, com substituição segura e ambiente local atualizado.

**Architecture:** BFF autenticado → Marketing Ops → PostgreSQL. Aplicativo Google da instalação reutilizado internamente. Analytics separado de Ads e resultados comerciais. Tokens cifrados, RLS, estados de sessão e geração para impedir publicação de trabalhos antigos.

**Tech Stack:** TypeScript/Express/pg, Fastify BFF, React/TanStack Query/Recharts, migrations SQL, Vitest e Playwright existentes.

## Contrato de implementação

Todas as respostas seguem `{data: T}`. Provedores `ga4 | clarity`.

Connection: `{provider,status,version,resources,selectedResourceId,lastSyncAt,safeError}`. Status: `unprepared | prepared | pending_resource | connected | partial | reconnect_required | disconnected | error`. Resource: `{id,name,timeZone,currency?}`. Clarity tem um recurso cadastrado por token; seu nome é informado pelo administrador.

- GET `/v1/web-analytics/connections` → Connection[].
- POST `/v1/web-analytics/ga4/authorize` → `{authorizationUrl}`; sessão vinculada pelo BFF.
- Callback existente POST `/v1/ads-integrations/google/callback` despacha estados GA4 e retorna `{data:{provider:'ga4'}}`; Ads mantém contrato. BFF só usa essa tag validada para escolher resultado fixo.
- GET `/v1/web-analytics/ga4/resources` → Resource[].
- POST `/v1/web-analytics/ga4/resource`, If-Match → `{resourceId,confirmReplacement?}` → Connection.
- POST `/v1/web-analytics/clarity/connect`, If-Match + Idempotency-Key → `{token,projectId,projectName,confirmReplacement?}` → Connection. Apenas admin. ID/rótulo fornecidos são apresentados como tal; token é validado por leitura da API.
- POST `/v1/web-analytics/:provider/disconnect`, If-Match → Connection.
- POST `/v1/web-analytics/:provider/sync`, Idempotency-Key → `{from?,to?}` → SyncReceipt. GA4 aceita até 30 dias completos, Clarity atualiza última janela de 24h.
- GET `/v1/web-analytics/:provider/results?from=YYYY-MM-DD&to=YYYY-MM-DD` → AnalyticsResults.
- GET/POST `/v1/campaigns/:id/web-analytics-links` → Link[] / Link. Input `{provider,utmCampaign}`; resource é seleção atual do servidor.
- POST `/v1/campaigns/:id/web-analytics-links/:linkId/disable`, If-Match → Link.
- GET `/v1/campaigns/:id/web-analytics-results?from=...&to=...` → `{ga4:AnalyticsResults|null,clarity:AnalyticsResults|null}`.

Link: `{id,campaignId,provider,resourceId,utmCampaign,enabled,version}`. Correspondência exata do parâmetro manual UTM; não inferir por nome do produto. Não permitir o mesmo segmento/recurso ativo em duas campanhas.

AnalyticsResults: `{provider,resource:Resource|null,from,to,lastSyncAt,totals:AnalyticsTotals|null,daily:AnalyticsDaily[],channels:AnalyticsChannel[],campaigns:AnalyticsCampaign[],warnings:string[],window:null|{from:string,to:string},stale:boolean}`.

AnalyticsTotals: `{sessions:number,botSessions?:number|null,engagedSessions:number|null,pageViews:number|null,keyEvents:number|null,rageClicks:number|null,deadClicks:number|null,scrollDepth:number|null}`. Nullable é desconhecido, zero apenas medido. Daily: `{date,sessions,engagedSessions,pageViews,keyEvents}`. Channel: `{source,medium,sessions}`. Campaign: `{utmCampaign,sessions}`. Clarity sem histórico diário aditivo: daily vazio e window obrigatório.

SyncReceipt: `{id,status:'completed'|'partial',completedAt,warnings:string[]}`. Erros seguros prefixo `analytics_`; contratos rejeitam chaves extras, strings inválidas, datas futuras, confirmações ausentes e versão obsoleta. Receipts idempotentes, limitações e gerações persistentes.

## Tarefas e verificação

- [x] Backend: começar por testes de providers HTTP e contratos, confirmar RED; criar `integrations/analytics/*`, `domain/webAnalytics.ts`, migration 0022, testes RLS/concurrency/replay/idempotência/quotas/geração e rotas. Injetar em `index.ts` e scheduler. Estender referências cifradas e invalidação de aplicativo Google.
- [x] BFF: testes RED de binding GA4 e callback compartilhado; modificar `marketing/routes.js`, `adsOAuth.js` com redirects fixos e conteúdo upstream limitado. Sem segredos/log de query.
- [x] UI: testes RED de configuração, OAuth, escolher/trocar recurso, segredo não reapresentado, erro/vazio/conflito; criar cliente analytics e painéis. Google preparo avançado reutilizado, não exigir credenciais por usuário. Criar Análise do site e painel atribuição/resultados de campanha. Verificar teclado, viewport móvel e alternativa aos gráficos.
- [x] Revisão de conformidade e qualidade; corrigir e repetir checks apropriados.
- [x] Documentação: manual rápido, APIs habilitadas/tag do site, limitações Clarity, operação e atualizar AGENTS.md. Não afirmar integração real ativa sem recurso autorizado.
- [x] Aplicar migration ao PG local, reconstruir via `tmp/ads-local-runtime.py rebuild`, checar saúde e experiência local. Preservar segredos existentes. Validação externa aguarda propriedade GA4/tag e token Clarity do responsável.

O responsável autorizou implementar; executar nesta sessão. Manter o checkout atual com mudanças anteriores; não resetar, commitar ou mover trabalho já aprovado.

## Evidência final — 01/10/2026

- Marketing Ops: 438 testes aprovados; dois testes de integração antigos não executados pela suíte configurada. PostgreSQL isolado verificou migrações 0001–0022 e replay idempotente.
- App API/BFF: 108 testes aprovados. Frontend: 291 testes aprovados e TypeScript sem erros.
- Playwright: três fluxos aprovados com provedores simulados, incluindo consentimento/propriedade, token privado, foco, acessibilidade, 320 px e movimento reduzido.
- Revisões de especificação e qualidade aprovadas após corrigir atualização por período, tentativas expiradas, troca de filtros e orçamento de execução completo, incluindo nginx.
- Migração 0022 aplicada ao PostgreSQL local. Docker recompilado; frontend, BFF e Marketing Ops saudáveis, assim como Chat Bridge e Artifact Server. `nginx -t` aprovado.
- Conferência autenticada do build local: aplicativo Google e callback existentes preservados; GA4 preparado, sem propriedade selecionada; botões visíveis; tela vazia correta; aba da campanha acessível; sem erro de script ou overflow a 320 px.

**Validação externa pendente do responsável:** criar propriedade/fluxo GA4, instalar a tag, habilitar Admin/Data APIs e autorizar a propriedade; fornecer token Clarity apenas pelo formulário privado do app. Os testes e a conferência local não equivalem a leituras reais desses provedores. Nenhuma implantação em VPS foi executada.
