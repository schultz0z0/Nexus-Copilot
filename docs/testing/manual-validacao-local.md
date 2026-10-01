# Validação rápida do Prometeus local

Tempo estimado: 10–15 minutos. Ambiente: <http://127.0.0.1:8088>.
Entre com sua conta local de administrador ou gestor. Use uma campanha nova,
chamada **Teste de validação Prometeus**, para identificar os dados fictícios.

## 1. Navegação e apresentação

- [ ] Abra Dashboard, Campanhas e Esteira de produção. As páginas devem concluir
  o carregamento, sem erro ou indicador de carregamento permanente.
- [ ] Abra uma campanha. Confira Visão geral, Planejamento, Fontes e Leads.
- [ ] Atualize a página: a campanha e seus dados devem continuar disponíveis.
- [ ] Confira nome Prometeus, logos, cores, legibilidade e gráficos. No chat,
  o robô e os dois balões devem permanecer.

## 2. Integrações: o que pode ser validado agora

Abra <http://127.0.0.1:8088/settings/integrations>.

- [ ] Meta Ads, Google Ads e LinkedIn Ads aparecem.
- [ ] No ambiente atual, os três mostram **Aguardando configuração**.
  Esse é o resultado esperado: os aplicativos da empresa ainda não foram preparados.
- [ ] **Atualizar conexões** termina sem erro.
- [ ] Como administrador, há **Configurar aplicativo** em cada provedor.
- [ ] Abra o cadastro: aparecem client ID, segredo, URL de retorno copiável e
  os campos específicos. Meta também pede a configuração do Login for Business.
- [ ] Confira a URL: deve começar com `http://127.0.0.1:8088/api/ads/oauth/`
  e terminar no provedor correto, sem permitir editar a origem no formulário.
- [ ] Deixe os campos obrigatórios vazios e tente avançar: a interface indica
  o que falta e não inicia autorização. Feche o formulário sem salvar.
- [ ] Com gestor ou member, o preparo administrativo não é oferecido. Gestor
  continua podendo autorizar e trocar contas quando o aplicativo estiver preparado.
- [ ] As orientações abrem e fecham sem bloquear a navegação.
- [ ] Não aparece conta conectada nem acesso a métricas sem autorização real.

Não salve credenciais fictícias no ambiente de avaliação. O percurso completo de
gravação e reinício é validado automaticamente em banco isolado; neste ambiente,
use somente o aplicativo real da sua empresa quando estiver disponível.

## 3. Importação manual e duplicados

Na campanha de teste, abra **Fontes → Nova fonte** e cadastre:

| Campo | Valor |
| --- | --- |
| Nome da fonte | Meta — validação manual |
| Canal da fonte | Meta Ads |
| Caminho da conversão | Importação manual |
| Classificação inicial | Lead identificado |

Salve. Abra **Leads → Importar contatos** e selecione a fonte e o arquivo
[`leads-validacao.csv`](fixtures/leads-validacao.csv).

- [ ] Confira o mapeamento de Nome, E-mail, Identificador externo e Data de captação.
- [ ] Clique **Gerar prévia**. Na primeira utilização desses contatos, espere
  **2 novos e 1 já registrado**: a terceira linha repete a primeira.
- [ ] Antes de confirmar, os contatos ainda não devem estar gravados.
- [ ] Confirme: espere **2 criados e 1 já registrado**.
- [ ] Feche o diálogo e confira os dois contatos na lista e sua origem.
- [ ] Reimporte o mesmo arquivo na mesma fonte. As três linhas devem ser
  reconhecidas como já registradas. Feche a prévia: a lista continua com dois contatos.

Se esses e-mails já existirem por uma validação anterior, o sistema poderá exibir
duplicados ou pedir revisão. Não crie novas pessoas para repetir o teste.

## 4. Relatório e resultados

Abra **Visão geral → Relatórios de resultados → Novo relatório**.
Selecione a fonte de teste, período **30/09/2026 a 30/09/2026**, fuso
**America/Sao_Paulo**, e informe:

| Medição | Valor |
| --- | --- |
| Investimento | 20 |
| Qualificados | 1 |
| Vendas | 1 |
| Receita | 100 |

