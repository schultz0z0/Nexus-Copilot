# Preparo dos conectores Ads por instalação

O operador prepara domínio e persistência privada; o administrador cadastra o
aplicativo em **Configurações → Integrações → Configurar aplicativo**. Depois,
o usuário autoriza o provedor e escolhe uma conta pelo nome. A plataforma usa
os aplicativos daquela empresa. Também é possível manter o preparo operacional
por arquivos descrito abaixo.
Não pedir senha do provedor, token ou client secret no Hermes ou no chat.

## Cadastro pelo app

1. Crie o aplicativo da empresa no painel oficial do provedor e obtenha acesso
   aos produtos necessários. O Prometeus não cria nem aprova aplicativos externos.
2. Como administrador, abra **Configurar aplicativo** no provedor escolhido.
   Informe client ID e segredo. Meta exige também o ID de configuração do Login
   for Business. Confira versão da API e permissões necessárias.
3. Copie a URL de retorno mostrada pelo app e cadastre-a exatamente no provedor.
   A origem pertence à instalação e não pode ser alterada no formulário.
4. Revise e salve. O cartão fica pronto para autorização; isso ainda não significa
   acesso a uma conta de anúncios. Continue com **Continuar e autorizar**; se concluir depois, use **Conectar** no cartão.
5. Autorize no painel do provedor e escolha a conta pelo nome no Prometeus.
   Confira moeda, fuso e capacidades antes de vincular campanhas.

O segredo nunca é devolvido pela leitura do cadastro. Ao reabrir, o campo fica
vazio e a interface informa que existe um segredo cadastrado. Deixá-lo vazio
conserva o existente somente para configurações já gerenciadas pelo app.

**Editar / trocar aplicativo** permite atualizar as credenciais, versão e permissões.
Revise a confirmação: salvar uma nova configuração exige nova autorização e
interrompe trabalhos da configuração anterior. O histórico permanece. Para
assumir pelo app uma configuração operacional externa, confirme a mudança e
informe o segredo novamente; os arquivos externos não são sobrescritos.

**Trocar conta** é uma ação distinta no cartão conectado. Administrador e gestor
podem escolher outra conta autorizada. Os vínculos usam IDs de conta; revise os
vínculos da campanha antes de retomar leituras da conta nova.

## Configuração operacional

O cadastro pelo app usa `/app/data/ads` no serviço Marketing Ops, montado no
volume `ads-setup-data`. O nome padrão acompanha o projeto Compose
(`{COMPOSE_PROJECT_NAME}-ads-setup-data`); `ADS_SETUP_VOLUME_NAME` permite uma
substituição explícita. Cada instalação deve ter seu próprio volume. O processo
Node possui acesso ao diretório; arquivos são privados e as credenciais ficam
cifradas. PostgreSQL publica apenas a referência do arquivo e a versão, com
recibo seguro para retentativas. Um arquivo candidato sem publicação no banco
não se torna configuração ativa.

Sem uma chave operacional, a instalação nova cria uma chave aleatória própria
no volume. A chave é preservada em reinícios. Se já existem referências cifradas
no banco e a chave está ausente, o serviço interrompe o preparo em vez de criar
uma chave incompatível. Uma chave operacional existente continua sendo usada.

O backup precisa conservar **banco, volume privado e chave** como um conjunto
consistente. Para obter uma cópia consistente, o operador suspende alterações e
leituras dos conectores durante a cópia e valida a restauração em ambiente
isolado. Não usar `docker compose down -v` como reinício: remover o volume perde
os arquivos e a chave. Não copiar o volume de outra empresa nem restaurar apenas
o banco sobre um volume vazio.

Use a origem pública real em `ADS_PUBLIC_ORIGIN`, sem caminho, query ou fragmento.
HTTPS é obrigatório, com exceção de `http://127.0.0.1:8088` ou localhost no
desenvolvimento. Cadastre o retorno exato no aplicativo correspondente:

| Provedor | URL de retorno |
| --- | --- |
| Google | `{ADS_PUBLIC_ORIGIN}/api/ads/oauth/google/callback` |
| Meta | `{ADS_PUBLIC_ORIGIN}/api/ads/oauth/meta/callback` |
| LinkedIn | `{ADS_PUBLIC_ORIGIN}/api/ads/oauth/linkedin/callback` |

Ao alterar o domínio da instalação, cadastre as novas URLs no provedor e reinicie
o serviço com a origem correta. O callback do cadastro gerenciado é derivado da
origem atual, também usada na autorização. Sem origem válida, o aplicativo não
fica pronto para autorizar, mesmo quando suas credenciais foram preservadas.

No modo operacional externo, IDs, versões e permissões ficam na configuração
local não versionada do Compose.
Segredos ficam em um diretório privado **fora do repositório**, com leitura somente
pelo operador e pelo processo do serviço. Use o overlay `infra/app/compose.ads.yaml`
e defina `ADS_SECRETS_DIR` como o caminho absoluto desse diretório. O overlay não
cria o diretório nem exige aplicativos de todos os provedores.

| Arquivo privado | Conteúdo |
| --- | --- |
| `token_encryption_key` | 32 bytes aleatórios próprios desta instalação, em base64 canônico ou 64 caracteres hexadecimais |
| `google_client_secret` | Segredo do cliente OAuth web Google |
| `meta_client_secret` | Segredo do app Meta |
| `linkedin_client_secret` | Segredo do app LinkedIn |

Arquivos de provedores não utilizados podem ficar ausentes. A chave de cifra deve
ter backup privado junto à política de recuperação da instalação: perder ou
trocar essa chave sem migração impede ler tokens existentes. Não reutilizar
chaves de cookie, BFF, Hermes ou outra empresa.

