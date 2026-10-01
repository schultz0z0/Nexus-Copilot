# Conexões Ads em instalações white label

Decisão confirmada pelo responsável em 30/09/2026: cada empresa recebe uma
instalação independente da plataforma, banco de dados próprio e aplicativos
próprios nos provedores. Meta Ads, Google Ads e LinkedIn Ads fazem parte do mesmo
escopo de conexão. Não há aplicativo central da Prometeus compartilhando tokens
entre clientes.

Este documento define o contrato dos conectores implementados nesta etapa. O
preparo operacional está em `ads-installation.md`; captação por formulário,
importação revisada e relatórios manuais continuam em `campaign-acquisition.md`.
Cadastrar uma fonte não estabelece uma conexão OAuth e não dá acesso à conta de
anúncios. A validação externa requer o aplicativo e uma conta autorizada da empresa.

## Experiência do usuário

Em Configurações → Integrações, exibir os três provedores. Cada cartão apresenta
o estado da conexão, conta selecionada, capacidades disponíveis e a última
sincronização. Usar componentes e tokens do brandbook; detalhes técnicos ficam
na preparação da instalação.

1. Na primeira utilização, o administrador abre **Configurar aplicativo** no
   provedor, cadastra as credenciais da empresa e copia a URL de retorno para o
   painel oficial. Revisa e salva; preparar o aplicativo não conecta uma conta.
   Depois, o usuário autorizado clica em **Conectar Meta Ads**, **Conectar Google Ads**
   ou **Conectar LinkedIn Ads**.
2. O provedor abre sua própria página de autorização. A plataforma não solicita
   a senha do provedor. Após consentir, o usuário retorna ao app.
3. O app lista as contas acessíveis por nome. O usuário seleciona a conta de
   anúncios; IDs ficam como informação de apoio, sem exigir que sejam copiados.
4. Em cada campanha, **Vincular anúncios** lista as campanhas externas da conta.
   O usuário escolhe uma ou mais e o destino: formulário nativo, landing page
   ou WhatsApp. Confirmar o vínculo antes de iniciar a importação.
5. A campanha mostra a última atualização e permite consultar os registros
   recebidos, repetir a sincronização e resolver atribuições pendentes.

“Um clique” é o ponto de entrada no app. A autorização obrigatória do provedor
e a seleção entre várias contas não podem ser eliminadas. Nas próximas visitas,
a conta e os vínculos já escolhidos são reutilizados enquanto o acesso continuar
válido.

Estados que a interface deve distinguir:

| Estado | Informação e ação principal |
| --- | --- |
| Não preparado | Administrador: “Configurar aplicativo”; demais usuários: solicitar preparo ao administrador |
| Pronto para conectar | “Conectar …” |
| Autorização cancelada | Explicar que o acesso não foi concedido e permitir tentar novamente |
| Seleção pendente | “Escolher conta de anúncios” |
| Conectado | Conta, capacidades, última atualização e “Gerenciar conexão” |
| Acesso parcial | Indicar exatamente o que está disponível e o que depende de permissão |
| Autorização expirada/revogada | “Reconectar”; preservar dados já recebidos |
| Sincronização com falha | Última atualização válida, mensagem útil e nova tentativa |
| Desconectado | Parar novas sincronizações e preservar os resultados históricos |

Não mostrar “Conectado” apenas porque existem client IDs, uma fonte de captação
ou um redirect cadastrado. Esse estado exige autorização válida, conta escolhida
e uma leitura de validação no provedor. Conexão sem dados ainda é diferente de
resultado zero.

## Preparo de cada instalação