Deixe as outras medições em branco. Use **Revisar valores → Confirmar relatório**.

- [ ] A campanha mostra os valores informados no período correspondente.
- [ ] O relatório não cria contatos: continuam sendo dois.
- [ ] Medições ausentes continuam sem medição, sem serem preenchidas com zero.
- [ ] Em **Revisar relatório**, altere a receita para 150 e confirme a revisão.
  O resultado vigente deve ser 150, sem somar 100 + 150.
- [ ] **Ver histórico** conserva a versão anterior com receita 100.
- [ ] No dashboard geral, selecione um período que inclua 30/09/2026.
  Os resultados devem refletir a campanha; lembre que os totais também incluem
  outras campanhas que estiverem no filtro.

Qualificados e vendas neste teste são medições agregadas. Não representam a
movimentação individual de contatos em um CRM.

## 5. Celular e teclado

- [ ] Em uma janela estreita, abra o menu e acesse Integrações e Campanhas.
  Conteúdo e botões devem permanecer acessíveis, sem rolagem horizontal da página.
- [ ] Abra um diálogo. Confira se título, fechamento e confirmação estão visíveis.
- [ ] Navegue com Tab: o foco deve ser visível e permanecer no diálogo aberto.
- [ ] Feche com Esc quando não houver ação em andamento. O foco deve voltar
  ao controle que abriu o diálogo.

## 6. Depois do preparo de uma conta real

Este bloco depende do [guia de instalação](../integrations/ads-installation.md).
Repita para cada provedor autorizado:

- [ ] Como administrador, preencha **Configurar aplicativo**, confira versão e
  permissões, copie o retorno para o painel oficial, revise e salve.
- [ ] Reabra o cadastro: campos públicos permanecem; segredo fica vazio e aparece
  como cadastrado. Feche sem salvar. Preparado ainda não significa conectado.
- [ ] Clique **Conectar**, cancele no provedor e confira que o app não declara conexão.
- [ ] Autorize novamente, escolha a conta correta pelo nome e confirme.
  Confira moeda, fuso e permissões disponíveis.
- [ ] Na campanha, em **Fontes → Anúncios vinculados → Vincular anúncios**,
  escolha provedor, campanha externa, destino e fonte compatível; revise e confirme.
- [ ] Sincronize um período pequeno e encerrado. Compare investimento, cliques
  e impressões com o provedor usando a mesma conta, período e fuso.
- [ ] Abra **Ver resultados**. Conversões do provedor ficam distintas de vendas.
- [ ] Se houver acesso a formulários nativos, revise um lote e confirme as decisões.
  Nenhum contato deve entrar antes dessa confirmação.
- [ ] Feche e reabra o lote confirmado: deve aparecer o recibo da importação,
  sem oferecer uma nova confirmação.
- [ ] Desconecte a conta: novas leituras param; histórico e contatos permanecem.
- [ ] Reconecte e use **Trocar conta**: escolha outra conta autorizada, revise e
  confirme. Confira o nome da conta nova e revise os vínculos das campanhas.
- [ ] Como administrador, abra **Editar / trocar aplicativo** e revise o impacto
  antes de salvar outra configuração. A autorização anterior deve ser invalidada;
  histórico permanece e uma nova autorização é necessária. Um retorno OAuth
  iniciado antes da troca não pode conectar o aplicativo novo.
- [ ] Depois de um reinício local dos serviços, o cadastro permanece disponível.
  O segredo não reaparece no formulário ou nas respostas de leitura.

Landing pages precisam do formulário integrado à fonte. Anúncios que levam ao
WhatsApp não identificam pessoas somente pelo clique: os contatos precisam ser
captados/importados por um caminho próprio.

## Registro da avaliação

Marque cada item como **OK**, **problema** ou **não testado**. Para um problema,
envie a página, ação executada, resultado esperado e o que apareceu; uma captura
de tela e o código de correlação do erro, quando disponível, ajudam a localizar.

Ao terminar, arquive a campanha de teste para tirá-la da operação corrente.
O arquivamento preserva os dados fictícios e seu histórico no banco local.
