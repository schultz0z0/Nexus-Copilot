# Google Workspace e Microsoft 365 no marketing

O Prometeus mantém oito conexões independentes: Drive, Gmail, Google Calendar,
Sheets, Search Console, arquivos Microsoft (OneDrive/SharePoint), Outlook e
calendário Outlook. Cada instalação usa os aplicativos da própria empresa.
Autorização, recurso selecionado e permissões são estados distintos.

## Experiência de uso

O administrador prepara Google e Microsoft em Configurações → Integrações.
O gestor conecta cada serviço necessário, autoriza no provedor e escolhe o
recurso pelo nome. Trocar conta, trocar recurso e desconectar permanecem
disponíveis. Substituições conservam histórico e exigem confirmação.

- Arquivos: escolher **Meu Drive inteiro** ou uma pasta/biblioteca e vincular materiais às campanhas. O
  documento continua no provedor; um vínculo não duplica o arquivo no banco.
  A raiz do Meu Drive permite consultar arquivos e navegar por todas as pastas
  aninhadas, com caminho clicável, busca e paginação. OneDrive/SharePoint usam
  a mesma navegação por níveis dentro da biblioteca escolhida. Drives
  compartilhados separados não são listados como raízes neste seletor.
- E-mail: consultar mensagens, vincular a uma campanha e preparar um rascunho
  editável. Envio exige revisão e confirmação explícita. Aceitação pela API não
  comprova entrega ao destinatário. Esta conexão não substitui uma plataforma
  de disparos e não produz métricas fictícias de abertura ou conversão.
- Calendário: consultar uma janela e publicar um compromisso revisado no
  calendário escolhido. Datas e fusos são explícitos; publicação não significa
  que uma ação de marketing foi executada. O calendário operacional do Prometeus
  continua sendo a autoridade do planejamento.
- Sheets: escolher **Todas as planilhas** ou uma planilha inicial. A biblioteca
  permite buscar, paginar e abrir outras planilhas acessíveis sem substituir
  a conta ou o recurso salvo. Cada abertura é validada pelo servidor e mantém
  o isolamento da instalação. Ler uma prévia limitada e mapear os valores para
  os fluxos de importação/revisão existentes. Dados externos não criam contatos
  nem substituem resultados de campanha sem confirmação.
- Search Console: consultar cliques, impressões, CTR e posição média por dia,
  página e pesquisa. Métricas são orgânicas do site, não leads identificados ou
  vendas. Os detalhes podem representar apenas as principais linhas da API;
  seus totais vêm de uma consulta agregada independente.

## Uso prático para o analista

| Momento do trabalho | Integrações e benefício | Ação explícita no Prometeus |
| --- | --- | --- |
| Preparar uma campanha | Drive/OneDrive/SharePoint reúnem briefing, criativos, apresentações e documentos | Navegar e vincular os originais à campanha, sem duplicar arquivos |
| Atualizar contatos e resultados | Sheets reduz exportações CSV recorrentes e permite revisar listas ou relatórios do fornecedor | Abrir uma planilha, mapear colunas e confirmar importação/revisão; nada entra automaticamente |
| Coordenar execução | Google/Outlook Calendar ajudam a consultar agenda e marcar revisão de materiais ou entregas | Revisar calendário, data e fuso antes de publicar um compromisso |
| Acompanhar relacionamento | Gmail/Outlook permitem consultar conversas e preparar uma comunicação individual no contexto da campanha | Vincular a mensagem, revisar rascunho e confirmar envio separadamente |
| Investigar aquisição | Ads medem divulgação paga; Search Console mostra visibilidade e cliques da busca orgânica | Conectar/selecionar contas ou propriedade, atualizar leituras e analisar o mesmo período |
| Investigar navegação | GA4 mostra tráfego/eventos e Clarity sinais de fricção | Consultar resultados do site e vínculos UTM explícitos; gravações/mapas de calor permanecem no Clarity |

Exemplo: o analista abre a campanha, vincula o briefing e criativos, consulta
uma planilha de contatos e confirma a importação revisada. Depois organiza um
compromisso de revisão e registra o relatório semanal de e-mail/WhatsApp.
Ao analisar resultados, compara os indicadores comerciais registrados com as
leituras de mídia e navegação. Uma visita, clique ou evento de navegação não
prova qualificação ou venda. Gmail não mede disparos de uma plataforma externa;
esses relatórios continuam sendo importados/registrados com revisão humana.

