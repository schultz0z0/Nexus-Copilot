# Google Analytics e Microsoft Clarity

O Prometeus lê dados do site por integrações nativas, separadas dos dados comerciais de Ads, leads e vendas. Cada instalação white label usa o aplicativo Google e o token Clarity da própria empresa. Gestores e administradores consultam a análise geral; apenas administradores preparam aplicativos e tokens de projeto.

## Google: preparo único e conexão diária

O administrador prepara o aplicativo em **Configurações → Integrações → Configuração avançada da instalação → Preparar / trocar aplicativo Google**. O aplicativo já preparado para Ads é reaproveitado. Não é necessário salvar ou trocar o aplicativo existente para habilitar GA4.

No projeto Google Cloud da empresa, habilitar **Google Analytics Admin API** e **Google Analytics Data API**, além de Google Ads API quando houver uso de anúncios. Na tela de consentimento, disponibilizar `https://www.googleapis.com/auth/analytics.readonly`. O conector GA4 solicita somente esse escopo; a autorização do Ads permanece independente. O aplicativo interno exige que os usuários autorizadores pertençam à organização Google Workspace do projeto; ter apenas um endereço profissional não cria essa organização. Se a empresa precisar de usuários externos, preparar o público e verificações necessários no Google Cloud.

O callback é o já existente no servidor: `/api/ads/oauth/google/callback`. Na instalação local atual, `http://127.0.0.1:8088/api/ads/oauth/google/callback`. Usar exatamente o endereço mostrado pelo app. Origem e callback não são enviados pelo usuário. Para produção, o operador humano prepara o endereço público conforme o contrato de instalação; esta documentação não autoriza deploy.

Após o preparo, o gestor clica **Conectar Google Analytics**, escolhe a conta Google, autoriza e escolhe uma propriedade GA4. Não há preenchimento de Client ID/Secret nesse fluxo. Ter uma conta Ads não é requisito para GA4. Propriedade sem visitas pode ser escolhida, mas não implica resultados coletados.

**Trocar conta Google** e **Renovar Google Analytics** iniciam nova autorização após confirmação. **Trocar propriedade** verifica o acesso externo antes de salvar e exige confirmação de substituição. Trocar o aplicativo Google invalida autorizações e trabalhos de Ads e GA4, preservando os históricos. Desconectar interrompe leituras, sem apagar medições anteriores.

## GA4 no site

Criar a propriedade em [Google Analytics](https://analytics.google.com/), cadastrar o fluxo Web e instalar a tag no site ou via Google Tag Manager. A conexão no Prometeus lê essa propriedade; não instala automaticamente o rastreador no site. Confirmar a coleta na visão em tempo real do Analytics antes de esperar resultados históricos. Eventos-chave dependem da configuração do próprio site; eles nunca são convertidos automaticamente em pessoas ou vendas no Prometeus.

O relatório importa sessões, sessões engajadas, visualizações e eventos-chave. O filtro aceita até 30 dias completos no fuso da propriedade. Usuários únicos não são somados entre dias. Respostas amostradas, limiares de privacidade e cobertura incompleta são sinalizados. Falha preserva medições anteriores; valor desconhecido permanece desconhecido.

## Clarity

No projeto Clarity, o administrador abre **Settings → Data Export → Generate new API token**. Em **Integrações → Análise do site → Conectar Microsoft Clarity**, informa ID, nome e token e clica **Validar e conectar**. O token é validado por leitura externa antes da publicação, cifrado no servidor e nunca devolvido em consultas. O ID e nome são rótulos informados pelo administrador: a resposta da API não confirma a identidade textual do projeto.

A API oficial usa token do projeto; não oferece o mesmo fluxo OAuth Google documentado para esta exportação. O Prometeus consulta a última janela de 24 horas e guarda snapshots. A API limita a dez chamadas por projeto/dia, três dimensões e 1.000 linhas sem paginação. Reservas de quota persistem antes de cada chamada, inclusive falhas e concorrência; trocar token ou rótulo não reinicia o orçamento. Outros consumidores do mesmo projeto também podem consumir a quota externa.

Indicadores confirmados pelo contrato Traffic incluem sessões e sessões de bots; origens e campanhas vêm da distribuição recebida. Campos ausentes não viram zero. Contagens de atrito e unidades de rolagem não confirmadas não são inventadas. Mapas de calor, gravações e sinais detalhados continuam no Clarity, com link para o projeto. Snapshots de janelas móveis não são somados como série diária nem comparados diretamente com um período fechado GA4.

## Campanhas

Em **Campanha → Navegação → Vincular navegação**, informar o valor exato de `utm_campaign` das URLs divulgadas e o provedor conectado. Exemplo: `?utm_campaign=oferta_outubro` usa `oferta_outubro`, incluindo a capitalização original. Não inferir pelo nome interno da campanha. Um mesmo segmento/recurso não pode estar ativo em duas campanhas. Vincular dois provedores não significa somar suas sessões: GA4 e Clarity possuem métodos e janelas distintos.

O vínculo usa o recurso selecionado no servidor e respeita a autorização da campanha. Ao trocar recurso, revisar os vínculos. Desativar remove o segmento da leitura vigente e preserva o histórico. Captação de pessoas permanece no contrato [campaign-acquisition.md](campaign-acquisition.md).

## Contratos técnicos e operação

- App API/BFF encaminha a identidade canônica e a vinculação da sessão; o navegador não chama APIs internas ou bancos.
- Estados OAuth opacos, de uso único, vinculados a usuário/sessão/instalação. O callback compartilhado identifica intenção pelo estado; o BFF aceita apenas a tag fixa do serviço confiável.
- Tokens e PKCE cifrados usam a chave persistente da instalação Ads. O guard de referências cifradas também inclui Analytics; nunca regenerar a chave se existem referências.
- Tabelas `web_analytics_*` têm RLS forçado. Snapshots, jobs e quota são persistentes; barreiras de geração impedem publicação após substituição/desconexão.
- Leitura periódica usa o scheduler do Marketing Ops, com orçamento Clarity e contexto do responsável canônico. Atualização manual usa receipt/idempotência pelo app.
- GA4 limita cada operação externa a 90 segundos, com até cinco consultas de propriedades em paralelo. O serviço compartilha um orçamento de 100 segundos entre renovação e leitura; o BFF reserva 120 segundos para operações externas e o callback Google, com 130 segundos no proxy de retorno OAuth. O limite vale para a operação completa, incluindo paginação.
- A atualização exibida considera a observação mais antiga que contribui para o período consultado. Atualizar outro período não torna medições antigas recentes. Tentativas que perderam sua reserva de execução não alteram o estado publicado por uma tentativa posterior.
- GET não retorna segredos. Nunca versionar credenciais, imprimir tokens, incluir em URL, salvar em armazenamento do navegador ou enviar a Hermes.

Fontes: [GA4 Data API](https://developers.google.com/analytics/devguides/reporting/data/v1), [Admin API](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list), [OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server), [Clarity Export API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api).
