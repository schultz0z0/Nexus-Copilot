# Dashboard resumido e resultados por campanha

Direção fornecida pelo responsável: preservar as métricas e os gráficos aprovados,
reduzir a informação simultânea e concentrar a análise detalhada em cada campanha.

**Goal:** leitura gerencial limpa, com detalhes acessíveis sob demanda e páginas
de campanha organizadas por propósito.

**Architecture:** reutilizar Recharts, tokens Prometeus e primitives Radix existentes.
O modelo demonstrativo permanece separado da API das campanhas reais. Nenhuma
métrica de exemplo pode ser atribuída a um registro real por nome ou identificador.
As fronteiras de BFF, autorização e persistência permanecem as existentes.

**Tech stack:** React, TypeScript, React Router, Recharts, Radix Tabs/Dialog,
TanStack Query, Vitest e Playwright.

## Composição

- Geral: quatro indicadores (leads, vendas, receita, investimento), aviso compacto
  de saúde/cobertura, evolução semanal, distribuição dos leads e lista de campanhas.
- Funil, investimento por plataforma, fontes e critérios: detalhes sob demanda.
- Campanhas demonstrativas: links próprios, filtros de período/canal e resultados
  exclusivamente da campanha selecionada, com funil e leitura de canais.
- Campanhas reais: visão geral baseada nos dados reais e abas Planejamento, Equipe,
  Materiais e Histórico. Resultados ainda não medidos ficam indisponíveis.
- Rascunho de planejamento permanece ao alternar abas. Salvar continua explícito;
  permissões, conflitos de versão e confirmação de arquivamento permanecem.

## Implementação e verificação

1. Especificar navegação, escopo, ausência de dados e preservação do rascunho em
   `apps/chat-web/e2e/marketing-dashboard.spec.ts` e
   `apps/chat-web/src/pages/marketing-ops/CampaignWorkspacePage.test.tsx`.
2. Separar distribuição de canais de investimento em
   `apps/chat-web/src/components/dashboard/ChannelCharts.tsx`; extrair evolução,
   indicadores e funil para componentes de resultados reutilizáveis.
3. Reorganizar `MarketingDashboardPage.tsx` e registrar a rota de demonstração
   específica por campanha em `App.tsx`. Usar links semânticos e diálogos opacos.
4. Adicionar visão geral real e abas em `CampaignWorkspacePage.tsx`, preservando
   os formulários, painéis e contratos existentes.
5. Atualizar `apps/chat-web/DESIGN.md` com hierarquia, estados e origem dos dados.
6. Rodar testes direcionados, lint dos arquivos alterados e build; verificar
   desktop/mobile, foco, Escape, contraste e movimento reduzido pelos E2E.
7. Inspecionar capturas, reconstruir somente o frontend local Docker e verificar
   `http://127.0.0.1:8088/marketing-ops/dashboard`. Nenhuma ação na VPS.

## Evidências da entrega

- Vitest: 15 testes passaram (workspace da campanha e modelo das métricas).
- Playwright: 4 fluxos passaram, incluindo abertura por teclado, foco após Escape,
  campanha com escopo próprio, informe sem escrita e rascunho entre abas.
- Capturas verificadas em 320, 390, 768, 1024 e 1440 px; auditorias axe dos estados
  geral, detalhe e campanha passaram nas regras selecionadas de WCAG A/AA.
- Regressão encontrada e corrigida: ao abrir uma campanha, a página herdava a
  rolagem da visão geral. A navegação agora inicia no topo; teste cobre o caso.
- Revisão independente encontrou descrição acessível ausente nas linhas de
  canais. As métricas/cobertura foram associadas com aria-describedby e verificadas.
- Lint dos arquivos alterados e build Vite/Docker passaram. O TypeScript global
  ainda apresenta 32 diagnósticos preexistentes em outros arquivos (chat, planos,
  cliente Marketing Ops e testes); nenhum diagnóstico nos arquivos desta mudança.
  O build ainda informa o aviso existente de tamanho do bundle principal.
- Frontend reconstruído no Docker local. Cinco serviços ens-app saudáveis;
  endpoints locais retornaram HTTP 200 e o bundle novo foi conferido no 8088.
  As chaves locais necessárias à interpolação do Compose foram reaproveitadas
  dos serviços ativos em memória, sem exibi-las nem gravá-las nos documentos.
- Paleta e tokens em execução permanecem os existentes. As receitas de composição
  foram registradas no kit da marca; a aprovação visual final pertence ao gestor.
