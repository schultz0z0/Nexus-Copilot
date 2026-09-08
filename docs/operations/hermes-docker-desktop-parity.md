# Ensaio de paridade Hermes no Docker Desktop

Status: preparado; execução autorizada somente no próximo computador de teste.

## Objetivo

Exercitar em Docker Desktop com containers Linux a imagem oficial fixada do
Hermes, o inicializador do profile `ens`, o runtime, health/capabilities,
persistência e reaplicação idempotente da distribuição antes de qualquer deploy
na VPS.

Este é o próximo lote do M1. Ele não configura provider, não testa o Traefik da
VPS e não conclui o M1 sozinho.

## Autorização e limites

O usuário autorizou, no outro computador com Docker Desktop:

- baixar a imagem oficial fixada no Compose;
- criar e iniciar somente o projeto Compose `ens-hermes-m1`;
- criar somente o volume descartável `ens-hermes-m1-data`;
- criar um arquivo `.env.hermes-m1.local` ignorado pelo Git;
- executar init, runtime, smoke, restart e segundo init;
- parar os containers ao final.

A autorização não inclui:

- instalar ou atualizar Docker, Hermes local ou outras ferramentas;
- acessar ou modificar `.hermes`, profiles, credenciais, sessões ou memórias do
  host;
- usar o volume padrão de produção `ens-hermes-data`;
- remover volumes, imagens ou arquivos sem uma confirmação específica;
- configurar provider/modelo, publicar o dashboard ou acessar a VPS;
- usar `--force-config`, `--volumes`, `docker system prune` ou comandos amplos de
  limpeza.

Se `ens-hermes-m1-data` já existir, pare antes do init e peça orientação. O
volume deve ser preservado ao final para inspeção, salvo nova autorização.

## Artefatos do ensaio

- Compose base: `infra/hermes/compose.yaml`;
- override local: `infra/hermes/compose.parity.yaml`;
- ambiente-modelo: `infra/hermes/hermes.env.example`;
- inicializador: `infra/hermes/profile-init.sh`;
- smoke: `scripts/smoke-hermes-runtime.mjs`;
- registro de resultados: seção **Evidência do ensaio Docker Desktop** em
  `docs/operations/hermes-first-deploy.md`.

O override publica somente `8642` em `127.0.0.1:18642` e desabilita o dashboard
durante o ensaio. O dashboard exige OAuth quando usa bind não loopback; seu
HTTPS/OAuth real continua reservado ao deploy na VPS. O nome do volume é
controlado por `HERMES_DATA_VOLUME_NAME`, mantendo `ens-hermes-data` como padrão
de produção.

## 1. Atualizar e identificar o checkout

Em um clone já existente:

```powershell
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
```

Esperado: `main` atualizada e nenhuma alteração local. Se houver arquivos
rastreados modificados, não os descarte nem continue até entender a origem.

## 2. Verificar ferramentas sem instalar nada

```powershell
node --version
npm --version
docker version
docker compose version
docker info --format '{{.OSType}}/{{.Architecture}}'
```

Esperado: Node.js 22+, daemon acessível e `linux/<arquitetura>` no Docker
Desktop. Se faltar algo, pare; este lote não autoriza instalações.

## 3. Instalar dependências e rodar gates estáticos

```powershell
npm ci
npm run validate:hermes-profile
npm run test:hermes
npm run test:cut
npm run verify:cut
```

Antes do runtime, todos os comandos devem terminar com exit `0`. No host com
containers Linux, os quatro cenários POSIX ainda podem aparecer skipped no
teste Node do Windows; eles serão cobertos pelo init real dentro da imagem.

## 4. Criar ambiente local isolado

```powershell
Copy-Item .\infra\hermes\hermes.env.example .\.env.hermes-m1.local
```

Edite somente `.env.hermes-m1.local`:

- defina `HERMES_DATA_VOLUME_NAME=ens-hermes-m1-data`;
- gere `API_SERVER_KEY` aleatória com pelo menos 32 bytes;
- mantenha provider/modelo ausentes;
- mantenha `HERMES_DASHBOARD_OAUTH_CLIENT_ID` vazio neste ensaio.

Confirme que o arquivo está ignorado sem imprimir seu conteúdo:

```powershell
git check-ignore .env.hermes-m1.local
git status --short
```

## 5. Validar o alvo antes de criar estado

```powershell
docker volume inspect ens-hermes-m1-data
```

Esperado no primeiro ensaio: `not found`. Qualquer volume encontrado é um
bloqueio; não o remova nem execute o init.

