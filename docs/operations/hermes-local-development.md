# Hermes oficial no desenvolvimento local

Status: implementado, ainda não exercitado neste computador corporativo.

## Objetivo e fronteiras

Usar a instalação oficial local do Hermes com a distribuição versionada em
`agents/ens`, sem copiar o core para o monorepo. Os comandos abaixo partem da
raiz do repositório.

Este procedimento não instala nem atualiza o Hermes. Ele não deve ler, copiar ou
apagar estado de outros profiles. Instalar, atualizar, ativar ou excluir o
profile `ens` exige autorização explícita do responsável pelo computador.

## Pré-requisitos

- Windows com a instalação oficial do Hermes já existente;
- Node.js 22 ou superior;
- chave local do API Server armazenada fora do Git;
- provider/modelo opcionalmente configurados pelo operador no profile local;
- Chat Bridge executado no host ou no Docker Desktop.

## 1. Verificações somente leitura

```powershell
hermes --version
npm run validate:hermes-profile
npm run test:hermes
```

Esperado: Hermes `0.20.6` para paridade exata com o pin de produção, contrato
da distribuição aprovado e testes sem falhas. Uma versão local diferente deve
ser registrada e avaliada; este runbook não autoriza atualização automática.

Consultar o profile também é somente leitura:

```powershell
hermes profile info ens
```

Exit code diferente de zero significa que o profile ainda não existe.

## 2. Instalar ou atualizar o profile ENS

Execute somente depois da autorização explícita.

Profile ausente:

```powershell
hermes profile install .\agents\ens --name ens --yes
```

Profile existente:

```powershell
hermes profile update ens --yes
```

Em ambos os casos:

```powershell
hermes profile use ens
hermes profile info ens
```

Impacto: cria ou atualiza arquivos pertencentes à distribuição no profile
local e torna `ens` o profile padrão. O update normal preserva a configuração
local; nunca acrescente `--force-config` a este fluxo.

Esperado: origem local apontando para `agents/ens`, versão da distribuição
visível e nenhuma mudança automática de provider ou modelo.

## 3. Preparar e iniciar a API local

Descubra o arquivo de ambiente do profile sem abrir seu conteúdo:

```powershell
hermes -p ens config env-path
```

No arquivo retornado, configure por meio de editor seguro:

- `API_SERVER_ENABLED` como verdadeiro;
- `API_SERVER_HOST` como `127.0.0.1`;
- `API_SERVER_KEY` com valor aleatório de pelo menos 8 caracteres.

Isso altera somente o ambiente do profile `ens`. Não copie o arquivo para o
repositório. Inicie o gateway em primeiro plano:

```powershell
hermes -p ens gateway run
```

Impacto: inicia o gateway e a API local, podendo criar logs, sessões e estado no
profile. Esperado: API ouvindo somente em `127.0.0.1:8642`. Encerre com
`Ctrl+C` quando terminar.

## 4. Conectar o Chat Bridge

Configure fora do Git as duas variáveis do processo do Bridge:

- `HERMES_API_BASE_URL`: `http://127.0.0.1:8642` quando o Bridge roda no host;
- `HERMES_API_BASE_URL`: `http://host.docker.internal:8642` quando o Bridge roda
  no Docker Desktop;
- `HERMES_API_KEY`: a mesma chave local configurada no API Server.

O navegador continua conversando com a App API/BFF/Bridge e nunca recebe a URL
interna nem a chave do Hermes.

## 5. Executar o smoke

Em um PowerShell separado, leia a chave sem ecoá-la na tela e mantenha-a somente
no processo atual:

```powershell
$env:API_SERVER_KEY = Read-Host "API_SERVER_KEY local" -MaskInput
node .\scripts\smoke-hermes-runtime.mjs --base-url http://127.0.0.1:8642 --api-key-env API_SERVER_KEY --allow-provider-unconfigured
Remove-Item Env:\API_SERVER_KEY
```

Esperado antes de configurar provider: liveness e capabilities aprovadas, com
readiness `provider_unconfigured` explicitamente aceita. Depois de configurar
provider/modelo, repita sem `--allow-provider-unconfigured`; todas as linhas
devem ser `PASS`.

## 6. Limpeza e recuperação

- Gateway em primeiro plano: use `Ctrl+C`.
- Gateway iniciado como serviço: use `hermes -p ens gateway stop`.
- Se este procedimento criou um profile descartável e sua exclusão foi
  autorizada, confirme primeiro com `hermes profile info ens` e somente então
  use `hermes profile delete ens`.
- Nunca apague o diretório global do Hermes, arquivos de autenticação, memórias,
  sessões ou bancos como atalho de limpeza.

Se o profile já existia, interrompa o gateway e investigue antes de qualquer
rollback. A atualização preserva configuração local, e a remoção do profile
não é um rollback seguro.

## Registro do exercício

Registre data, versão local, commit da distribuição, resultado do smoke,
diferenças para produção e qualquer alteração autorizada no profile. Este
runbook só passa a `Exercitado` depois desse registro.
