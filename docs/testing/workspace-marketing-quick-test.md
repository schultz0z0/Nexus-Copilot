# Teste rápido — integrações de trabalho do marketing

Use a conta local admin em [Integrações](http://127.0.0.1:8088/settings/integrations?tab=workspace).
Prepare uma pasta, calendário, destinatário e campanha exclusivos de teste.
Os passos abaixo incluem efeitos reais apenas quando você confirma envio ou
publicação. Nunca cole client secrets ou tokens no chat.

1. Abra o preparo do Google/Microsoft. Confira callback gerado pelo servidor,
   requisitos, client ID e estado do segredo. Salve no formulário. Reabra: o
   segredo deve permanecer vazio, com indicação de segredo já cadastrado.
2. Conecte cada serviço. Autorize no provedor, volte ao app e escolha o recurso.
   Confira a conta e o nome reais. Cancele outro consentimento: o app deve
   explicar o cancelamento e permitir uma nova tentativa.
3. Arquivos: navegue na pasta/biblioteca, busque um material e vincule à campanha.
   No Drive, escolha **Meu Drive inteiro** mesmo se não houver pastas. Abra duas
   pastas aninhadas, retorne a cada nível pelo caminho e confira os arquivos da
   raiz. Mudar de pasta deve limpar a busca/página anterior.
   Recarregue, abra o original e desative o vínculo. O original não deve ser
   apagado, e o vínculo anterior deve permanecer no histórico.
4. E-mail: consulte mensagens e vincule uma à campanha. Prepare um rascunho
   para seu endereço de teste, confira destinatário, assunto e texto. Cancelar
   a confirmação não envia. Confirme uma vez; confira a caixa enviada no
   provedor. Repetir a mesma operação não deve produzir outro e-mail. Uma
   resposta incerta exige conferência externa, não uma retentativa automática.
5. Calendário: escolha a agenda de teste, leia a janela e publique um compromisso
   com data/fuso revisados. Confira no provedor. Repetir a mesma publicação não
   deve duplicar o compromisso. Associar à campanha não conclui sua ação.
6. Sheets: selecione uma planilha com cabeçalhos e valores de teste. Confira
   também **Todas as planilhas**: busque, abra uma planilha, volte à biblioteca
   e abra outra. A conta e a geração da integração não devem ser substituídas;
   a prévia/mapeamento da primeira não pode aparecer na segunda.
   prévia e limites. Mapeie dados, revise duplicados/erros e confirme pelo fluxo
   de importação existente. Fechar a prévia não muda contatos nem indicadores.
   Relatório com campo ausente deve conservar desconhecido, não preencher zero.
7. Search Console: escolha uma propriedade acessível, consulte período e compare
   com o painel no mesmo recorte. Confira gráficos/tabelas e cobertura. Lista
   de pesquisas pode ser parcial; não espere que sua soma reproduza o total.
8. Troque recurso e conta; confira confirmação e identidade após recarregar.
   Desconecte: consultas/escritas novas devem parar, sem apagar vínculos/recibos.
   Trocar aplicativo deve exigir novas autorizações daquela família e preservar
   Ads/GA4 quando a configuração de Workspace for independente.
9. Teste APIs desabilitadas, conta sem recurso, permissão revogada e aplicação
   expirada. O app deve orientar como resolver, sem expor dados privados.
10. Teste Tab/Enter/Escape, celular e zoom. Membro comum não deve abrir a caixa
    corporativa nem preparar aplicativos. Gestor pode operar recursos; admin
    prepara credenciais. Confirme separação entre instalações/tenants nos testes.

Para cada serviço, registre apenas resultado, tela e código seguro de falha.
Um cadastro salvo ou consentimento aprovado não substitui uma leitura real.
Prévia, criação de rascunho e envio são operações diferentes. Aceitação do
envio pelo provedor não comprova entrega ou abertura.
