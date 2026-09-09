# Runbook — Hermes Runs Bridge

**Marco:** M2 — protocolo oficial do agente

**Último exercício local:** 2026-09-09

**Estado:** contrato sem provider aprovado; provider e VPS pendentes

## Objetivo e fronteiras

Validar a cadeia Browser -> Chat Bridge -> Runs API do Hermes oficial sem expor
o Hermes ou sua chave ao navegador. O Bridge é o único consumidor da API
interna; identidade e autorização de produto permanecem na aplicação.

O procedimento local pode criar um projeto Compose, rede e volume com nomes
exclusivos. Em produção, o agente apenas prepara e valida instruções: o operador
humano executa na VPS e devolve saídas redigidas. Não cole chaves, tokens,
conteúdo de `.env`, sessões ou memória nos logs compartilhados.

## Gate 1 — contrato local sem provider

Impacto: inicia temporariamente o Hermes em `127.0.0.1:18643` e grava estado no
volume `ens-hermes-m2-data`. Não executa modelo nem toca produção.

### Pré-checagens

```powershell
docker version
docker compose version
docker ps -a --filter 'label=com.docker.compose.project=ens-hermes-m2'
docker volume ls --filter 'name=^ens-hermes-m2-data$'
docker network ls --filter 'name=^ens-hermes-m2_default$'
```

Pare se qualquer alvo já existir e não tiver sido criado para este ensaio.

### Subida e validação

```powershell
$env:API_SERVER_KEY = '<chave-local-temporaria-com-8-ou-mais-caracteres>'
$env:HERMES_DATA_VOLUME_NAME = 'ens-hermes-m2-data'
$env:HERMES_PARITY_API_PORT = '18643'

docker compose -p ens-hermes-m2 `
  -f infra/hermes/compose.yaml `
  -f infra/hermes/compose.parity.yaml up -d

docker compose -p ens-hermes-m2 `
  -f infra/hermes/compose.yaml `
  -f infra/hermes/compose.parity.yaml ps

$env:HERMES_CONTRACT_BASE_URL = 'http://127.0.0.1:18643'
python -m unittest discover -s infra/hermes/tests -p test_runs_contract.py -v

$env:HERMES_API_BASE_URL = $env:HERMES_CONTRACT_BASE_URL
npm run smoke:hermes -- --allow-provider-unconfigured
```

Resultado esperado:

- runtime `healthy`;
- contrato Python aprovado, incluindo negação sem Bearer token;
- liveness e capabilities em `PASS`;
- única degradação aceita: `provider_unconfigured`;
- nenhuma chamada de modelo.

Pare e preserve logs redigidos se init falhar, o runtime não ficar saudável,
qualquer capability faltar, autenticação não falhar fechada ou surgir degradação
além de `model`.

### Teardown e rollback local

Confirme que os nomes resolvidos são exatamente os do ensaio:

```powershell
docker ps -a --filter 'label=com.docker.compose.project=ens-hermes-m2'
docker volume inspect ens-hermes-m2-data
docker network inspect ens-hermes-m2_default
```

Remova somente containers e rede; preserve o volume por padrão:

```powershell
docker compose -p ens-hermes-m2 `
  -f infra/hermes/compose.yaml `
  -f infra/hermes/compose.parity.yaml down
```

Se uma mudança de código causou a falha, volte ao último commit aprovado e
repita o gate com um novo nome de projeto/volume. A remoção de volume exige
decisão explícita do operador depois de backup ou confirmação de descarte.

## Gate 2 — aceite local com provider

Pré-requisito: o operador configura o provider manualmente no volume de teste,
sem versionar ou compartilhar credenciais. Em seguida, deve validar pela API de
produto, nunca chamando Hermes a partir do browser:

1. run textual completo e resposta final;
2. reconexão do frontend usando cursor do Bridge;
3. approval `once` e `deny`, vinculados ao usuário e ao Run corretos;
4. stop de Run ativo, observando `stopping` antes do terminal cancelado;
5. negação cross-user para replay, approval e stop;
6. logs sem token, conteúdo sensível ou estado Hermes.

Resultado esperado: todos os casos passam e o Bridge continua sendo o único
componente que conhece `hermes_run_id` e `API_SERVER_KEY`. Este gate ainda não
foi exercitado.

## Gate 3 — produção na VPS

Impacto: deploy/atualização do Chat Bridge e Hermes em produção. Execução
exclusiva do operador humano, em janela aprovada, seguindo também os runbooks de
primeiro deploy, backup e rollback.

Antes de qualquer mudança, o operador deve:

1. confirmar checkout e commit pretendidos em `/opt/nexus-copiloto`;
2. validar backup recuperável do volume Hermes;
3. renderizar o Compose de produção e conferir imagem/digest, rede Traefik,
   ausência de publicação da API `8642` e dashboard somente em `9119` com OAuth;
4. registrar containers atualmente ativos e definir a janela de rollback;
5. manter provider, OAuth e `API_SERVER_KEY` somente no ambiente seguro da VPS.

Condição de parada: divergência de Git, backup inválido, segredo em saída,
Compose inesperado, health/readiness diferente do previsto ou falha de qualquer
caso do Gate 2. Rollback: restaurar o commit/Compose anterior e, quando houver
mudança de estado incompatível, restaurar o volume pelo runbook de backup. O
tráfego só avança depois de health, capabilities e fluxo de produto validados.

O Hostinger Connector teve OAuth validado somente para leitura em 2026-09-09;
isso não foi deploy e não autoriza o agente a operar a VPS.

## Matriz de aceite em 2026-09-09

| Evidência | Estado |
| --- | --- |
| Cliente Runs, SSE, roteamento híbrido, approvals e stop | Comprovado localmente por testes |
| Pin oficial, init em volume vazio, auth e capabilities | Comprovado no Docker Desktop |
| Readiness sem provider | Comprovado; degradação somente em `model` |
| Run/approval/deny/stop com provider real | Pendente de configuração manual |
| HTTPS/OAuth, Traefik e fluxo real na VPS | Pendente do operador humano |
| RunStore em PostgreSQL | Dívida deliberada M3 |
| Identidade e endpoint público integralmente na App API/BFF | Dívida deliberada M4 |
| Picture e binários integralmente em Runs | Adiado até pin oficial compatível |
