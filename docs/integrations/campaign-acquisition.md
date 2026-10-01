# Captação e resultados por campanha

A campanha possui fontes próprias. Uma fonte identifica o canal, o caminho de
conversão e, opcionalmente, a ação do calendário. A pessoa mantém sua origem
inicial e pode participar de mais de uma campanha. Contatos frios do Google Maps
ficam separados de leads captados. Cliques em WhatsApp não representam conversas.

## Operação manual

1. Na campanha, cadastre uma fonte para o canal e a estratégia. Use fontes
   distintas para formulário, WhatsApp e prospecção fria.
2. Exporte os contatos identificados na ferramenta de origem. Não importe uma
   linha por clique nem converta uma contagem agregada em pessoas fictícias.
3. Importe o arquivo, mapeie colunas e revise a prévia. Para candidatos
   duplicados, escolha uma pessoa existente ou decida explicitamente criar.
4. Confirme a importação. Guarde o recibo para conferir novos, vinculados,
   ignorados, inválidos e repetidos.
5. Na aba **Visão geral**, abra **Relatórios de resultados** para registrar o
   relatório semanal com período, fonte e valores medidos. Confira a ação
   vinculada e os números antes de confirmar. Campo em
   branco significa desconhecido; `0` significa zero medido.

Campos de contato: `name`, `email` e/ou `phone`, `company`, `externalId` e
`occurredAt`. Datas de ocorrência usam ISO 8601 com fuso, por exemplo
`2026-09-28T10:00:00-03:00`. Telefones devem incluir DDI quando conhecido,
por exemplo `5511999999999`. Preserve o identificador exportado pela plataforma.
Informe a conta externa da fonte quando usar IDs de anúncios: os identificadores
são comparados dentro do namespace do canal e da conta; sem conta, dentro da fonte.

Na interface, arquivos CSV/TSV e Excel `.xlsx` aceitam até 4 MB, 500 contatos e
40 colunas com cabeçalhos únicos por lote. A importação lê a primeira aba visível
do Excel; exporte fórmulas como valores. Arquivos `.xls` devem ser exportados para
CSV ou `.xlsx`. Colunas não mapeadas não são enviadas ao servidor. Datas sem fuso
usam a interpretação documentada em São Paulo (`-03:00`), e uma data sem horário
usa o início desse dia. Confirme a data de ocorrência no mapeamento,
especialmente em exportações de outros países.

## Formulários de landing page

Cadastre uma fonte do tipo `landing_page` com as origens exatas autorizadas,
como `https://lp.exemplo.com.br` (sem caminho nem barra final). A campanha deve
estar planejada ou ativa. Copie o endereço de captura fornecido na campanha.
O navegador envia o formulário à **App API**, nunca ao banco ou Hermes.

```js
// A fonte configura campanha, tenant e canal no servidor.
const endpoint = 'https://SEU-DOMINIO/api/capture/ID-PUBLICO-DA-FONTE';
const form = document.querySelector('#formulario-lead');
let submissionId = crypto.randomUUID(); // conservar em todas as tentativas

form.addEventListener('submit', async event => {
  event.preventDefault();
  const fields = new FormData(form);
  const query = new URLSearchParams(location.search);
  const utm = {};
  for (const key of ['source', 'medium', 'campaign', 'content', 'term']) {
    const value = query.get(`utm_${key}`);
    if (value) utm[key] = value.slice(0, 200);
  }
  const body = {
    submissionId, name: String(fields.get('name') || '').trim(), utm,
    ...(fields.get('email') ? { email: String(fields.get('email')).trim() } : {}),
    ...(fields.get('phone') ? { phone: String(fields.get('phone')).trim() } : {}),
    ...(fields.get('company') ? { company: String(fields.get('company')).trim() } : {})
  };
  try {
    const response = await fetch(endpoint, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Falha no envio');
    // Mostrar confirmação acessível na LP. Não procurar dados pessoais na resposta.
    form.reset();
    submissionId = crypto.randomUUID();
  } catch {
    // Manter os campos e submissionId; permitir nova tentativa sem duplicar.
  }
});
```

Inclua informação de privacidade e uso dos dados adequada ao formulário da
empresa. Não envie credenciais nem `tenantId`, `campaignId` ou um canal escolhido
pelo visitante. UTMs complementam a atribuição, sem substituir a fonte configurada.
Desabilitar a fonte revoga a captura. Identidades exatas consistentes podem ser
vinculadas pelo servidor; conflitos ficam para revisão na campanha.

## WhatsApp

Use o link `/api/capture/ID-PUBLICO-DA-FONTE/whatsapp` da fonte configurada.
O destino é o telefone cadastrado; a referência da campanha acompanha a mensagem.
O registro é de clique. Para medir leads ou conversas identificadas sem API,
importe os contatos da ferramenta e registre o relatório semanal separadamente.
Um telefone de destino não dá à plataforma acesso às mensagens de WhatsApp.

## Relatórios e Hermes

Relatórios aceitam `sent`, `delivered`, `opened`, `clicked`, `responded`, `spend`,
`qualified`, `sales` e `revenue`. Contagens são inteiras; valores monetários usam
reais com até duas casas decimais. Ausência de uma métrica não implica zero.
Relatórios não criam contatos e não são somados ao número de leads identificados.

Uma janela sobreposta da mesma fonte/ação deve ser corrigida por revisão do
relatório existente. Revisar substitui os valores atuais e preserva o histórico.
Relatórios que cruzam parcialmente um filtro do dashboard são excluídos do total,
com indicação de cobertura, pois não é possível distribuir seus valores por dia.

