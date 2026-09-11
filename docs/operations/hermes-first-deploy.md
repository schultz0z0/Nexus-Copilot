# Primeiro deploy do Hermes oficial na VPS

Status: exercitado com sucesso na VPS em 2026-09-11; runtime oficial ativo e saudável.

## Evidência do deploy na VPS (2026-09-11)

Deploy executado pelo operador humano com apoio de copiloto do agente,
conforme as regras do `AGENTS.md`.

Evidência resumida:

- Host: Linux `x86_64`, Docker Engine `29.4.0`, Docker Compose `v5.1.2`, Node.js `v22.22.2`;
- Diretório de checkout: `/opt/prometeus-marketing`, commit `1c9618e`;
- Imagem: `nousresearch/hermes-agent:v2026.8.27` no digest fixado
  `sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79`;
- Volume: `ens-hermes-data` criado;
- Profile Distribution: `ens@0.1.1` instalado no volume dedicado, schemas migrados
  para `_config_version: 39`;
- Supervisão e runtime: container `ens-hermes-hermes-1` executando sob `s6-overlay`,
  com status `Up (healthy)`;
- Correção de supervisão: remoção da flag legada `--no-supervise` no Compose,
  permitindo que o `s6` gerencie o gateway em background e auto-reinicie em falhas;
- Autenticação do dashboard: configurada na raiz do volume (`/opt/data/config.yaml`)
  com `dashboard.basic_auth.username = admin` e hash criptográfico `scrypt`;
- Smoke test interno na API (`8642`):
  - Liveness: `PASS`
  - Capabilities: `PASS` (motor oficial de Runs, Events SSE e Approvals ativo)
  - Readiness: `DEGRADED provider_unconfigured` (deliberado e permitido no primeiro deploy);
- Traefik e HTTPS: Traefik externo (`network_mode: host`) roteando
  `https://hermes.solucoes-nexus.tech` para a porta `9119` do container;
  resposta `HTTP/2 302` redirecionando para `/login?next=%2F` com certificado válido
  Let's Encrypt (TLSv1.3);
- Fronteira de segurança: API interna (`8642`) sem publicação de portas e inacessível
  pela internet.

## Evidência prévia do ensaio Docker Desktop (2026-09-09)

Evidência local anterior preservada para referência histórica:

- Docker Desktop `4.88.1`, Engine `29.7.2`, Compose `v5.4.0`, `linux/amd64`;
- imagem observada com o digest aprovado e revisão upstream `5fc308a70719a83cccdbba4c0e39c23f5a8239d5`;
- Profile Distribution `ens@0.1.1`, configs raiz/profile no schema `39`;
- container `healthy`, bind local somente em `127.0.0.1:18642`, dashboard desabilitado;
- volume `ens-hermes-m1-data` preservado após ciclos de restart e `down`/`up`.

## Responsabilidade pela execução na VPS

Este documento é um roteiro para o operador humano. O agente não executa SSH,
deploy ou comandos administrativos na VPS: fornece um bloco por vez, declara o
impacto e o resultado esperado, valida as saídas/logs redigidos devolvidos pelo
operador e somente então orienta a próxima etapa. Testes do endereço público só
ocorrem se o operador fornecer explicitamente a URL.

## Objetivo e impacto

Criar o runtime Hermes oficial `0.20.6` na VPS Linux usando a imagem fixada por
tag e digest, instalar o profile ENS no volume persistente e publicar somente o
dashboard OAuth em `hermes.solucoes-nexus.tech`.

Os comandos partem da raiz do checkout do monorepo na VPS. Eles criam arquivos
em `/etc/ens`, baixam a imagem fixada, criam containers e podem criar o volume
`ens-hermes-data`. Nenhum passo configura provider/modelo automaticamente.

## Pré-requisitos

- acesso SSH administrativo à VPS Linux;
- Docker Engine e Docker Compose v2;
- Node.js 22 ou superior para o smoke;
- DNS de `hermes.solucoes-nexus.tech` apontando para a VPS;
- Traefik externo ativo com Docker provider, entrypoint e cert resolver
  conhecidos;
- client ID OAuth Nous registrado para a URL pública;
- portas públicas 80/443 atendidas pelo Traefik; nenhuma regra pública para a
  API Hermes.

## 1. Checar host e ferramentas

```sh
uname -m
docker version
docker compose version
node --version
```

Esperado: arquitetura suportada pela imagem, daemon acessível, Compose v2 e
Node.js 22+. Pare se qualquer requisito falhar; não instale dependências durante
o deploy sem uma mudança operacional separada.

## 2. Criar o arquivo de ambiente fora do Git

```sh
sudo install -d -m 700 /etc/ens
sudo install -m 600 infra/hermes/hermes.env.example /etc/ens/hermes.env
sudoedit /etc/ens/hermes.env
```

No editor:

1. gere uma chave com `openssl rand -hex 32` e preencha `API_SERVER_KEY` sem
   colocá-la no histórico do shell;
2. preencha `HERMES_DASHBOARD_OAUTH_CLIENT_ID` com o client ID Nous;
3. confirme `HERMES_DASHBOARD_PUBLIC_URL` e
   `NEXUS_PUBLIC_HERMES_DASHBOARD_HOST`;
