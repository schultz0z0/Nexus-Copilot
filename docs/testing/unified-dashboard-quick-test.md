# Teste rápido do dashboard unificado

Ambiente local: `http://127.0.0.1:8088/marketing-ops/dashboard`.
Use gestor/admin e conexões já autorizadas. Nenhum passo requer envio de e-mail,
publicação de evento ou acesso administrativo à VPS.

1. **Visão geral:** conferir os quatro indicadores, dois gráficos e no máximo
   três insights. Ausência de medição aparece como indisponível; contatos frios,
   sessões e cliques não entram na contagem de leads. Conferir valores/tabelas
   acessíveis dos gráficos. Uma fonte com erro não deve apagar as demais.
2. **Filtros:** alterar datas/campanha, navegar entre abas e recarregar. A URL
   conserva as escolhas. Datas invertidas geram orientação. Limpar filtros
   mantém a aba. O Orgânico usa datas, mas não atribui todo o site à campanha.
3. **Orgânico → Busca no Google:** conferir propriedade, período, cliques,
   impressões, CTR, posição e detalhes de páginas/pesquisas. Com filtros vazios,
   o painel usa seu período padrão explícito. Trocar período não conserva
   recomendações da leitura anterior se a nova falhar ou não existir.
4. **Orgânico → Navegação orgânica:** conferir GA4 e aviso de cobertura. Para
   snapshots antigos, clicar **Atualizar Google Analytics** uma vez; o botão
   faz a leitura externa. O recorte exclui canais pagos, direto e referência.
   Usar até 30 dias completos no fuso indicado. Eventos-chave não são vendas.
5. **Análise do site e experiência:** abrir pelo rodapé da Visão geral. Trocar
   GA4/Clarity no diálogo. GA4 geral inclui todo o site; Clarity exibe a janela
   móvel UTC efetivamente medida, sem recorte pelo filtro de datas. Abrir mapas
   de calor/gravações usa o próprio Clarity. Escape fecha e devolve o foco.
6. **Campanhas:** conferir resultados e funil com métricas desconhecidas
   preservadas. Abrir a página de uma campanha pelos links. Selecionar campanha
   e abrir navegação sob demanda: somente UTM exata vinculada, sem inferência
   pelo nome. Nenhum alerta deve afirmar falta de atribuição antes da consulta.
7. **Trabalho:** escolher Drive, Sheets, Gmail ou agenda conectados. Navegar
   arquivos/planilhas e abrir uma leitura. A URL conserva o serviço. Campanhas
   seguem como contexto para anexos e importações revisadas. Nenhum envio,
   importação ou publicação ocorre ao apenas abrir uma aba.
8. **Acessos existentes:** links em Integrações e perfil abrem o dashboard.
   `/marketing-ops/analytics?provider=clarity` abre o diálogo; `/marketing-ops/workspace?service=google_sheets`
   abre Trabalho; Search Console abre Orgânico. Configurações continua
   disponível para conectar, renovar, trocar e desconectar contas/recursos.
9. **Permissões:** membro não consulta/renderiza análise do site ou ferramentas
   restritas, mesmo por link direto. Permissões comerciais existentes continuam
   no servidor. Com escrita desativada, atualizações/publicações ficam bloqueadas.
10. **Celular e teclado:** verificar 390 px, abas, filtros, diálogo, tabelas e
    textos longos sem rolagem horizontal da página. Usar Tab/setas/Enter/Escape,
    foco visível e retorno ao controle. Gráficos não dependem de animação/cor.

Resultados comerciais sem relatórios, GA4 sem tag/visitas, Search Console sem
dados ou Ads sem conta autorizada continuam estados honestos de configuração
ou ausência de medição. Não preencher com demonstração para validar integrações.
