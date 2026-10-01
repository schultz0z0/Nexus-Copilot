# Marketing Dashboard Implementation Plan

**Goal:** entregar um dashboard Prometeus navegável e demonstrativo para validação gerencial.

**Architecture:** página React lazy na navegação Marketing Ops existente. Modelo local de fixtures e seletores puros, isolado das APIs do produto. Preservar o checkout atual porque contém a identidade aprovada ainda não consolidada; nenhuma operação de produção.

**Tech Stack:** React, TypeScript, Tailwind semântico, componentes Radix existentes, Recharts, Vitest e Playwright.

## 1. Modelo de demonstração e contrato matemático

- Criar `apps/chat-web/src/lib/dashboard/model.test.ts` com testes de filtros,
  ausência de dados, base zero, custo pago e diferenças coorte/fechamento.
- Rodar `rtk proxy npm --prefix apps/chat-web run test -- src/lib/dashboard/model.test.ts`; confirmar falha por módulo ausente.
- Criar `apps/chat-web/src/lib/dashboard/model.ts`: fixtures semanais determinísticas,
  agregação e formatação segura, metas no mesmo recorte e validação do exemplo semanal.
- Repetir os testes até passar.

## 2. Tela e navegação

- Criar `apps/chat-web/src/pages/marketing-ops/MarketingDashboardPage.tsx` e
  `apps/chat-web/src/components/dashboard/WeeklyResultsDialog.tsx`.
- Reutilizar Sidebar, MarketingOpsMobileBar, Button, Dialog e tokens de marca.
- Filtros atualizam os blocos de resultados; detalhes abrem em diálogo acessível.
- Gráfico possui alternativa tabular. Critérios de saúde e fonte/corte ficam visíveis.
- Adicionar rota lazy protegida em `src/App.tsx` e entrada em `components/Sidebar.tsx`.
- Documentar no `apps/chat-web/DESIGN.md` o escopo demonstrativo e contrato futuro.

## 3. Revisão e verificação

- Criar `apps/chat-web/e2e/marketing-dashboard.spec.ts`, reutilizando fixtures de autenticação locais.
- Validar filtros, estados sem dados, revisão semanal, Escape/retorno do foco,
  axe em desktop/mobile e ausência de overflow. Salvar capturas em `tmp/dashboard-review/`.
- Rodar typecheck, build, testes unitários relevantes e e2e com `E2E_FAKE_MODE=marketing-ops`.
- Inspecionar capturas, corrigir problemas e disponibilizar prévia local. Não iniciar CRM.

## Resultado da primeira versão

Implementada a rota demonstrativa, filtros, detalhes de canal/campanha, funil de
coorte, fontes e revisão semanal sem persistência. A revisão encontrou dois
problemas corrigidos: semana sem relatório aparecia como zero no gráfico e o
fechamento de diálogos não devolvia o foco ao gatilho. Ambos possuem regressões.

Verificação em 26/09/2026: build passou; 6 testes do modelo passaram; 2 testes
Playwright do dashboard passaram em desktop/mobile, com axe, filtros, estados
vazios e foco. A execução conjunta anterior de marca/dashboard passou 5 testes;
a suíte Vitest completa passou 205 testes antes da adição do detalhamento de
canal. O typecheck explícito do tsconfig.app ainda encontra erros em arquivos
fora do dashboard; o script typecheck da raiz do app não percorre as referências
e não deve ser usado isoladamente como evidência de tipagem global.

## Exploração alternativa solicitada

O responsável pediu uma segunda composição gerada via MCP Stitch, com liberdade
de componentes e layout e fidelidade ao KV do brandbook. Artefatos e prompts em
`.stitch/`, índice em `docs/brandbook/exploracoes/dashboard-stitch.md`. A primeira
versão permanece preservada. Essa exploração não muda os tokens canônicos nem
autoriza iniciar o CRM antes da validação completa do dashboard.
