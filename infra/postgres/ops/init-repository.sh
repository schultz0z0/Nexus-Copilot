#!/bin/sh
set -eu

. /opt/nexus-postgres/ops/common.sh

repo_path="${RESTIC_REPOSITORY:-/var/lib/nexus-backup/restic}"
require_directory "$repo_path"

restic_password_file="${RESTIC_PASSWORD_FILE:-/run/secrets/postgres_restic_password}"
export RESTIC_PASSWORD="$(read_secret "$restic_password_file")"
export RESTIC_REPOSITORY="$repo_path"

if restic snapshots >/dev/null 2>&1; then
  printf 'Restic repository already initialized\n'
  exit 0
fi

if [ "${ALLOW_REPOSITORY_INIT:-0}" = "1" ]; then
  restic init
  printf 'Restic repository initialized successfully\n'
else
  printf 'Restic repository not found and ALLOW_REPOSITORY_INIT is not set to 1\n' >&2
  exit 1
fi
