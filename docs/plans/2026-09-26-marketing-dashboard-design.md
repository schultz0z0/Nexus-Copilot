# Dashboard de marketing Prometeus — desenho aprovado para protótipo

## Objetivo e decisões do responsável

Visão gerencial híbrida: geração de demanda, funil comercial e execução. Validar
o dashboard integralmente antes de começar um CRM na mesma plataforma.
Funil: lead → qualificado → oportunidade → proposta → venda. Sem matrículas.
Mídia paga: Google Ads, Meta Ads e LinkedIn Ads. E-mail e WhatsApp são operados
num serviço pago sem API disponível: o gestor fornecerá resultados semanais ao
Hermes, vinculados a ações do calendário e suas campanhas.

## Entrega desta fase

Protótipo React navegável em `/marketing-ops/dashboard`, protegido como as demais
telas de Marketing Ops. Fonte exclusivamente demonstrativa, fixa e identificada
em toda a tela. Sem integrações publicitárias, CRM, gravação de métricas ou nova
capacidade de execução do Hermes. Preservar chat, rebrand, dados e APIs existentes.

Filtros de período, campanha e canal recalculam KPIs, evolução, funil e canais.
Campanha e canal seguem a mesma atribuição exclusiva do exemplo, sem duplicação.
Metas do exemplo acompanham o mesmo recorte, nunca uma meta global sobre um filtro.
Operação/calendário e disponibilidade de fontes são identificados como visão da
operação no retrato de demonstração, independentes do período dos resultados.

Composição: cabeçalho compacto; aviso de demonstração; filtros; diagnóstico em
três dimensões; seis KPIs; evolução e prioridades; funil de coorte; tabela de
canais; campanhas; cobertura e atualização de dados. Midnight, superfícies do
design system, Space Grotesk e azul Prometeus; status semânticos claros. Mobile
empilha regiões e mantém tabela dentro de rolagem nomeada.

## Semântica dos indicadores

- Novos leads e qualificados: por data de entrada da coorte selecionada.
- Funil: pessoas da mesma coorte que atingiram cada etapa até a data de corte;
  contagens cumulativas, não estoques atuais. Taxas dividem a etapa pela anterior.
- Vendas e receita: fechamentos ocorridos no período. Não são o numerador da
  conversão da coorte; podem vir de leads antigos.
- Investimento: gasto de mídia pago no período. Custos de operação, ferramentas e
  equipe não estão incluídos; não chamar custo de mídia de CAC completo.
- Custo por lead qualificado de mídia: gasto pago / qualificados de canais pagos,
  nunca dividido por orgânico, e-mail e WhatsApp juntos.
- Resultado zero conhecido ≠ fonte sem dados. Denominadores zero geram “—”.
- Variação: períodos de igual duração. Base anterior zero gera “sem base”.
- Saúde tem critérios transparentes por dimensão, sem nota global inventada.
- Dados ausentes impedem declarar saúde positiva com base em zeros.

## Entrada semanal via Hermes — contrato futuro

1. Identificar tenant, campanha e ação existentes; resolver ambiguidade antes de
   propor alteração. Nunca confiar no modelo para autorização.
2. Registrar canal, fonte, início/fim da janela medida, timezone, data de coleta,
   responsável e evidência opcional. Distinguir total acumulado de incremento.
3. Validar contagens, taxas e relações entre métricas; indisponível é null, não zero.
4. Apresentar revisão estruturada: novos valores, janela, fonte e diferenças em
   relação ao registro anterior. Execução somente por controle explícito do gestor.
5. Identidade do registro inclui ação + canal + fonte + janela + tipo de medida;
   reenvio é idempotente. Correção substitui uma revisão, não soma outro disparo.
   Janelas sobrepostas e relatórios cumulativos precisam de reconciliação antes
   da agregação; conservar histórico de auditoria no PostgreSQL.
6. Exibir atualização e cobertura. Alertas semanais consideram calendário acordado,
   timezone e tolerância; não confundir um canal semanal com uma fonte diária.

Nesta fase, o diálogo permite simular uma revisão sem persistência. Não libera
novas mutações no Hermes. APIs de anúncios ficam para uma fase futura após
definição de acesso, atribuição e disponibilidade; nenhuma conexão é presumida.

## Validação e próxima etapa

Testar filtros e aritmética, ausência de dados, coorte versus fechamento,
validação de relatório, navegação, foco de diálogo, contraste e mobile 320/390 px.
Apresentar a prévia ao responsável. O CRM permanece fora do escopo até aprovação
integral do dashboard; usar este contrato como base para o futuro modelo de dados.