O operador prepara domínio HTTPS e persistência privada. O administrador pode
cadastrar o aplicativo da empresa pelo próprio app: client ID, segredo, versão,
permissões e campos específicos. A URL de retorno é gerada pela configuração
confiável do servidor, sem edição pelo navegador. O cadastro exige permissões
aprovadas no provedor; não elimina a criação e aprovação do aplicativo externo.
Configuração operacional por arquivos continua disponível. Assumir a gestão de
um aplicativo externo pelo app exige confirmação e novos segredos, sem alterar
os arquivos readonly existentes. O usuário diário autoriza e seleciona contas.
Não pedir tokens, client secrets ou chaves no chat do Hermes.

O administrador pode editar ou trocar o aplicativo. Um segredo em branco conserva
o já cadastrado quando o aplicativo é gerenciado pelo app. Antes da troca, a
interface explica a necessidade de nova autorização. Salvar uma configuração
nova invalida os estados OAuth, tokens e trabalhos da configuração anterior,
preservando leads e relatórios históricos. Trocar a conta de anúncios é uma ação
separada, disponível no gerenciamento da conexão para administrador e gestor.

As exigências dos provedores precisam ser conferidas novamente ao implementar
e instalar o conector, pois acesso e versões mudam:

- Google: projeto Cloud da empresa com Google Ads API e acesso apropriado,
  cliente OAuth de aplicação web e consentimento. A documentação atual registra
  que o acesso passou a ser determinado pelo projeto Cloud e que os developer
  tokens foram descontinuados em setembro de 2026; não basear o instalador em
  tutoriais antigos que tornam esse token obrigatório.
  [Autenticação Google Ads, atualizada em 29/09/2026](https://developers.google.com/google-ads/api/docs/client-libs/php/authentication).
- LinkedIn: aplicativo da empresa, autorização OAuth e acesso ao produto
  Advertising API. Para importar respostas de formulários, também é necessário
  acesso ao produto Lead Sync. Aprovação para anúncios não implica aprovação
  para leads. Verificar os escopos e papéis exigidos por cada capacidade.
  [OAuth](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow),
  [Advertising API](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/ads-overview?view=li-lms-2026-08),
  [Lead Sync](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/getting-access-leadsync?view=li-lms-2026-04).
- Meta: preparar aplicativo próprio e verificar, na implantação, o fluxo Login
  for Business, acesso às contas/Páginas, revisão do app e permissões de leitura
  de métricas e de leads. A página oficial de recuperação de leads retornou
  HTTP 429 durante esta consulta; a lista definitiva de permissões e versões
  ainda precisa de validação na documentação e no aplicativo da empresa.
  [Referência oficial de recuperação de leads](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/).

## Fronteiras e persistência

Preservar Browser → App API/BFF → Marketing Ops → PostgreSQL. A comunicação com
o provedor é feita no servidor. Hermes pode consultar o estado e preparar
propostas; não recebe tokens e não resolve autorização de negócio.

O fluxo OAuth deve ter estado aleatório, expirável e de uso único, vinculado à
sessão/ator, instalação e provedor. Usar PKCE quando suportado; verificar o
retorno e consumir o estado atomicamente. Destinos de retorno são definidos pelo
servidor e não por uma URL arbitrária fornecida ao iniciar a conexão.

Credenciais do aplicativo pertencem à instalação. Tokens concedidos pertencem
à conexão local, ficam cifrados com chave própria da instalação e nunca são
devolvidos pela API, incluídos em planos do modelo, logs, fixtures ou bundles.
Registrar apenas metadados de acesso, expiração, capacidades e auditoria de
conectar/selecionar/reconectar/desconectar. Restringir essas ações ao administrador
ou papel explicitamente autorizado pela aplicação.

Identificadores externos precisam incluir provedor, conta e ID externo. Não
associar campanhas pelo nome. Jobs e callbacks resolvem instalação e campanha
por vínculos persistidos; parâmetros recebidos de terceiros não escolhem tenant.
Esta entrega lê as APIs por sincronização periódica e manual; não recebe webhooks
dos provedores. Jobs possuem registro durável, retentativa e proteção contra replay.
Uma reinstalação não reutiliza segredos ou sessões de outra empresa. O callback
OAuth autoriza a conexão; a atribuição à campanha exige o vínculo explícito escolhido
no app. Desconectar interrompe novas leituras, sem remover leads e relatórios históricos.

## O que cada conexão pode enriquecer

| Caminho | Dados esperados | Limite de interpretação |
| --- | --- | --- |
| Métricas de anúncios | Investimento, impressões, cliques e conversões reportadas | Conversões do provedor não criam pessoas nem confirmam vendas |
| Formulário nativo | Contato identificado e IDs do formulário/anúncio, se autorizados | Usa as mesmas regras de identidade, origem e revisão da importação |
| Landing page própria | Captura pelo endpoint da fonte e UTMs | OAuth não substitui a instrumentação do formulário |
| Anúncio para WhatsApp | Clique e atribuição disponível | Conta de anúncios não dá acesso às mensagens ou identifica todas as conversas |
| E-mail/WhatsApp sem API | Importação e relatório semanal revisado | Continua disponível como caminho manual |
| Google Maps | Contato prospectado classificado como frio | Não conta como lead captado até existir interação registrada |

Resultados sincronizados precisam declarar fonte, período, fuso e moeda. Não
somar exportação manual e sincronização automática da mesma janela: mostrar o
conflito e definir explicitamente qual registro será substituído. Preservar
histórico de revisão e identificador externo para replay. Backfill tem janela
explícita e respeita limites de retenção do provedor; não prometer todo o passado.

A rotina periódica relê os sete dias encerrados no fuso da conta, a cada quinze
minutos por padrão; a sincronização manual aceita até trinta dias, sem datas futuras.
Formulários geram prévias de até quinhentos contatos para confirmação humana.
Uma leitura incompleta ou sem permissão deve produzir aviso, conservando a última
medição válida. Quando uma janela completa deixa de incluir uma medição anterior,
ela sai dos indicadores vigentes e permanece no histórico; ausência não vira zero.

## Critérios de validação dos conectores

- Autorização completa, cancelada, expirada, replay do retorno e sessão trocada.
- Conta sem acesso, várias contas, acesso parcial e mudança de permissão.
- Aplicativo não preparado oferece cadastro ao administrador e orientação aos
  demais papéis; salvar não simula uma autorização externa.
- Salvar, reler e reiniciar conservam a configuração privada. Trocar aplicativo
  invalida retornos e operações antigas; repetir a mesma requisição não repete a troca.
- Token nunca aparece em DTO, URL de navegação interna, log ou proposta Hermes.
- Duas instalações não compartilham aplicativos, chaves, tokens ou banco.
- Retentativa e leitura repetida não duplicam pessoas ou métricas.
- Desconectar para novas sincronizações; reconectar conserva os vínculos válidos.
- Testar com conta autorizada de cada provedor antes de declarar integração ativa.
- Em produção, o operador humano executa preparo/deploy. Impacto, condição de
  parada e rollback devem acompanhar o plano operacional concreto do conector.

## Consulta ao acervo O Setup

Consultados `search_resources` (Ads, Google Ads, LinkedIn e OAuth),
`recommend_for_project` e o detalhe de `plugin:posta-skill`. Posta cobre
publicação e métricas de redes sociais por conta própria do serviço; não atende
ao conector de contas Ads da instalação white label. O resultado OAuth do
Hermes trata Gmail/Calendar, não anúncios. Não foi encontrado um conector
adequado no acervo consultado. O desenho reaproveita BFF, Marketing Ops,
PostgreSQL e componentes da plataforma; nenhuma nova ferramenta ou plugin foi
instalada.

Na etapa de cadastro pelo app, `search_resources` foi consultado novamente para
OAuth e armazenamento de segredos. O recurso OAuth encontrado atende Gmail e
Calendar; o recurso de segurança encontrado é uma auditoria, não um conector.
O cadastro reaproveita as rotas do BFF e os serviços existentes, sem nova
dependência externa.