Renderize a composição sem iniciar containers:

```powershell
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml config --quiet
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml config --images
```

Esperado: somente a imagem oficial com tag/digest aprovados, volume
`ens-hermes-m1-data`, API publicada apenas em `127.0.0.1:18642` e dashboard
desabilitado.

## 6. Pull e primeiro init

```powershell
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml pull
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml run --rm --no-deps hermes-profile-init
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml run --rm --no-deps --entrypoint hermes hermes-profile-init profile info ens
```

Esperado: digest baixado corresponde ao pin; init exit `0`; `profile info ens`
mostra a distribuição ENS. Se falhar, preserve o volume e registre a saída sem
segredos.

## 7. Runtime e smoke sem provider

```powershell
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml up -d --no-deps hermes
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml ps
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml logs --tail=100 hermes
```

Carregue a chave apenas no processo atual, sem exibi-la, e execute:

```powershell
$env:API_SERVER_KEY = Read-Host "API_SERVER_KEY do ensaio" -MaskInput
node .\scripts\smoke-hermes-runtime.mjs --base-url http://127.0.0.1:18642 --api-key-env API_SERVER_KEY --allow-provider-unconfigured
Remove-Item Env:\API_SERVER_KEY
```

Esperado: liveness e capabilities aprovados; somente
`provider_unconfigured` pode ser tolerado na readiness.

## 8. Persistência e segundo init

Registre `profile info ens`, reinicie somente o runtime e repita o smoke:

```powershell
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml restart hermes
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml run --rm --no-deps --entrypoint hermes hermes-profile-init profile info ens
```

Depois pare o runtime, reaplique o init e suba-o novamente. Init e runtime não
podem escrever simultaneamente no volume:

```powershell
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml stop hermes
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml run --rm --no-deps hermes-profile-init
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml up -d --no-deps hermes
```

Repita `profile info` e o smoke. Esperado: update/use idempotentes, profile
ativo, estado preservado e nenhuma exigência de provider.

## 9. Encerrar sem apagar evidência

```powershell
docker compose -p ens-hermes-m1 --env-file .env.hermes-m1.local -f infra/hermes/compose.yaml -f infra/hermes/compose.parity.yaml down
docker volume inspect ens-hermes-m1-data
git status --short
```

Não use `--volumes`. Esperado: containers/rede parados, volume preservado e
nenhum segredo ou estado adicionado ao Git.

## 10. Registrar evidências

Atualize a documentação com:

- data, sistema operacional, arquitetura, versões Docker/Compose/Node e commit;
- digest observado;
- resultado do init, segundo init, `profile info`, health e capabilities;
- prova de bind somente em loopback;
- resultado de restart/persistência;
- nome e estado final do volume;
- limitações e falhas, com segredos e payloads removidos.

Não marque backup/restore, rollback ou dashboard HTTPS/OAuth como exercitados
sem executar os respectivos runbooks em escopo autorizado.

## Prompt de retomada para o outro computador

```text
Estou no outro computador de teste, com Docker Desktop configurado para containers Linux, e já clonei ou atualizei a branch main do repositório https://github.com/schultz0z0/Nexus-Copilot.git.

Continue o marco M1 exatamente pelo ensaio documentado em docs/operations/hermes-docker-desktop-parity.md. Antes de agir, leia AGENTS.md, docs/README.md, MIGRATION_STATUS.md, docs/migration/roadmap.md e docs/plans/2026-08-28-hermes-official-runtime-implementation.md.

Neste computador, autorizo especificamente: baixar a imagem oficial Hermes fixada no Compose; criar/iniciar/parar somente o projeto Docker ens-hermes-m1; criar somente o volume descartável ens-hermes-m1-data; criar o arquivo local ignorado .env.hermes-m1.local; executar init, profile info, runtime, smoke, restart e segundo init. Não autorizo apagar volumes/imagens, instalar ou atualizar o Hermes local, acessar .hermes/credenciais/sessões do host, configurar provider/modelo, acessar a VPS ou publicar o dashboard.

Valide primeiro git status, versões, Docker Linux, render do Compose e inexistência do volume. Se o volume ens-hermes-m1-data já existir, pare e me avise. Use o override infra/hermes/compose.parity.yaml, que publica somente a API em 127.0.0.1:18642 e desabilita o dashboard. Preserve o volume ao final. Teste cada etapa, registre evidências sem segredos nos documentos do projeto e não declare o M1 concluído se algum gate continuar pendente.
```
