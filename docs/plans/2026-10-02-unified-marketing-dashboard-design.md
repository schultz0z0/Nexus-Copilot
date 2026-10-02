# Dashboard unificado de marketing

Organização aprovada pelo responsável em 02/10/2026: **Visão geral, Orgânico,
Campanhas e Trabalho**. O dashboard concentra a leitura e o acesso operacional;
Configurações → Integrações concentra autorização, contas e aplicativos.

## Composição e comportamento

- Visão geral: quatro indicadores comerciais existentes, evolução dos leads,
  distribuição por canal e até três insights com evidência e próxima ação.
  Análise do site/Clarity fica disponível sob demanda, sem acrescentar uma parede
  de gráficos. Ações para Orgânico, Campanhas e Trabalho ficam no próprio hub.
- Orgânico: Search Console (descoberta em busca Web), GA4 recortado pelos grupos
  orgânicos oficiais de sessão e prospecção fria explicitamente separada.
  Resultados não vinculados não são atribuídos a campanhas pelo nome.
- Campanhas: filtros persistidos, mídia, resultados comerciais, navegação por
  UTM explícita e acesso às páginas reais de campanhas para aprofundamento.
  Campanhas podem ser pagas ou orgânicas. Resultados de pessoas e informes
  agregados não permitem afirmar uma conversão de coorte automaticamente.
- Trabalho: arquivos, planilhas, e-mail e agenda acessíveis diretamente, com os
  controles e confirmações existentes. Não consultar caixas/arquivos para gerar
  indicadores fictícios nem enviar/publicar ao navegar pelo dashboard.

Abas e filtros persistem na URL; abertura direta/voltar/recarregar preservam a
leitura. Rotas existentes permanecem compatíveis e encaminham para o hub quando
o conteúdo correspondente for incorporado. Respeitar papéis canônicos vigentes.
Reutilizar tokens, Recharts e componentes Prometeus; teclado, foco e mobile.

## Dados e insights

O navegador usa apenas BFF. GA4 conserva as métricas por canal no snapshot JSON
e expõe um recorte `organic` de leitura. Grupos: Organic Search, Organic Social,
Organic Video e Organic Shopping, conforme `sessionDefaultChannelGroup` da API.
Snapshots antigos sem esse recorte são desconhecidos; solicitar nova leitura,
sem reconstruir engajamento/eventos com totais gerais ou zeros. Não exige SQL novo.

As leituras GET não acionam consultas externas. Atualização é uma ação explícita,
com feedback e erro por fonte. Clarity continua em sua janela móvel UTC e com
quota durável; não é somado a sessões GA4 nem recortado falsamente pelas datas.
Search Console usa seu próprio universo de cliques, diferente de sessões GA4.

Insights são regras auditáveis e no máximo três por seção: evidência, fonte,
período, próxima ação. Priorizar lacunas de medição/atribuição antes de interpretar
desempenho. Comparações exigem mesma fonte/recorte, janelas comparáveis e cobertura
adequada. Sem metas/cobertura, não declarar operação saudável. Leads identificados,
contatos frios, cliques, eventos e vendas continuam distintos. Clarity não oferece
contagens de atrito quando unidades não tiverem sido validadas na resposta.

Referência oficial: https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema

## Validação e entrega

Testar recorte orgânico/legado, datas/atribuição, IAM, não somar janelas, persistência
da navegação, independência de falhas e GET sem sincronização. Rodar PostgreSQL
isolado, testes frontend relevantes, typechecks/builds, revisão independente e
validação no Docker local com configuração privada preservada. Nenhum deploy VPS.
