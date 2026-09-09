# Atualização e rollback do Hermes/Profile ENS

Status: update/rollback do Profile ENS exercitado no Docker Desktop em
2026-09-09; rollback do core e VPS pendentes.

## Evidência do ensaio local de 2026-09-09

O exercício usou somente o volume restaurado
`ens-hermes-restore-20260909T170349Z`, nunca o volume de origem. Um candidato
descartável `ens@0.1.2` foi gerado em `tmp/` a partir do commit aprovado, com
apenas o campo de versão alterado, e passou no validador da distribuição.

Com o runtime parado, o inicializador oficial atualizou `ens@0.1.1` para o
candidato `0.1.2`. `profile info`, liveness, capabilities e o smoke autenticado
passaram. O runtime foi parado novamente e o mesmo inicializador reaplicou a
distribuição rastreada `ens@0.1.1`; `profile info` e o segundo smoke também
passaram. Provider permaneceu ausente e foi a única degradação aceita.

Isso comprova update e rollback manual da distribuição, quiescência do runtime
e preservação do core fixado. Não comprova rollback do core: só existe um pin
oficial aprovado neste marco, portanto nenhuma segunda imagem foi introduzida
artificialmente. Também não comprova a execução na VPS.

## Objetivo e regras

Atualizar separadamente o comportamento ENS e o core oficial, sempre com pin,
backup e rollback verificáveis. Os comandos partem da raiz do repositório na
VPS e usam `/etc/ens/hermes.env` como arquivo de ambiente externo ao Git.

Proibido: tag `latest`, Watchtower, auto-update, `curl | bash` no deploy, update
interno do container ou dois gateways escrevendo no mesmo `/opt/data`.

O botão de atualização do dashboard não substitui este procedimento. Em um
runtime gerenciado por imagem, core novo entra somente por PR que altera tag e
digest juntos. Não existe atualização automática em produção.

## Matriz de mudança

| Cenário | Core | `agents/ens` | Volume | Rollback principal |
| --- | --- | --- | --- | --- |
| Atualizar distribuição | mesmo tag/digest | nova versão | preservado e previamente salvo | reaplicar distribuição anterior |
| Atualizar core | nova tag e novo digest | compatível/revalidado | preservado e previamente salvo | restaurar pin anterior; restaurar snapshot se necessário |
| Rollback da distribuição | inalterado | release anterior | preservado | init one-shot com checkout/release anterior |
| Rollback do core | pin anterior | versão compatível | preservar ou restaurar backup compatível | subir imagem anterior e executar smoke |

## Pré-requisitos comuns

- PR aprovado com escopo e rollback;
- [backup consistente](hermes-backup-restore.md) concluído e checksum válido;
- Docker Desktop autorizado para ensaio e VPS em janela de manutenção;
- nenhum run ativo, init ativo ou alteração administrativa em andamento;
- commit, versão da distribuição, tag e digest atuais registrados;
- chave do API Server disponível ao operador, sem aparecer em comandos/logs.

## Atualização da distribuição ENS

### 1. Preparar e revisar

1. aumente `version` em `agents/ens/distribution.yaml`;
2. descreva SOUL, skills, MCPs ou defaults alterados no PR;
3. execute `npm run validate:hermes-profile` e `npm run test:hermes`;
4. confirme que `config.yaml` não sobrescreverá provider/modelo;
5. se `mcp_servers` mudou, inclua migration seletiva aprovada: o Hermes `0.20.6`
   preserva `config.yaml` durante `profile update`.

Esperado: PR revisado, testes aprovados e efeito sobre profiles existentes
explícito. Pare se a mudança depender de `--force-config`.

### 2. Parar, salvar e aplicar

```sh
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml stop hermes
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml ps --status running
```

Esperado: nem `hermes` nem `hermes-profile-init` executando. Faça o backup e
valide o checksum antes de continuar.

```sh
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml run --rm --no-deps hermes-profile-init
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml run --rm --no-deps --entrypoint hermes hermes-profile-init profile info ens
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml up -d --no-deps hermes
```

Impacto: atualiza arquivos pertencentes à distribuição no volume e reinicia o
runtime. Esperado: init exit zero, versão ENS nova e container healthy.

Execute o smoke autenticado sem tolerância quando o provider já estiver
configurado. Registre também `hermes mcp test nexus_marketing_ops` em um contexto
interno autorizado quando a integração M2/MCP estiver disponível.

### 3. Rollback somente da distribuição

Use um checkout limpo da release ENS anterior; não reescreva o checkout ativo.
Pare o runtime, confirme o init parado, monte `agents/ens` da release anterior e
execute novamente o init one-shot. Depois valide `profile info`, suba o runtime
e rode o smoke.

Se arquivos removidos ou migrations de config tornarem a reversão incompatível,
restaure primeiro o backup em volume de teste. Somente depois de aprovado,
planeje a restauração do volume de produção.

## Atualização manual do core oficial

### 1. Auditar a release antes do PR

- leia release notes e compare o tag/commit oficial;
- confira Docker manifest multiarch e obtenha o digest OCI;
- revise mudanças de Profile Distribution, API, health, dashboard, OAuth e MCP;
- reavalie a compatibilidade `mcp.json` versus `config.yaml`;
- altere tag e digest juntos em todos os serviços do Compose;
- atualize `hermes_requires`, ADR/desenho e runbooks quando necessário.

Esperado: nenhuma tag flutuante e um digest único revisado no PR.

### 2. Ensaiar antes da VPS

Com autorização específica, execute no Docker Desktop usando nome de projeto,
arquivo de ambiente e volume descartáveis. Cubra init novo/existente, restart,
persistência, dashboard OAuth, health, capabilities, smoke, backup e restore.

Não avance se algum teste for skipped por falta de Linux/daemon ou se o backup
não tiver sido restaurado em volume de teste.

### 3. Aplicar na VPS

Depois de parar o runtime e criar backup consistente:

```sh
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml pull
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml run --rm --no-deps hermes-profile-init
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml up -d --no-deps hermes
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml ps
```

Impacto: baixa e inicia somente a referência versionada no checkout aprovado.
Esperado: digest observado igual ao PR, init exit zero e runtime healthy. Execute
smoke, OAuth/dashboard e MCP antes de encerrar a janela.

### 4. Rollback do core

1. pare o runtime novo;
2. implante o commit/release que contém o tag e digest anteriores;
3. se o estado continuar compatível, suba a imagem anterior e rode o smoke;
4. se houve migration incompatível, mantenha produção parada, restaure o backup
   em volume de teste e valide-o;
5. somente após aprovação, restaure o volume de produção e suba o pin anterior.

Nunca tente rollback parcial, como tag antiga com digest novo. Preserve a imagem
anterior e o backup até a aceitação formal.

## Evidências

Registre PR/commit, release oficial, tag/digest anterior e novo, arquitetura,
backup/checksum, tempos, exit do init, `profile info`, health, capabilities,
smoke, MCP, OAuth e decisão go/no-go. Redija chaves, tokens, payloads privados e
URLs internas não aprovadas.
