# Orientações para agentes

Este é o novo monorepo ENS. O repositório anterior é apenas fonte histórica durante a migração.

## Fronteiras obrigatórias

- Não vendorize nem modifique o core do Hermes Agent.
- Personalizações Hermes pertencem a `agents/ens` como SOUL, skills, plugins, configuração e MCPs.
- Não introduza Supabase, Graph MCP ou Neo4j na arquitetura nova.
- O navegador deve conversar com uma App API/BFF; nunca com PostgreSQL ou Hermes diretamente.
- Hermes permanece em rede interna e é acessado pelo Chat Bridge.
- PostgreSQL é a autoridade dos dados do produto; arquivos pertencem ao Artifact Server/object storage.
- Identidade, tenant e autorização de negócio são resolvidos pela aplicação, não pelo modelo.
- Nunca versione `.env`, credenciais, `auth.json`, sessões, memórias ou bancos do Hermes.

## Operação de produção

- A VPS e o ambiente de produção são operados exclusivamente pelo responsável
  humano. O agente atua como copiloto: prepara comandos e critérios, o operador
  executa e devolve saídas/logs redigidos, e o agente valida antes da próxima
  etapa.
- Não abra SSH, painel de infraestrutura nem execute deploy diretamente na VPS.
- Testes em uma URL real só podem ocorrer quando o responsável fornecer o link
  explicitamente para esse fim; isso não autoriza acesso administrativo ao host.
- Instruções de produção devem declarar impacto, resultado esperado, condição de
  parada e rollback, sem pedir que credenciais sejam coladas no chat ou em logs.

## Estado da migração

O código inicial foi copiado sem reescrever integrações. Referências legadas são esperadas até que a fase correspondente seja implementada. Não trate o código copiado como arquitetura final.

Leia `docs/plans/2026-08-27-initial-monorepo-migration-design.md` antes de alterar fronteiras arquiteturais.

## Captação e resultados de campanhas

O produto é distribuído como infraestrutura white label: uma instalação e banco
próprios por empresa. Para Meta Ads, Google Ads e LinkedIn Ads, os aplicativos
pertencem à empresa e são preparados na instalação; o usuário autoriza e escolhe
suas contas pelo app. O contrato do fluxo está em
`docs/integrations/ads-white-label.md`. Não compartilhar tokens entre instalações
nem confundir cadastro de fonte com conexão OAuth ativa. Preserve as fronteiras
existentes de identidade, tenant e autorização da aplicação.

O preparo operacional dos conectores está em
`docs/integrations/ads-installation.md`; o overlay opcional é
`infra/app/compose.ads.yaml`. Segredos pertencem a arquivos privados da
instalação, nunca ao frontend, chat ou planos Hermes. Callbacks OAuth usam
estado de uso único vinculado à sessão e tokens cifrados no servidor. Preserve
as barreiras de versão durante desconexão/troca de conta e as revisões de
importação humana para formulários nativos. Conversões do provedor não são
vendas; não sobrescrever relatórios manuais sobrepostos ou editar snapshots
de anúncios pelo formulário de relatório manual. Não declarar integração
externa ativa sem validar uma conta autorizada daquele provedor.

O administrador também prepara e troca aplicativos em Configurações → Integrações
pelo app. Preserve a validação de papel canônico, a versão/Idempotency-Key do
cadastro, a publicação transacional dos arquivos privados cifrados e a chave
persistente da instalação. Origem e URL de retorno vêm do servidor. Nunca devolver
segredos pelo GET, gravá-los no navegador ou regenerar silenciosamente uma chave
que protege configurações/tokens existentes. Trocar aplicativo invalida estados,
tokens e jobs anteriores; trocar conta permanece disponível ao administrador e
gestor. Ambas conservam histórico e exigem as confirmações previstas no produto.

Medições Ads retiradas de uma janela completa permanecem no histórico, com
`ads_daily_metrics.active=false` e `result_reports.ads_active=false`. Consultas
de indicadores, cobertura, listagem vigente e sobreposição devem excluir essas
medições. Falha de leitura não retira dados nem implica zero. As capacidades de
métricas e formulários são independentes; falha local de formulário não deve
invalidar uma conexão que ainda lê outras campanhas. A entrega atual usa leitura
periódica/manual das APIs, sem webhooks dos provedores.