4. confirme entrypoint e cert resolver do Traefik;
5. não adicione provider, modelo ou credenciais de modelo.

Confirme permissões sem imprimir o conteúdo:

```sh
sudo stat -c '%a %U:%G %n' /etc/ens/hermes.env
```

Esperado: modo `600`. Não continue com chave vazia ou OAuth ausente: o Compose
de produção falha fechado deliberadamente.

## 3. Renderizar e conferir o artefato

```sh
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml config --quiet
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml config --images
```

Esperado: configuração válida e somente a imagem
`nousresearch/hermes-agent:v2026.8.27` acompanhada do digest aprovado. Pare se
aparecer `latest`, outra imagem, porta publicada, router da API ou segredo na
saída.

## 4. Verificar se o volume já existe

```sh
docker volume inspect ens-hermes-data
```

Em primeiro deploy, `not found` é esperado. Se o volume existir, trate como
ambiente com estado: pare o procedimento e execute o runbook de backup/restore
antes de pull, init ou alteração. Nunca substitua nem remova o volume para
"começar limpo".

## 5. Baixar a imagem fixada

```sh
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml pull
```

Impacto: altera somente o cache local de imagens Docker. Esperado: download da
referência fixada; falha de digest interrompe o deploy.

## 6. Executar e inspecionar o inicializador

```sh
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml run --rm --no-deps hermes-profile-init
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml run --rm --no-deps --entrypoint hermes hermes-profile-init profile info ens
```

Impacto: cria/atualiza o profile `ens` dentro de `ens-hermes-data`. Esperado:
ambos os comandos terminam com exit code zero e `profile info` mostra origem e
versão ENS.

Se o init falhar, não use `--force-config` e não suba o runtime. Preserve o
volume e colete a saída para diagnóstico.

## 7. Iniciar o runtime sem repetir o init

```sh
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml up -d --no-deps hermes
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml ps
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml logs --tail=100 hermes
```

Impacto: cria e inicia o container persistente. Esperado: `hermes` em execução
e depois `healthy`; dashboard e gateway supervisionados sem crash loop. Provider
ausente pode degradar readiness, mas não autoriza ignorar falhas estruturais.

## 8. Health, readiness e capabilities pela rede interna

A API não possui `ports`. No host Linux, obtenha o IP privado do container e
valide-o antes do uso:

```sh
hermes_container_id="$(docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml ps -q hermes)"
test -n "$hermes_container_id"
hermes_private_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$hermes_container_id")"
test -n "$hermes_private_ip"
printf 'Hermes private IP: %s\n' "$hermes_private_ip"
```

Leia a chave de forma mascarada, execute o smoke e remova-a do processo:

```sh
read -r -s -p 'API_SERVER_KEY: ' API_SERVER_KEY
printf '\n'
export API_SERVER_KEY
node scripts/smoke-hermes-runtime.mjs --base-url "http://${hermes_private_ip}:8642" --api-key-env API_SERVER_KEY --allow-provider-unconfigured
unset API_SERVER_KEY
```

Esperado: liveness e capabilities aprovadas; somente
`provider_unconfigured` pode aparecer como degradação permitida no primeiro
acesso. Timeout, 401, JSON inválido ou capability ausente interrompem o deploy.

## 9. Validar dashboard e ausência da API pública

```sh
curl --silent --show-error --head https://hermes.solucoes-nexus.tech
curl --silent --show-error https://api-hermes.solucoes-nexus.tech/health
```

Esperado no primeiro comando: HTTPS válido e redirecionamento/tela de login
OAuth antes de qualquer conteúdo administrativo. A resposta do segundo comando
não pode identificar `platform` como `hermes-agent`; `404`, falha de DNS ou
ausência de rota são aceitáveis. Se uma API Hermes responder publicamente,
interrompa a aceitação e remova o router legado no Traefik.

## 10. Configurar provider manualmente

Autentique-se no dashboard, escolha provider e modelo e grave a configuração
no volume. Isso é uma ação administrativa manual e não deve gerar alteração
no Git ou no Compose.

Repita o smoke sem tolerância:

```sh
read -r -s -p 'API_SERVER_KEY: ' API_SERVER_KEY
printf '\n'
export API_SERVER_KEY
node scripts/smoke-hermes-runtime.mjs --base-url "http://${hermes_private_ip}:8642" --api-key-env API_SERVER_KEY
unset API_SERVER_KEY
```

Esperado: liveness, readiness e capabilities com `PASS`.

## 11. Rollback recuperável do primeiro deploy

Se a aceitação falhar:

```sh
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml down
docker volume inspect ens-hermes-data
```

`down` remove containers e a rede do stack, mas o comando acima não remove o
volume. Preserve `ens-hermes-data` e `/etc/ens/hermes.env` para diagnóstico ou
recuperação. Não acrescente `--volumes`.

## Evidências obrigatórias

Registre data, host, arquitetura, commit do monorepo, tag/digest renderizados,
exit do init, `profile info`, estado/health do container, resultado dos dois
smokes, resposta HTTPS/OAuth e prova de ausência da API pública. Remova chaves,
tokens, payloads privados e caminhos pessoais antes de anexar logs.
