# Analytics nativo e conexão Google simplificada

Desenho aprovado pelo responsável: GA4 e Clarity nativos, autorização Google pelo app, aplicativos próprios por instalação e possibilidade de trocar integrações. O site ainda não tem GA4; a coleta real depende da criação da propriedade e instalação da tag pelo responsável.

## Experiência

Configurações → Integrações apresenta conectar, escolher propriedade, atualizar, renovar, trocar e desconectar. O aplicativo Google já preparado para Ads é reutilizado pelo GA4; preparar/trocar o aplicativo fica em uma área avançada de administrador. O fluxo Google não exige que exista uma conta Ads para conectar GA4. O consentimento GA4 solicita apenas `analytics.readonly`. Clarity recebe um token de exportação do projeto em diálogo privado, valida a leitura antes de declarar conexão e nunca devolve o token ao navegador.

Uma página **Análise do site** concentra quatro indicadores e dois gráficos. Detalhes e alertas aparecem sob demanda. A visão geral do marketing continua resumida. Campanhas recebem um painel próprio de navegação atribuído por vínculo explícito do `utm_campaign`; visitas, eventos-chave e cliques não criam leads nem vendas.

## Segurança e dados

Manter BFF, autorização canônica, RLS forçado e instalação por empresa. Separar os provedores `ga4`/`clarity` do contrato Ads. Reutilizar a chave persistente e o aplicativo Google por acesso interno, sem expor segredos. O callback Google existente identifica a intenção por estado opaco vinculado à sessão; não por parâmetro de redirecionamento fornecido pelo navegador. Trocar o aplicativo Google invalida também estados, tokens e trabalhos GA4. Trocar propriedade, token ou desconectar invalida trabalhos anteriores e preserva histórico.

GA4 usa Analytics Admin API e Data API. Importar sessões, sessões engajadas, visualizações e eventos-chave, com datas no fuso da propriedade e avisos de qualidade. Não somar usuários únicos por dia. Leituras completas substituem a mesma janela; erro não significa zero.

Clarity exporta janelas móveis das últimas 24–72 horas, UTC, máximo de 1.000 linhas sem paginação e dez requisições por projeto/dia. Guardar snapshots e mostrar a janela correspondente; nunca somar janelas sobrepostas. Reservar orçamento persistente antes das requisições, inclusive concorrentes, e limitar atualização automática. O rótulo informado do projeto não é prova de identidade externa. Mapas de calor e gravações abrem no Clarity, sem prometer importação de conteúdo indisponível na API.

## Apresentação Prometeus

Paleta e tipografia existentes: #040814, #0652C5, #1A2338, #3B4B6B, #E2E8F0 e branco; Space Grotesk, Geist Mono apenas para detalhes técnicos. Composição alinhada à esquerda, ampla área de leitura, uma linha de indicadores e gráficos com legenda e alternativa tabular acessível. Sem decoração adicional. Diálogos com fundo opaco, foco restaurado, alvos de 44px, estados de carregamento/erro/vazio e layout de 320px a desktop.

## Acervo e referências

Consultado O Setup: `skill:google-analytics` auxilia análise; `tutorial:microsoft-clarity-com-ia` auxilia instalação do rastreador. Nenhum entrega o conector nativo do produto, por isso usar os contratos oficiais sem instalar dependência equivalente.

- [Google Data API](https://developers.google.com/analytics/devguides/reporting/data/v1)
- [Google Analytics Admin API](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list)
- [OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Clarity Data Export API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api)
