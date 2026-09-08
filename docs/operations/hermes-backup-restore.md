# Backup e restore do volume Hermes

Status: implementado, ensaio pendente em volume descartável.

## Objetivo e limites

Criar um backup consistente de `ens-hermes-data`, verificar integridade e provar
o restore primeiro em outro volume. O procedimento nunca usa `$HOME`, `~`, `/`,
glob amplo ou remoção recursiva como alvo.

Exemplo aprovado de diretório dedicado: `/srv/ens/backups/hermes`. Se a operação
usar outro caminho, ele exige revisão explícita e deve permanecer fora do checkout.

## Pré-requisitos

- acesso SSH administrativo à VPS;
- imagem Hermes oficial fixada já disponível;
- espaço livre superior ao tamanho do volume;
- janela sem runs ou alterações administrativas;
- `/etc/ens/hermes.env` com permissão `600`;
- RPO e RTO desejados registrados, mesmo que ainda provisórios.

## 1. Resolver e validar alvos

```sh
ENS_HERMES_BACKUP_DIR=/srv/ens/backups/hermes
resolved_backup_dir="$(readlink -f -- "$ENS_HERMES_BACKUP_DIR")"
test "$resolved_backup_dir" = /srv/ens/backups/hermes
printf 'Backup directory: %s\n' "$resolved_backup_dir"
docker volume inspect ens-hermes-data --format 'Volume: {{.Name}} | Mountpoint: {{.Mountpoint}}'
```

Esperado: caminho resolvido exatamente igual ao diretório dedicado e volume
exato `ens-hermes-data`. Pare se qualquer valor estiver vazio ou divergente.

Crie o diretório sem ampliar permissões:

```sh
sudo install -d -m 700 "$resolved_backup_dir"
sudo stat -c '%a %U:%G %n' "$resolved_backup_dir"
```

## 2. Parar escritores e confirmar quiescência

```sh
docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml stop hermes
test -z "$(docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml ps -q --status running hermes)"
test -z "$(docker compose --env-file /etc/ens/hermes.env -f infra/hermes/compose.yaml -f infra/hermes/compose.production.yaml ps -q --status running hermes-profile-init)"
```

Impacto: interrompe temporariamente o agente. Esperado: nenhum runtime/init
gravando no volume. Não continue se algum ID for retornado.

## 3. Criar arquivo, manifest e checksum

```sh
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_filename="hermes-data-${backup_stamp}.tar.gz"
backup_archive="${resolved_backup_dir}/${backup_filename}"
backup_manifest="${resolved_backup_dir}/hermes-data-${backup_stamp}.manifest.txt"
test ! -e "$backup_archive"
```

Use a mesma imagem fixada do runtime para arquivar somente o conteúdo do volume:

```sh
docker run --rm --volume ens-hermes-data:/source:ro --mount "type=bind,src=${resolved_backup_dir},dst=/backup" --env BACKUP_FILENAME="$backup_filename" --entrypoint /bin/sh nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79 -c 'cd /source && tar -czf "/backup/$BACKUP_FILENAME" .'
```

Crie metadados sem abrir arquivos de credencial:

```sh
git rev-parse HEAD > "$backup_manifest"
docker image inspect nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79 --format 'image_id={{.Id}} repo_digests={{json .RepoDigests}}' >> "$backup_manifest"
docker volume inspect ens-hermes-data --format 'volume={{.Name}} created={{.CreatedAt}}' >> "$backup_manifest"
sha256sum "$backup_archive" > "${backup_archive}.sha256"
sha256sum --check "${backup_archive}.sha256"
```

Esperado: três arquivos no diretório dedicado (arquivo, manifest e checksum),
checksum `OK` e nenhum secret no manifest. Registre início/fim para medir RPO/RTO.

## 4. Restaurar primeiro em volume de teste

Valide nomes derivados antes de criar objetos Docker:

```sh
restore_volume="ens-hermes-restore-${backup_stamp}"
restore_network="ens-hermes-restore-${backup_stamp}"
restore_container="ens-hermes-restore-${backup_stamp}"
case "$restore_volume" in ens-hermes-restore-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; *) exit 1 ;; esac
docker volume create --name "$restore_volume"
docker volume inspect "$restore_volume" --format 'Restore volume: {{.Name}} | {{.Mountpoint}}'
```

O volume deve ser novo e vazio. Restaure o arquivo verificado:

```sh
sha256sum --check "${backup_archive}.sha256"
docker run --rm --volume "${restore_volume}:/target" --mount "type=bind,src=${resolved_backup_dir},dst=/backup,readonly" --env BACKUP_FILENAME="$backup_filename" --entrypoint /bin/sh nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79 -c 'cd /target && tar -xzf "/backup/$BACKUP_FILENAME"'
docker run --rm --volume "${restore_volume}:/opt/data" --entrypoint hermes nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79 profile info ens
```

Esperado: restore exit zero e `profile info ens` coerente com o manifest.

## 5. Health e smoke no restore isolado

Crie rede e runtime temporários sem publicar portas. Digite uma chave de teste
mascarada; ela existe somente no processo/container de teste:

```sh
docker network create "$restore_network"
read -r -s -p 'Temporary API_SERVER_KEY: ' API_SERVER_KEY
printf '\n'
export API_SERVER_KEY
docker run -d --name "$restore_container" --network "$restore_network" --volume "${restore_volume}:/opt/data" --env API_SERVER_ENABLED=true --env API_SERVER_HOST=0.0.0.0 --env API_SERVER_KEY nousresearch/hermes-agent:v2026.8.27@sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79
restore_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$restore_container")"
test -n "$restore_ip"
node scripts/smoke-hermes-runtime.mjs --base-url "http://${restore_ip}:8642" --api-key-env API_SERVER_KEY --allow-provider-unconfigured
unset API_SERVER_KEY
```

Esperado: container healthy, profile `ens`, liveness/capabilities aprovadas e no
máximo degradação `provider_unconfigured`. Provider configurado no backup deve
permitir repetir o smoke sem a flag de tolerância.

Colete logs redigidos antes da limpeza. Depois valide nomes e remova somente
container/rede de teste; preserve o volume até a aprovação do restore:

```sh
test "$restore_container" = "ens-hermes-restore-${backup_stamp}"
test "$restore_network" = "ens-hermes-restore-${backup_stamp}"
docker logs --tail=200 "$restore_container"
docker stop "$restore_container"
docker container rm "$restore_container"
docker network rm "$restore_network"
docker volume inspect "$restore_volume"
```

Excluir o volume de teste exige autorização separada depois de conferir o nome
resolvido. Este runbook o preserva por padrão.

## 6. Restore de produção

Restore direto sobre `ens-hermes-data` não é procedimento rotineiro. Exige:

1. incidente ou rollback aprovado;
2. restore de teste bem-sucedido;
3. runtime e init parados;
4. snapshot adicional do volume atual;
5. plano revisado para um novo volume de produção ou substituição controlada;
6. smoke, OAuth e MCP antes de reabrir tráfego.

Não esvazie o volume atual. A abordagem preferida é restaurar em um novo volume
com nome explícito, revisar o Compose em PR e manter o volume anterior intacto
até a aceitação.

## Registro do exercício

Registre timestamp do último dado incluído, tamanho, duração do backup, duração
do restore, checksum, commit, tag/digest, volume de teste, resultados de profile,
health/smoke e limitações. Até o primeiro ensaio, RPO e RTO permanecem `A definir`.
