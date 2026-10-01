# Entrada de leads e resultados por campanha — desenho aprovado

O responsável aprovou em 30/09/2026 a entrada híbrida de dados reais. Fontes
principais: Meta Ads e Google Ads, direcionando a landing pages e WhatsApp;
outras fontes: site, LinkedIn/outros anúncios, e-mail, WhatsApp e prospecção fria
no Google Maps. LinkedIn Ads foi confirmado explicitamente como terceiro provedor.
O CRM completo permanece fora desta entrega. A operação é white label com banco
e aplicativos próprios de cada empresa; o usuário autoriza contas dentro do app.
O fluxo previsto dos conectores está em `docs/integrations/ads-white-label.md`.

## Fluxos

- Cada campanha mantém fontes identificadas e vinculáveis a uma ação existente.
- CSV/Excel de contatos passa por mapeamento, prévia validada no servidor,
  resolução explícita de possíveis duplicados e confirmação antes de gravar.
- Cadastros recebidos por formulário usam uma fonte registrada e ativa. O
  servidor resolve campanha/tenant pela configuração; a landing page não envia
  uma identidade de negócio confiável.
- Links WhatsApp registram cliques separadamente. Sem API da ferramenta,
  contatos recebidos e resultados de disparos continuam sendo importados ou
  informados pelo gestor; clique nunca cria pessoa ou venda.
- Resultados semanais têm fonte, ação opcional, janela, timezone, métricas
  disponíveis e histórico de revisões. Hermes propõe a gravação estruturada;
  o gestor confirma pelo controle de execução existente.

## Semântica

Contatos frios não contam como novos leads captados. Uma pessoa tem origem
inicial preservada e pode participar de várias campanhas sem ser recriada.
Identificador externo reconhece reenvios da mesma fonte; correspondência por
e-mail/telefone é candidata à revisão, não autorização automática para mesclar.
Um lead captado deve ter contato identificável e ocorrência datada. Qualificação
e venda dependem de registros reais; não inferir esses eventos de cliques,
aberturas ou conversões publicitárias agregadas.

Relatórios não criam pessoas. Totais consolidados distinguem contatos únicos,
participações por campanha e métricas agregadas. Fontes indisponíveis são nulas,
nunca zeros fictícios. Janelas sobrepostas exigem correção/reconciliação; revisões
substituem o registro anterior em vez de somar novamente o mesmo disparo.

## Arquitetura e autorização

Reutilizar App API/BFF, Marketing Ops, PostgreSQL com RLS e os planos preparados
existentes. Não introduzir core Hermes, Supabase ou CRM externo. O navegador
autenticado continua falando apenas com a App API. A entrada pública de
formulários passa por uma rota estreita do BFF, valida a fonte e a origem e não
retorna dados de outras pessoas. Tokens de fonte podem ser revogados. Publicação
do endpoint e configuração de landing pages externas na VPS são tarefas do
operador humano; implementação e validação ocorrerão no localhost.

## Experiência

Reutilizar Prometeus e suas abas/componentes. Detalhes de fontes e contatos ficam
na campanha, com importação em diálogo e confirmação explícita. Visão geral
mantém indicadores e gráficos resumidos, agora derivados de dados persistidos.
Exemplos anteriores permanecem identificados e separados das campanhas reais.

## Critérios de aceite

Validar importação/reenvio, possível duplicado, vínculo entre campanhas,
separação dos frios, isolamento entre tenants/participantes, revogação de fonte,
datas/intervalos, relatórios corrigidos e ausentes, execução humana do Hermes,
responsividade, teclado e integração pelo BFF com o banco local.

## Acervo consultado

O Setup foi consultado para recursos de leads. HeyForm (`tool:heyform`) foi
inspecionado como opção de formulário externo; não cobre persistência de
campanhas, revisão e autorização deste produto. Reutilizar os serviços e
componentes existentes para essa lógica, permitindo conectar qualquer landing
page que envie o contrato HTTP documentado. Não instalar outro sistema de CRM ou
formulários nesta entrega.