Hermes pode consultar o contexto autorizado e os vínculos preparados; não lê
automaticamente todo o Drive ou caixa postal, nem envia/publica por conta própria.
Navegação entre planilhas não substitui o recurso salvo nem invalida histórico.
Calendários e caixas de e-mail continuam com destino selecionado para tornar
inequívoco onde uma publicação/envio ocorrerá.

## Limites da entrega

Arquivos são consultados como metadados e abertos no provedor original. O correio
mostra as 20 mensagens recentes e trabalha com texto simples, sem anexos. A
consulta de calendário retorna até 100 compromissos por janela. Sheets lê a
primeira aba, com até 500 linhas de dados e 52 colunas; o app informa truncamento
antes da importação. Search Console usa dados finalizados de pesquisa Web e
até 100 páginas e consultas principais; pesquisas anonimizadas podem ser
omitidas pelo Google. Os totais vêm de uma consulta agregada independente.
Estes conectores não prometem copiar arquivos, importar todo o histórico de
e-mail ou sincronizar alterações do calendário em ambas as direções.
As consultas pelo app usam janelas de até 93 dias.

## Preparo Google

1. No projeto Google Cloud da empresa, habilite Drive API, Gmail API, Google
   Calendar API, Google Sheets API e Search Console API conforme os serviços
   que serão usados. Analytics e Ads continuam com seu preparo independente.
2. Use um cliente OAuth do tipo Aplicativo da Web. A instalação pode aproveitar
   o cliente Google já preparado no servidor para Ads/GA4 sem devolver o segredo
   ao navegador. Também pode preparar um cliente próprio para Workspace.
3. Copie o retorno mostrado no app e adicione-o ao cliente OAuth:
   `{ORIGEM}/api/workspace/oauth/google/callback`. Não remova o retorno existente
   de Ads/GA4. Localhost: `http://127.0.0.1:8088/api/workspace/oauth/google/callback`.
4. Prepare consentimento e permissões por serviço. Aplicativos internos servem
   aos usuários da organização Workspace; uso externo pode exigir processos
   adicionais do Google. Não confundir o domínio comercial com uma organização
   Workspace validada ou assumir que habilitar uma API concede acesso aos dados.
5. No Prometeus, salve somente pelo formulário privado e autorize cada serviço.
   Escolha uma pasta, caixa, calendário, planilha ou propriedade realmente
   acessível à conta escolhida. Uma lista vazia informa ausência de recursos;
   não é substituída por exemplos.

O catálogo de permissões em execução é `workspaceScopes` no adaptador. Drive
usa leitura para permitir navegação pelo servidor. Sheets solicita leitura de
planilhas e descoberta de arquivos. Gmail solicita leitura e composição;
calendário permite leitura/publicação; Search Console usa `webmasters.readonly`.
Identificação Google e renovação offline acompanham as autorizações. O app
nunca pede a senha da conta Google.