| Variável | Uso |
| --- | --- |
| `ADS_GOOGLE_CLIENT_ID` / `ADS_GOOGLE_API_VERSION` | Cliente OAuth web e versão suportada, por exemplo `v25` na referência consultada |
| `ADS_GOOGLE_SCOPES` | `https://www.googleapis.com/auth/adwords` |
| `ADS_GOOGLE_LOGIN_CUSTOMER_ID` | Opcional: ID de conta gestora, dez dígitos; o seletor também descobre contas filhas de gestores |
| `ADS_META_CLIENT_ID` / `ADS_META_API_VERSION` | App da empresa e versão suportada, no formato `vXX.0` |
| `ADS_META_LOGIN_CONFIG_ID` | Configuração do Facebook Login for Business; obrigatória para habilitar o conector |
| `ADS_META_SCOPES` | Leitura: `ads_read`; para formulários também preparar `leads_retrieval` e acesso às Páginas/contas na configuração Business |
| `ADS_LINKEDIN_CLIENT_ID` / `ADS_LINKEDIN_API_VERSION` | App da empresa e versão suportada `YYYYMM` |
| `ADS_LINKEDIN_SCOPES` | `r_ads r_ads_reporting`; adicionar `r_marketing_leadgen_automation` quando Lead Sync estiver aprovado |

Sem app, versão, origem pública ou chave/segredo, o cartão permanece **Aguardando
configuração**, com o botão de cadastro para o administrador. Um ID preenchido
não equivale a uma conexão válida. Confira o suporte das versões no preparo e
nas atualizações de cada instalação, mesmo quando o formulário sugere um valor.

O processo Node também aceita os segredos pelos respectivos `*_FILE`, para outros
gestores de secrets. Compose usa somente arquivos montados; não coloque segredos
no frontend, nos exemplos versionados ou na saída de `docker compose config`.

## Aprovação e limitações dos provedores

- Google: habilitar Google Ads API no projeto Cloud, preparar consentimento e
  cliente OAuth web; validar acesso à API. O acesso passou a ser determinado pelo
  projeto Cloud e os developer tokens foram descontinuados em setembro de 2026.
  [Política atual de acesso](https://developers.google.com/google-ads/api/docs/api-policy/developer-token),
  [OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server).
- LinkedIn: Advertising API e Lead Sync são produtos distintos. Acesso ao primeiro
  não concede o segundo; papéis na conta e Página também são necessários. Uma
  autorização sem Lead Sync continua válida para métricas disponíveis.
  [Lead Sync e permissões](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/leadsync?view=li-lms-2026-08).
- Meta: Facebook Login for Business, permissões aprovadas e acesso aos ativos da
  empresa são necessários. Conferir revisão do app, Page Leads Access e versão no
  painel da empresa. Tokens de longa duração podem exigir reconexão, pois não há
  refresh token OAuth convencional para esse fluxo.
  [Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/),
  [Recuperação de leads](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/).

O ambiente atual não dispõe das credenciais/contas desses aplicativos. Testes
automatizados usam respostas HTTP simuladas e banco isolado. Antes de declarar
uma conexão externa ativa, validar o fluxo real com uma conta autorizada de cada
provedor, inclusive cancelamento, revogação, moeda, fuso e leitura de formulário.

## Dados e operação

Os resultados mantêm data, moeda e fuso do provedor. Conversões informadas pelos
anúncios são mostradas separadas de vendas; métricas não criam pessoas. Valores
em outra moeda ficam disponíveis no detalhe sem somar reais nos KPIs. A Meta
mantém conversões ausentes quando não há interpretação validada do evento.

O vínculo com uma campanha é feito por IDs externos, fonte e destino explícitos.
Sincronizações periódicas releem os sete dias encerrados no fuso da conta, a cada
quinze minutos por padrão; a janela manual é de no máximo trinta dias, sem datas
futuras. Fontes desativadas deixam a fila. Formulários nativos geram prévias de
até quinhentos contatos por lote; só a confirmação humana
importa os contatos identificados. Landing pages próprias continuam usando o
endpoint da fonte. Ads para WhatsApp não dão acesso ao conteúdo das mensagens.

Um relatório manual sobreposto permanece intacto e a sincronização sinaliza
revisão. A desconexão para novas leituras e conserva relatórios/leads históricos.
Reconectar ou trocar a conta invalida operações em andamento por versão; nunca
aplicar dados de uma autorização anterior na conta nova.

Permissões de métricas e de formulários são avaliadas separadamente. Um formulário
indisponível pode exigir revisão sem impedir leituras de outras campanhas. Erros,
limites de paginação e acesso parcial aparecem nos comprovantes da sincronização;
uma falha de leitura não substitui dados válidos por zeros. Uma janela completa que
deixa de incluir uma medição anterior retira essa medição dos indicadores vigentes
e mantém seus valores e revisões no histórico. Relatórios manuais continuam intactos.

## Aplicação em produção pelo operador humano

O agente não acessa nem opera a VPS. O operador prepara backup do banco e dos
segredos, valida a migration e a imagem em homologação e executa a atualização.
O comando concreto deve usar os arquivos de Compose, domínio e versões aprovados
para aquela instalação; não copiar a configuração de localhost para produção.

**Impacto:** migration aditiva e novas leituras externas; reinício dos serviços
App API, Marketing Ops e frontend. **Resultado esperado:** saúde dos serviços,
cartões coerentes e consentimento seguido de conta validada. **Parada:** erro de
migration, readiness, vazamento de segredo, conta incorreta ou repetição de
métricas; interromper o avanço e conservar evidência redigida. **Rollback:**
desconectar os vínculos e restaurar as imagens anteriores, mantendo as tabelas
aditivas. Não remover histórico ou chaves durante rollback; restauração de banco
somente pelo operador conforme backup e retenção acordados.
