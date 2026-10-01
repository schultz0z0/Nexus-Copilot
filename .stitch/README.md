# Prometeus — alternativas de dashboard

Estudo gerado pelo **MCP Stitch**, 26/09/2026, a pedido do responsável.
O brandbook canônico continua em `docs/brandbook/`; estes arquivos são uma
exploração com liberdade de composição e não mudam a identidade aprovada.

## Ver e comparar

- Comparador: http://127.0.0.1:18091/
- C, React navegável: http://127.0.0.1:18088/marketing-ops/dashboard
- A, referência preservada: captura no comparador e fonte em `archive/MarketingDashboardPage-A.tsx`
- B, desktop: `designs/dashboard-desktop.html`
- B, mobile: `designs/dashboard-mobile.html`
- Projeto: https://stitch.withgoogle.com/projects/11535637910255965569

Para reabrir apenas B/comparador: na raiz do repositório,
`rtk proxy python -m http.server 18091 --bind 127.0.0.1 --directory .stitch`.
C depende da prévia do aplicativo em execução. Os HTMLs também podem ser
abertos diretamente; fontes e CSS exportados dependem de internet/CDNs.

## Proveniência e revisão

`DESIGN.md` é a síntese fornecida ao Stitch com a logo original incorporada.
`prompts/` registra os pedidos. `metadata.json` identifica as gerações e telas
recomendadas. No canvas Stitch, usar **FINAL B — desktop · para comparação** e
**FINAL B — mobile · para comparação**;
as gerações anteriores são histórico da exploração.

`*-stitch-export.html` preserva a saída bruta. Os HTMLs sem esse sufixo mantêm a
composição do Stitch, com curadoria limitada à marca e textos: substituição de
logo inventada/truncada pela arte original; remoção de afirmações falsas de
sincronização, auditoria e CPL; esclarecimento do CRM futuro; foco e movimento
reduzido. Esses exports revisados também foram enviados ao canvas do Stitch.
As PNGs são capturas geradas pelo Stitch antes dessa última curadoria textual.

São **estudos visuais estáticos**, não uma implementação de integrações,
filtros, permissões ou atualização de relatórios. Valores fictícios diferem
entre A e B; a comparação neste momento é de composição e hierarquia.

A versão mobile foi inspecionada em 390 e 320px sem overflow de página e com
logo carregada. O desktop foi inspecionado em 1440px e seu refluxo em 390px,
também sem overflow de página. A versão escolhida ainda precisa de
verificação completa de acessibilidade/fluxos quando o responsável escolher
a direção. Não tratar a descrição automática do Stitch como certificação.

CRM começa somente após validação completa do dashboard.

## Implementação C

C combina a funcionalidade de A com a hierarquia visual explorada em B e
inclui evolução em linhas/área, participação por canal em rosca, investimento
em barras e funil proporcional. Foi implementada no aplicativo com Recharts
já instalado; não é uma nova geração do Stitch. Mantém dados demonstrativos.

Validada com três testes de navegador (desktop, filtros, teclado, axe,
movimento reduzido e larguras de 320 a 1024px), seis testes do modelo, lint
dos arquivos alterados e build. O typecheck completo registra 32 diagnósticos
fora dos arquivos do dashboard. Detalhes em
`../docs/plans/2026-09-26-dashboard-c-visual-design.md`.