Fontes primárias: [OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server),
[Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes),
[Search Console](https://developers.google.com/webmaster-tools/v1/searchanalytics/query).

## Preparo Microsoft

1. Registre o aplicativo da empresa no Microsoft Entra ID. Para uma instalação
   empresarial, use o diretório daquela empresa e o tipo de conta compatível
   com esse diretório.
2. Prepare uma plataforma Web e copie o retorno fornecido no app:
   `{ORIGEM}/api/workspace/oauth/microsoft/callback`.
3. Cadastre Application/client ID, Directory/tenant ID e o **valor** do segredo
   no formulário privado do Prometeus. O ID do segredo não substitui seu valor.
4. Configure permissões delegadas do Microsoft Graph para os serviços usados.
   Arquivos usa `Files.Read.All` e `Sites.Read.All` para OneDrive/SharePoint;
   correio usa `Mail.ReadWrite` e `Mail.Send`; calendário usa
   `Calendars.ReadWrite`. Identidade e renovação offline acompanham o OAuth.
   A política da organização pode exigir consentimento do administrador.
5. Autorize com uma conta empresarial com acesso aos arquivos, caixa e
   calendários desejados. Escolha o recurso pelo app. Uma conta sem licença ou
   sem acesso ao serviço deve receber orientação, nunca conexão fictícia.

O servidor usa Microsoft Graph **REST**, como API do provedor. Isso não introduz
o Graph MCP proibido pela arquitetura do projeto.
Fontes: [registro Entra](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
e [permissões Graph](https://learn.microsoft.com/en-us/graph/permissions-reference).

## Contrato técnico

- Browser → BFF → Marketing Ops → API oficial. Tokens são cifrados no servidor
  com a chave persistente da instalação; segredos de aplicativos ficam em
  arquivos privados com publicação no banco. GETs nunca devolvem segredos.
- A migração `0023_marketing_ops_workspace_integrations.sql` aplica RLS forçado.
  O ator e o tenant vêm da aplicação; administrar aplicativos exige admin,
  operar as conexões exige gestor/admin com papel canônico vigente.
- OAuth tem PKCE, estado opaco de uso único, prazo, versão do aplicativo,
  geração da conexão e vínculo à sessão. O callback não aceita redirecionamento
  arbitrário nem reflete códigos, tokens ou respostas privadas do provedor.
- Configurações e recursos têm controle de versão. Trocar/desconectar invalida
  estados e operações anteriores. Uma resposta atrasada não publica dados de
  uma conta que já foi substituída. Tokens de renovação rotacionados são
  preservados com a mesma proteção.
- Escritas externas têm reserva durável e recibo. E-mail com resposta incerta
  não é reenviado automaticamente. O operador confere a caixa no provedor antes
  de decidir a próxima ação. Calendários usam identificadores de deduplicação.
  Antes de enviar, o servidor confere destinatários, assunto e texto do rascunho
  e sua revisão no provedor. Alterações externas bloqueiam o envio e exigem nova
  revisão. Gmail envia o MIME aprovado junto da chamada de envio; Outlook usa
  uma conferência imediatamente anterior ao envio, sem garantir atomicidade
  contra uma edição externa ocorrida entre essas duas chamadas.
- Vínculos guardam a geração da conexão de origem. Após troca ou desconexão,
  permanecem no histórico, mas não dão ao Hermes acesso à nova conta. Um novo
  vínculo deve ser escolhido e revisado na conexão atual.
- Paginação, tamanho de resposta, janela e quantidade de linhas são limitados.
  Nenhuma URL fornecida pelo navegador define uma origem de chamada externa.
  Falha não apaga snapshots anteriores nem significa resultado zero.
- Arquivos e mensagens são referências externas; conteúdo é não confiável.
  O Hermes só recebe contexto explicitamente vinculado à campanha pela
  ferramenta de leitura `marketing_ops_get_workspace_context_v1`, sob delegação
  e papel canônico. Ele não recebe OAuth, não envia e-mails nem publica eventos.

MCPs do Codex ou skills bundled do Hermes não equivalem a um conector nativo
ativo no produto. O acervo O Setup foi consultado: Google Workspace MCP e
email-inbox-triage servem como referências. A entrega usa adaptadores nativos
porque precisa de autorização empresarial, isolamento, recibos e interface
controlados pelo Prometeus.

## Operação e validação

Conservar banco, volume privado e chave como conjunto consistente no backup.
Nunca apagar volumes para atualizar. Aplicar migrações antes de iniciar o
backend correspondente. Perder a chave com referências existentes interrompe
o preparo em vez de gerar uma chave incompatível. O operador humano continua
sendo responsável por qualquer alteração na VPS.

Teste automatizado com respostas simuladas comprova contratos locais, não uma
conta externa ativa. Validar cada serviço com identidade autorizada e leitura
real; envio/publicação exigem um teste humano deliberado com destinatário e
calendário de teste. Não enviar segredos no chat ou anexar callbacks completos.

Checklist: `docs/testing/workspace-marketing-quick-test.md`.

Validação local desta entrega: 515 testes de Marketing Ops com PostgreSQL
isolado, 303 testes do frontend (execução sequencial), 114 do BFF, 24 do
migrador e 15 de integração PostgreSQL passaram. Builds passaram. O Docker
local recebeu a migração 0023; leitura dos oito estados, navegação de campanha
e larguras 320/390/768 foram verificadas, preservando GA4 e Clarity conectados.
Esses resultados não representam autorização real dos oito serviços novos.

O migrador conserva os checksums históricos e aceita somente equivalência
LF/CRLF entre checkouts. Alterações reais no SQL continuam sendo rejeitadas.
