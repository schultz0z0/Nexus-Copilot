# Infraestrutura

A infraestrutura será reconstruída para PostgreSQL vanilla, App API/BFF, Chat Bridge, Hermes oficial, Marketing Ops e Artifact Server.

Os arquivos Compose antigos não foram copiados porque ainda carregam Supabase, Graph/Neo4j e o fork Hermes.

## Runtime Hermes oficial (M1)

`infra/hermes` contém somente a composição do core oficial, sem Dockerfile
derivado e sem cópia do repositório Nous:

| Arquivo | Responsabilidade |
| --- | --- |
| `compose.yaml` | init one-shot e runtime interno fixados pela mesma tag/digest |
| `compose.production.yaml` | router temporário do dashboard `9119` pelo Traefik |
| `profile-init.sh` | instala/atualiza/ativa `agents/ens` antes do runtime |
| `hermes.env.example` | contrato de variáveis sem credenciais |

O arquivo de ambiente real deve ficar fora do Git, por exemplo em
`/etc/ens/hermes.env` na VPS. O Compose exige a chave do API Server e, no
override de produção, o client ID OAuth do dashboard.

A porta API `8642` não é publicada e não recebe labels. O router Traefik aponta
somente para o dashboard `9119`. Como o Traefik existente usa Docker provider e
`network_mode: host`, este stack não cria nem exige uma rede externa `traefik`.

O Compose M1 possui apenas o runtime Hermes. A conexão definitiva com Chat
Bridge e Marketing Ops será feita pela composição privada do produto na fase de
integração; não publique `8642` como atalho.

Renderização local, sem iniciar containers:

```powershell
$env:API_SERVER_KEY = Read-Host "Chave temporária para renderização" -MaskInput
$env:HERMES_DASHBOARD_OAUTH_CLIENT_ID = "agent:compose-validation"
docker compose --env-file infra/hermes/hermes.env.example -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml config --quiet
Remove-Item Env:\API_SERVER_KEY
Remove-Item Env:\HERMES_DASHBOARD_OAUTH_CLIENT_ID
```

Esse comando apenas valida/interpola o YAML. Pull, init e `up` alteram imagens,
volume e containers e pertencem ao
[runbook de primeiro deploy](../docs/operations/hermes-first-deploy.md).
