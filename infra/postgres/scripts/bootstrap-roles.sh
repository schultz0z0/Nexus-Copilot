#!/bin/sh
set -eu

umask 077

read_secret() {
  secret_path="$1"
  if [ ! -r "$secret_path" ]; then
    printf 'required PostgreSQL secret is not readable: %s\n' "$secret_path" >&2
    exit 1
  fi

  IFS= read -r secret_value < "$secret_path" || true
  if [ -z "${secret_value:-}" ]; then
    printf 'required PostgreSQL secret is empty: %s\n' "$secret_path" >&2
    exit 1
  fi
  printf '%s' "$secret_value"
}

export PGPASSWORD="$(read_secret /run/secrets/postgres_bootstrap_password)"
export NEXUS_MIGRATOR_PASSWORD="$(read_secret /run/secrets/postgres_migrator_password)"
export NEXUS_APP_PASSWORD="$(read_secret /run/secrets/postgres_app_password)"
export NEXUS_BACKUP_PASSWORD="$(read_secret /run/secrets/postgres_backup_password)"

exec psql -X --set ON_ERROR_STOP=1 --file /opt/nexus-postgres/bootstrap/roles.sql

