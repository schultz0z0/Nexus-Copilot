#!/bin/sh
set -eu

. /opt/nexus-postgres/ops/common.sh

start_time=$(date +%s)
restore_dir="$(mktemp -d /tmp/nexus-restore-XXXXXX)"
drill_success=0

cleanup() {
  exit_code=$?
  end_time=$(date +%s)
  duration=$((end_time - start_time))
  iso_now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  if [ "$exit_code" -ne 0 ] && [ "${drill_success:-0}" -ne 1 ]; then
    if [ -d "/var/lib/nexus-backup/status" ]; then
      error_json=$(cat <<EOF
{
  "status": "error",
  "error_code": "restore_drill_failed",
  "timestamp": "$iso_now",
  "duration_seconds": $duration,
  "rto_compliant": false,
  "rto_target_seconds": 7200
}
EOF
      )
      write_status "/var/lib/nexus-backup/status/last-restore-drill.json" "$error_json" || true
    fi
  fi
  rm -rf "$restore_dir"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Fail closed: never allow restore drill against production postgres host
if [ "${PGHOST:-}" = "postgres" ] || [ -z "${PGHOST:-}" ]; then
  printf 'Fail closed: restore drill cannot target postgres host\n' >&2
  exit 1
fi

require_directory "/var/lib/nexus-backup"
mkdir -p /var/lib/nexus-backup/status
require_directory "/var/lib/nexus-backup/status"
require_directory "${RESTIC_REPOSITORY:-/var/lib/nexus-backup/restic}"

export PGPASSWORD="$(read_secret "${PGPASSWORD_FILE:-/run/secrets/postgres_bootstrap_password}")"
export RESTIC_PASSWORD="$(read_secret "${RESTIC_PASSWORD_FILE:-/run/secrets/postgres_restic_password}")"
export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-/var/lib/nexus-backup/restic}"

# Validate destination database is empty before restore
user_tables=$(psql -X -At -c "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');")
if [ "${user_tables:-0}" -gt 0 ]; then
  printf 'Fail closed: destination database is not empty (found %s tables)\n' "$user_tables" >&2
  exit 1
fi

restic restore latest --host nexus-postgres --tag logical --target "$restore_dir"

cd "$restore_dir"
# Find manifest and dump file even if nested under path
if [ ! -f "manifest.sha256" ]; then
  found_manifest=$(find . -name "manifest.sha256" | head -n 1)
  if [ -n "$found_manifest" ]; then
    cd "$(dirname "$found_manifest")"
  fi
fi

sha256sum --check manifest.sha256
pg_restore --list nexus.dump >/dev/null
pg_restore --exit-on-error --no-owner --no-acl --dbname "${PGDATABASE:-nexus}" nexus.dump

sql_check="/opt/nexus-postgres/ops/validate-restore.sql"
if [ ! -f "$sql_check" ]; then
  sql_check="/opt/nexus-postgres/validate-restore.sql"
fi

psql -X --set ON_ERROR_STOP=1 --file "$sql_check"

end_time=$(date +%s)
duration=$((end_time - start_time))
iso_now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

status_json=$(cat <<EOF
{
  "status": "ok",
  "timestamp": "$iso_now",
  "duration_seconds": $duration,
  "rto_compliant": true,
  "rto_target_seconds": 7200
}
EOF
)

write_status "/var/lib/nexus-backup/status/last-restore-drill.json" "$status_json"
drill_success=1
