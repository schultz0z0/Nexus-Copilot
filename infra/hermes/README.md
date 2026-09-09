# Runtime oficial do Hermes

Esta pasta contém somente o contrato de instalação do Hermes oficial e os
overrides de ambiente. O core não é vendorizado. A distribuição ENS permanece
em `agents/ens` e o estado fica no volume configurado por
`HERMES_DATA_VOLUME_NAME`.

## Smoke local do Runs API

O ensaio não chama modelo e não exige provider. Ele comprova o pin oficial, a
inicialização do profile, a saúde do processo, as capabilities exigidas pelo
Chat Bridge e a rejeição de chamadas protegidas sem Bearer token.

No PowerShell, use valores locais exclusivos e não salve a chave no Git:

```powershell
$env:API_SERVER_KEY = '<chave-local-temporaria-com-8-ou-mais-caracteres>'
$env:HERMES_DATA_VOLUME_NAME = 'ens-hermes-m2-data'
$env:HERMES_PARITY_API_PORT = '18643'

docker compose -p ens-hermes-m2 `
  -f infra/hermes/compose.yaml `
  -f infra/hermes/compose.parity.yaml up -d

$env:HERMES_CONTRACT_BASE_URL = 'http://127.0.0.1:18643'
python -m unittest discover -s infra/hermes/tests -p test_runs_contract.py -v

$env:HERMES_API_BASE_URL = $env:HERMES_CONTRACT_BASE_URL
npm run smoke:hermes -- --allow-provider-unconfigured
```

Resultado esperado: o contrato Python passa; o smoke Node registra liveness e
capabilities como `PASS` e readiness como degradada somente por
`provider_unconfigured`.

Antes do teardown, confira os alvos exatos:

```powershell
docker ps -a --filter 'label=com.docker.compose.project=ens-hermes-m2'
docker volume inspect ens-hermes-m2-data
docker network inspect ens-hermes-m2_default
```

Remova apenas containers e rede do ensaio, preservando o volume como evidência:

```powershell
docker compose -p ens-hermes-m2 `
  -f infra/hermes/compose.yaml `
  -f infra/hermes/compose.parity.yaml down
```

Para remover posteriormente o volume, o operador deve primeiro confirmar que o
nome resolvido é exatamente `ens-hermes-m2-data` e que não há necessidade de
backup. Esse descarte não faz parte do smoke padrão.

## Produção

Produção usa `compose.yaml` com `compose.production.yaml`, provider configurado
manualmente e o Traefik externo já existente. A VPS é operada exclusivamente
pelo responsável humano conforme os runbooks em `docs/operations`; este smoke
local não autoriza deploy ou acesso administrativo.