O Hermes pode preparar `campaign.results_record` após consultar as fontes e os
relatórios da campanha. A gravação ocorre somente ao executar o plano revisado
no cartão da aplicação. O modelo não escolhe tenant nem autoriza a si próprio.
Os conectores Meta Ads, Google Ads e LinkedIn Ads são especificados em
`ads-white-label.md`, com preparo em `ads-installation.md`: aplicativos próprios
da empresa, autorização e escolha da conta pelo app. Sua existência no código
não significa uma conexão externa ativa; é preciso preparar e validar a conta
da instalação. Fornecedores de disparos sem API continuam usando o fluxo manual.

Formulários nativos autorizados geram prévias revisáveis de até quinhentos
contatos por lote. A confirmação usa as mesmas regras de identidade, ator,
expiração e versão da fonte. A sincronização de anúncios para landing page ou
WhatsApp lê métricas; os contatos chegam pelo endpoint da fonte ou importação.
Uma fonte manual pode servir a esses destinos quando os contatos vêm por arquivo.
Captura automática da página/link exige a instrumentação própria correspondente.

Relatórios de anúncios sincronizados não são editados pelo formulário manual.
Correções chegam pela sincronização e conservam suas revisões. Medições retiradas
de uma consulta completa deixam os totais vigentes sem transformar ausência em
zero. Uma sobreposição com relatório manual pede revisão e conserva esse relatório.

## Contratos HTTP

Autenticação por sessão no BFF: `/api/marketing/…` corresponde a `/v1/…` interno.
Mutações usam `Idempotency-Key`; alterações de fonte/relatório também `If-Match`.

| Recurso | Métodos / caminho após `/api/marketing` |
| --- | --- |
| Fontes | GET/POST `campaigns/:id/lead-sources`; PATCH `…/:sourceId` |
| Contatos | GET `campaigns/:id/leads` |
| Prévia | POST `campaigns/:id/lead-imports/preview`; GET `campaigns/:id/lead-imports/:previewId` |
| Confirmação | POST `campaigns/:id/lead-imports/:previewId/confirm` |
| Revisão de captura | GET `campaigns/:id/lead-capture-reviews`; POST `…/:captureId/resolve` |
| Relatórios | GET/POST `campaigns/:id/result-reports`; PATCH `…/:reportId` |
| Resumo | GET `results?campaignId=…&from=AAAA-MM-DD&to=AAAA-MM-DD` |

O ID de campanha sempre vem do workspace escolhido. Uma prévia pertence ao ator
que a preparou, expira e é revalidada na confirmação. O servidor resolve
participação/permissão e rejeita vínculos entre tenants ou campanhas incompatíveis.

## Liberação na VPS pelo operador

### IP real do proxy de produção

Em localhost, o Chat Web recebe o navegador diretamente. Na VPS o caminho
Traefik → Chat Web exige configurar o proxy confiável antes de habilitar
formulários públicos: sem isso, os visitantes compartilham o limite do proxy.
O nginx inclui opcionalmente `/etc/nginx/trusted-proxies/*.conf`. O operador
deve montar um diretório somente leitura, contendo configuração com o IP/CIDR
**exclusivo e confirmado** do ingress, por exemplo:

```nginx
# Substituir pelo endereço observado do Traefik; nunca 0.0.0.0/0 ou uma rede
# inteira que também permita clientes ou containers não confiáveis.
set_real_ip_from IP_EXCLUSIVO_DO_PROXY;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Adicionar no override operacional do `chat-web` um bind mount do diretório
confirmado pelo operador para `/etc/nginx/trusted-proxies`, com `read_only: true`.
O Traefik deve manter a confiança de forwarded headers restrita aos ingressos
reais (sem modo insecure). Conferir `nginx -t` antes de liberar tráfego e verificar
com dois clientes que o limite é independente; header forjado em acesso direto
não pode trocar a identidade. Não confiar em qualquer `X-Forwarded-For` recebido.
O BFF aceita `X-Real-IP` apenas do serviço Chat Web resolvido na rede interna e
assina a identidade encaminhada ao Marketing Ops; o navegador não fornece essa
assinatura. Esta configuração de produção é executada pelo operador humano.

**Impacto:** migration `0019` cria tabelas, índices, políticas e funções para
captação/resultados; reconstruir App API, Marketing Ops e Chat Web disponibiliza
as rotas e telas. Nenhum lead histórico é criado automaticamente.

**Resultado esperado:** migration aplicada uma única vez, serviços saudáveis,
campanhas existentes preservadas; importar um arquivo fictício gera prévia e
recibo; formulário de origem autorizada alimenta apenas sua campanha.

**Condição de parada:** erro de checksum/migration, serviços não saudáveis,
campanhas sem leitura, acesso cruzado ou resposta pessoal em endpoint público.
Não continuar a configuração de fontes públicas nesse estado.

**Rollback:** desabilitar fontes públicas e voltar às imagens anteriores dos
três serviços. A migration é aditiva; manter as tabelas preserva os novos dados.
Não remover tabelas nem restaurar backup sobre um banco em uso sem plano humano
de recuperação e conferência dos registros posteriores. Fazer backup validado
antes da atualização conforme o procedimento operacional do projeto.

O operador executa o processo de produção e devolve saídas redigidas. Não enviar
credenciais, cookies ou conteúdo de leads em logs de diagnóstico.
