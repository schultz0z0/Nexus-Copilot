# Retorno OAuth Google Ads — 2026-10-01

O teste humano concluiu o consentimento Google, mas o Prometeus apresentou
`ads_provider_unavailable`. O diagnóstico seguro registrou a etapa `accounts`:
a troca do código por tokens terminou; a consulta das contas falhou no transporte.
A leitura pelo BFF e a verificação no navegador confirmaram que o frontend
exibia o estado retornado pelo servidor.

## Causa e correção

`new URL('customers:listAccessibleCustomers', base)` interpreta `customers:`
como protocolo, ignorando a origem HTTPS e a versão. O fetch não chega ao
Google. O construtor dos caminhos internos agora usa `./` para mantê-los
relativos à API do provedor. Meta e LinkedIn conservam seus caminhos.

Endpoint confirmado na [referência oficial Google](https://developers.google.com/google-ads/api/reference/rpc/v25/CustomerService/ListAccessibleCustomers?transport=rest):
`GET https://googleads.googleapis.com/v25/customers:listAccessibleCustomers`.

## Evidências

- Dois testes falharam antes da correção pelo endereço incorreto: descoberta
  direta e descoberta dos clientes de uma conta administradora.
- Após a correção: 24 testes de conectores/diagnóstico aprovados e compilação
  TypeScript aprovada.
- 38 testes de configuração, rotas e conectores aprovados com PostgreSQL
  isolado; migrations 0001–0021 e replay idempotente verificados.
- Revisão independente não identificou problema acionável.
- Backend corrigido reconstruído no localhost; cinco endpoints de saúde
  responderam HTTP 200. Sem credenciais reais, a mesma chamada nativa com token
  deliberadamente inválido mudou de falha local de transporte (503) para resposta
  de autenticação do Google (401). Isso confirma que a requisição agora chega
  ao provedor; não confirma autorização da conta real.

Os tokens da tentativa que falhou não foram persistidos. A conclusão real da
integração ainda exige uma nova autorização humana e escolha de uma conta
retornada pelo Google. Testes com respostas simuladas não comprovam conexão
externa ativa. Não publicar tokens, códigos OAuth, segredos ou corpos de resposta
do provedor nos logs. O diagnóstico permanente limita-se a fase, categoria,
código permitido e posição de código interno.

## Tentativa após o rebuild

Verificação dentro do container confirmou o construtor corrigido. A nova
autorização chegou à etapa `accounts` e recebeu `ads_permission_required`,
HTTP 403 do Google; a falha anterior de transporte não se repetiu.
O responsável mostrou a tela do cadastro inicial Google Ads e informou que
ainda não criou campanhas. Isso é compatível com cadastro incompleto, mas
o motivo exato do 403 ainda não foi confirmado por um código específico Google.
Campanhas existentes não são requisito para conectar uma conta acessível.

A mensagem de acesso negado estava ausente no cliente e caía em orientação
genérica. O BFF também tratava o erro de permissão envolvido em HTTP 502 como
indisponibilidade. Ambos agora conservam a categoria de permissão por código
fixo, sem transmitir mensagens brutas ou URLs do provedor. O conector registra
apenas códigos de recusa Google explicitamente permitidos e a operação, sem
identificadores, metadata, token ou texto da resposta. Nova autorização humana
continua necessária para confirmar conta acessível e concluir a conexão.

Validação desta atualização: 5 testes BFF OAuth e 17 testes do contrato frontend
aprovados; 41 testes focados com PostgreSQL isolado aprovados antes do ajuste da
chave do log. A revisão encontrou que `providerReason` era censurado pelo logger;
a chave virou `accessCode`, com regressão usando o logger real (15 testes de
provedores aprovados após esse ajuste). Tipos frontend e compilação backend
aprovados. Frontend, BFF e Marketing Ops foram reconstruídos e recriados no
Docker local. Cinco endpoints saudáveis responderam HTTP 200 e o navegador
confirmou `ads_permission_required` com orientação de acesso negado na tela.

O próximo passo humano é concluir o cadastro Google Ads, preferencialmente sem
campanha conforme a [ajuda oficial](https://support.google.com/google-ads/answer/6366720?hl=pt-BR),
e depois renovar a autorização. Caso o 403 persista, o próximo log seguro
`accessCode` deve distinguir cadastro, acesso do usuário e acesso do projeto.
