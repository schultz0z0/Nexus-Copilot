# Conectores Ads — execução do desenho aprovado

O responsável autorizou seguir em 30/09/2026. O contrato aprovado é
`docs/integrations/ads-white-label.md`: instalação independente, aplicativos
próprios, OAuth no app, seleção de conta, vínculo por ID e dados reais.

## Entrega

- [x] Clientes HTTP oficiais Meta, Google e LinkedIn, OAuth, contas, campanhas,
  métricas diárias e leitura de formulários quando autorizada.
- [x] Persistência local cifrada, estados OAuth de uso único vinculados à sessão,
  versão de conexão e vínculos; autorização admin/manager e RLS por campanha.
- [x] Adapter BFF com destino fixo e sessão obrigatória; callback sem segredos
  no retorno ao frontend ou em logs.
- [x] Tela Integrações e vínculo de anúncios nas campanhas, conforme brandbook.
- [x] Sincronização repetível, histórico e conflitos explícitos; desconexão
  conserva dados e interrompe novas sincronizações.
- [x] Testes, revisão independente, migration local, build e E2E desktop/mobile.

## Contratos de implementação

Marketing Ops mantém dados/tokens/jobs. BFF resolve a sessão e envia apenas uma
assinatura derivada da sessão no header interno `X-ENS-OAuth-Session`; nenhum
header de sessão fornecido pelo navegador é encaminhado. O estado aleatório é
armazenado por hash, expira em 10 minutos e é consumido atomicamente antes de
trocar código por token. Tenant/provedor/ator/sessão são conferidos no retorno.
Google usa PKCE e acesso offline. Aplicativos/versões/scopes são preparados por
configuração operacional; credenciais não são editadas no frontend.

Rotas internas: `/v1/ads-integrations`, `/:provider/authorize`,
`/:provider/callback`, `/:provider/accounts`, `/:provider/account`,
`/:provider/disconnect`; campanha `/v1/campaigns/:id/ads-links`, campanhas
externas em `/:provider/campaigns` e sincronização dos vínculos. O callback
público de navegação é `/api/ads/oauth/:provider/callback`; o BFF devolve um
redirect fixo para `/settings/integrations` com um código de resultado seguro.

Cada vínculo contém conta/campanha externas, fonte da campanha e destino.
Métricas diárias declaram moeda e fuso; conversões dos provedores são distintas
de vendas. Resultados em moeda diferente de BRL não são somados aos KPIs em reais.
Não sobrescrever relatórios manuais sobrepostos. Capturas externas passam pelo
mesmo contrato de identidade e revisão; não inventar pessoas a partir de métricas.
Uma conexão sem permissão para formulários exibe acesso parcial.

## Verificação e preparação

Testes usam HTTP injetado e banco isolado, sem credenciais reais. Aplicativos
ausentes deixam a integração não preparada; nenhum sucesso fictício. Validar com
contas autorizadas será necessário antes de declarar conexão externa ativa.
VPS permanece operada exclusivamente pelo humano.

Consulta O Setup repetida: OAuth e Ads; Posta inspecionado, cobre publicação em
redes pelo serviço próprio, não OAuth Ads por instalação. Reutilizar BFF,
Marketing Ops, PostgreSQL, componentes e bibliotecas existentes.

### Evidência do backend

Revisões independentes de especificação e qualidade aprovadas. O gate isolado
verificou migrations 0001–0020 e replay: 370 testes passaram, dois testes antigos
de integração permaneceram ignorados. TypeScript passou; App API: 100 testes
passaram. A migration 0020 foi aplicada ao banco de avaliação local em 30/09/2026.

Regressões cobrem permissão apenas para leads, erro de formulário que preserva
métricas, fontes pausadas que não bloqueiam a fila e medições retiradas de uma
janela completa que conservam histórico sem afetar relatórios manuais.

A verificação final foi executada com um worker no banco isolado para evitar
concorrência com as verificações do frontend nesta máquina. Também cobre o
último milissegundo do dia final dos formulários do LinkedIn, sem incluir o dia
seguinte.

### Evidência do frontend e ambiente local

Revisões finais de especificação e qualidade integrada aprovadas. A execução
independente verificou 51 arquivos e 250 testes do frontend, TypeScript da
aplicação e lint sem erros (dez avisos preexistentes). Sete testes de navegador
com provedores simulados passaram em desktop/mobile: seleção/versionamento,
vínculo, retry com a mesma proposta, revisão humana, reabertura do recibo já
confirmado, desconexão, foco, controles de 44 px e tabela com rolagem interna.
As verificações axe das telas e diálogos alterados não encontraram violações.

As imagens App API, Marketing Ops e Chat Web foram construídas e atualizadas
somente no Docker local. Nginx validado; cinco endpoints de saúde responderam
200. Três testes adicionais pelo BFF real de `http://127.0.0.1:8088` verificaram
Integrações desktop/mobile e carregamento de Campanhas/Produção. O probe real
confirmou os três provedores não preparados, DTO sem segredos e callback
vinculado à sessão. A API de aplicação passou novamente em seus 100 testes.

Nenhuma conta externa foi autorizada nesta avaliação: os aplicativos próprios
da empresa ainda precisam do preparo descrito em `docs/integrations/ads-installation.md`.
O teste simulado não equivale a conexão ativa com Meta, Google ou LinkedIn.
Nenhuma operação ou implantação ocorreu na VPS.
