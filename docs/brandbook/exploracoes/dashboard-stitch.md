# Dashboard — alternativa Stitch

Exploração solicitada em 26/09/2026. **Ainda não é uma nova versão aprovada do
design system.** O responsável autorizou liberdade na composição e em novos
componentes, mantendo cores, tipografia, logo e essência do brandbook.

- [Projeto privado no Stitch](https://stitch.withgoogle.com/projects/11535637910255965569)
- [Comparador local A/B](http://127.0.0.1:18091/)
- [Versão A implementada](http://127.0.0.1:18088/marketing-ops/dashboard)
- [Arquivos da exploração](../../../.stitch/README.md)

O projeto no Stitch recebe uma síntese da identidade aprovada, com a logo
original incorporada, e requisitos funcionais fictícios do dashboard. O código
HTML exportado é um estudo visual: botões e filtros desenhados não equivalem a
integrações funcionais. A versão React atual continua preservada.

Os links locais dependem dos servidores de prévia. As integrações de anúncios,
persistência de relatórios via Hermes e CRM continuam fora desta exploração.
Os arquivos de geração e suas revisões são rastreados em `.stitch/metadata.json`.

## Evolução C

O responsável aprovou seguir com a base funcional A e a hierarquia de B,
acrescentando gráficos. A prévia atual em `/marketing-ops/dashboard` é a
versão C: evolução em linhas/área, rosca de participação dos canais, barras
de investimento e funil proporcional. Todos respondem ao mesmo recorte.

Recharts já existia na plataforma; nenhuma dependência foi instalada. A paleta
usa tokens do brandbook, sem cores de status para identificar canais. Valores
exatos, percentuais e cobertura permanecem acessíveis por legenda/tabela.
O arquivo fonte A foi preservado em `.stitch/archive/`; a referência visual A
continua no comparador. As telas B permanecem no projeto Stitch.

Essa direção continua em validação. Não altera o brandbook canônico nem inicia
o CRM. Ver `docs/plans/2026-09-26-dashboard-c-visual-design.md`.
