# Teste rápido — análise do site

Ambiente local: [Integrações](http://127.0.0.1:8088/settings/integrations?tab=analytics) e [Análise do site](http://127.0.0.1:8088/marketing-ops/analytics). Use sua conta local de administrador ou gestor. Nunca cole tokens no chat.

1. **Configuração Google:** o aplicativo Google já cadastrado deve aparecer preparado. Não salve nem troque suas credenciais apenas para habilitar GA4. No Google Cloud, habilite Analytics Admin API e Data API e adicione `analytics.readonly` ao consentimento.
2. **Primeiro uso GA4:** como o site ainda não tem GA4, crie a propriedade e o fluxo Web no Analytics e instale sua tag. Confirme visitas no relatório em tempo real. Depois, clique Conectar Google Analytics no Prometeus, autorize e escolha a propriedade. O Ads pode continuar sem conta de anúncios.
3. **Sem dados:** uma propriedade vazia deve mostrar ausência de medições, nunca vendas ou leads fictícios. Atualizar resultados consulta dias completos; o dia atual ainda está em coleta.
4. **Resultados:** em Análise do site, selecione até 30 dias completos, atualize e confira sessões, engajamento, visualizações e eventos-chave. Abra os valores tabulares sob os gráficos e as notas de cobertura. Compare com o Analytics no mesmo fuso e recorte.
5. **Trocas:** Trocar conta Google deve pedir confirmação e abrir o consentimento; Trocar propriedade deve carregar apenas propriedades acessíveis e pedir confirmação da substituição. Cancelar preserva a seleção. Desconectar deve interromper consultas e preservar o histórico.
6. **Clarity:** gere o token no projeto e cadastre somente no formulário privado do Prometeus. Validar e conectar deve confirmar leitura externa. Reabra Trocar projeto ou token: o campo secreto deve estar vazio. Confira a janela UTC de 24h, sessões/bots, distribuição e link para o Clarity. Não espere uma série diária somando snapshots.
7. **Campanha:** abra Navegação, vincule o `utm_campaign` usado na URL e confira os resultados após atualizar a leitura do site. Um segmento nunca observado deve ser desconhecido, não zero. Desativar vínculo exige confirmação.
8. **Uso:** teste com Tab/Enter/Escape, aumente o zoom e abra no celular. Um membro não deve acessar os resultados gerais ou controles de gestão. Erro de API desabilitada deve orientar habilitar as APIs; cancelamento e autorização expirada permitem iniciar novamente.

As simulações automatizadas validam o comportamento local e os contratos HTTP; não demonstram uma integração externa ativa. A validação real depende de propriedade autorizada e tag coletando dados, ou do token Clarity validado pelo app. Registre apenas status, tela e código seguro de erro, sem URL com OAuth code/state, tokens ou cookies.
