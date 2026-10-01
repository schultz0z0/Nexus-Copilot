# Dashboard C — direção aprovada e execução

O responsável aprovou a combinação da funcionalidade A com a hierarquia B e
solicitou mais gráficos. A composição C será aplicada na rota demonstrativa
existente, preservando as fontes de dados e os contratos de interação.

## Direção

Paleta canônica midnight #040814, azul #0652C5, navy #1A2338, slate #3B4B6B,
mist #E2E8F0, branco. Space Grotesk para UI e números, Geist Mono para dados
técnicos. Tokens existentes; sem nova identidade nem biblioteca.

O topo responde a situação/motivo/próxima ação; a faixa de seis indicadores
ganha hierarquia e menos caixas. Evolução e prioridades ficam juntas. A cena
seguinte combina participação por canal e investimento em mídia. O funil
mostra volumes proporcionais e taxas com leitura horizontal no desktop e
vertical no celular. Detalhes e fontes continuam acessíveis abaixo.

```
filtros
diagnóstico executivo | resultado / execução / cobertura
faixa de indicadores
evolução (linhas + área) | prioridades
origem dos leads (rosca + legenda acionável) | mídia (barras)
funil proporcional
detalhes dos canais / campanhas / fontes
```

Evitar três gráficos para a mesma informação, gráficos 3D, cores de status
para canais, donuts para taxas que não formam um todo e animação de entrada
que mascara valores. Zero e ausência de registros permanecem distintos.

## Ferramentas

O Setup consultado: busca de gráficos não encontrou recurso específico;
`skill:frontend-design` foi inspecionada e reaproveitada. Recharts 2.15.4 já
consta do app. APIs básicas Pie/Bar verificadas na documentação oficial e
tipagens da versão instalada; sem upgrade ou instalação.

## Plano

1. Preservar fonte A como referência da exploração. Estender teste navegador
   para gráficos, filtros, detalhe por teclado e estados ausentes.
2. Implementar gráficos em componente de domínio, usando dados do mesmo
   seletor do dashboard. Sem nova agregação/atribuição ou escrita via API.
3. Refazer resumo, faixa de indicadores e funil; preservar labels, diálogos,
   retorno do foco e navegação existentes.
4. Verificar build, lint dos arquivos alterados, modelo e E2E desktop/mobile,
   incluindo axe, redução de movimento e ausência de overflow.
5. Inspecionar resultado visual e atualizar contratos/exploração. CRM e APIs
   reais permanecem dependentes de etapas futuras e validação do responsável.

## Resultado e verificação

Implementação C concluída na rota `/marketing-ops/dashboard`, com Recharts
existente, tokens canônicos e dados demonstrativos. A fonte A está preservada
em `.stitch/archive/MarketingDashboardPage-A.tsx`; B permanece no comparador.

- Playwright: 3 testes aprovados, incluindo filtros, valores ausentes,
  acionamento por teclado, retorno de foco, axe, movimento reduzido e
  responsividade em 320, 390, 768 e 1024px.
- Modelo: 6 testes aprovados em `src/lib/dashboard/model.test.ts`.
- ESLint: aprovado nos três arquivos de implementação alterados e no E2E.
- Build Vite: aprovado; permanece aviso de bundle principal acima de 500 kB
  e base Browserslist antiga.
- TypeScript explícito com `tsconfig.app.json`: 32 diagnósticos fora dos
  arquivos do dashboard; nenhum diagnóstico nos arquivos desta mudança.
  O typecheck global não está aprovado. Registro local em
  `tmp/dashboard-review/typescript-c.txt`.
- Revisão de código: corrigida a descrição acessível da participação dos
  canais e a abertura do informe de WhatsApp no canal correto; testes cobrem
  ambos os comportamentos.
- Inspeção visual: prévia navegável, captura desktop/mobile e detalhes de
  rosca/barras conferidos. Captura C disponível no comparador `.stitch/`.

Integrações reais, persistência de métricas e CRM não fazem parte desta etapa.