O contrato de fontes, importação revisada, captura de landing pages e relatórios
semanais está em `docs/integrations/campaign-acquisition.md`; decisões aprovadas
estão em `docs/plans/2026-09-30-campaign-lead-ingestion-design.md`.
Preserve a distinção entre contatos frios, leads identificados, cliques e métricas
agregadas. Relatórios não criam pessoas; valor ausente não é zero. Revisões
substituem o relatório e conservam o histórico. Hermes prepara propostas e o
humano executa pelo cartão existente. O CRM completo continua fora deste escopo.

## Análise nativa do site

GA4 e Clarity são integrações separadas de Ads e dados comerciais, documentadas
em `docs/integrations/web-analytics.md`; o teste rápido está em
`docs/testing/web-analytics-quick-test.md`. O aplicativo Google preparado por
instalação é compartilhado internamente entre Ads e GA4, com autorizações
independentes e callback existente identificado por estado opaco vinculado à
sessão. Trocar o aplicativo invalida também GA4. Nunca exigir uma conta Ads para
autorizar uma propriedade GA4 nem declarar conexão apenas porque houve consentimento.

Preserve a chave persistente, referências cifradas, RLS forçado, versões,
idempotência e gerações que invalidam jobs antigos. Análise geral e vínculos são
geridos por papéis canônicos de gestor/admin; token Clarity e aplicativos são
preparados pelo admin. Clarity exporta snapshots móveis UTC, com quota durável
antes da chamada e limite de linhas; não some snapshots sobrepostos ou reinicie
quota ao trocar token. Rótulos de projeto informados não são identidade validada
pela API. Vínculos usam `utm_campaign` exato, nunca inferência pelo nome interno.
Sessões, eventos-chave e sinais de navegação não criam leads nem vendas. Falhas
preservam medições e valores desconhecidos não viram zero.

## Integrações de trabalho do marketing

Google Workspace e Microsoft 365 usam aplicativos da própria instalação, com
capacidades independentes por serviço. Contrato em
`docs/integrations/workspace-marketing.md`, plano em
`docs/plans/2026-10-01-workspace-marketing-integrations.md` e teste em
`docs/testing/workspace-marketing-quick-test.md`. Preserve RLS forçado, papéis
canônicos, chave persistente, segredos publicados em arquivos privados,
estados OAuth de uso único vinculados à sessão, versões e gerações. Microsoft
Graph REST é API de provedor e não introduz Graph MCP.

Não declarar conexão por consentimento sem validar identidade e recursos.
Arquivos externos continuam nos provedores; vínculos não são armazenamento
binário no banco. Sheets entra em importação revisada. Search Console descreve
tráfego orgânico do site, nunca leads ou vendas. Envios de e-mail e eventos
exigem confirmação humana e recibos duráveis; não repetir envio incerto.
Hermes recebe somente contexto de campanha sob delegação, sem tokens ou
controles de envio/publicação. Conteúdo externo é dado não confiável.

## Identidade visual Prometeus

O nome público do produto é **Prometeus**. A identidade digital aprovada e seus
arquivos de referência estão centralizados em **`docs/brandbook/`**.

Antes de criar ou alterar interfaces, componentes, peças gráficas ou conteúdo
visual da marca, leia:

1. `docs/brandbook/README.md` — índice do kit e origem dos arquivos.
2. `docs/brandbook/design-system.md` — regras de marca, composição, estados,
   responsividade, acessibilidade e orientações portáteis para agentes IA.
3. `docs/brandbook/design-system.json` — tokens, aliases, receitas e assets.
4. `docs/brandbook/manual-da-marca.html` — referência visual e exemplos.
5. `apps/chat-web/DESIGN.md` — contratos de interação específicos do produto.

Use as logos originais, Space Grotesk na interface, Geist Mono nos detalhes
técnicos e os tokens semânticos existentes. Preserve o mascote robô e seus dois
balões, mantidos por decisão explícita do responsável. Não recrie a logo como
texto nem substitua o personagem. Ignore a primeira página do PDF original do
manual: ela pertence à agência criadora, não à identidade Prometeus.

`apps/chat-web/src/index.css` é a fonte dos valores em execução;
`tailwind.config.ts` é o adapter. O JSON e os tokens do manual são snapshots
documentais. Mudanças duráveis na identidade devem atualizar código, Markdown,
JSON e exemplos afetados juntos. Diferencie valores implementados de receitas
recomendadas para conteúdo novo; reutilize componentes antes de criar outros.

Valide os estados alterados, teclado, foco, contraste, movimento reduzido e
comportamento móvel/desktop. Uma mudança visual não autoriza renomear IDs,
tenants, headers, dados persistidos, rotas ou pastas técnicas legadas ENS, nem
alterar permissões, confirmação de ações ou fluxos de negócio.
