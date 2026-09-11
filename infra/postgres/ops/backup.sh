#!/bin/sh
set -eu

. /opt/nexus-postgres/ops/common.sh

start_time=$(date +%s)
staging_dir="$(mktemp -d /tmp/nexus-backup-XXXXXX)"
backup_success=0

cleanup() {
  exit_code=$?
  if [ "$exit_code" -ne 0 ] && [ "${backup_success:-0}" -ne 1 ]; then
    iso_now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    if [ -d "/var/lib/nexus-backup/status" ]; then
      error_json=$(cat <<EOF
{
  "status": "error",
  "error_code": "backup_failed",
  "timestamp": "$iso_now",
  "rpo_seconds": 3600
}
EOF
      )
      write_status "/var/lib/nexus-backup/status/last-backup.json" "$error_json" || true
    fi
  fi
  rm -rf "$staging_dir"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

require_directory "/var/lib/nexus-backup"
mkdir -p /var/lib/nexus-backup/status /var/lib/nexus-backup/restic
require_directory "/var/lib/nexus-backup/status"
require_directory "${RESTIC_REPOSITORY:-/var/lib/nexus-backup/restic}"

export PGPASSWORD="$(read_secret "${PGPASSWORD_FILE:-/run/secrets/postgres_backup_password}")"
export RESTIC_PASSWORD="$(read_secret "${RESTIC_PASSWORD_FILE:-/run/secrets/postgres_restic_password}")"
export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-/var/lib/nexus-backup/restic}"

archive_path="$staging_dir/nexus.dump"
checksum_path="$staging_dir/manifest.sha256"
manifest_path="$staging_dir/manifest.json"

pg_dump --format=custom --no-owner --no-acl --file "$archive_path"
pg_restore --list "$archive_path" >/dev/null

(cd "$staging_dir" && sha256sum nexus.dump > manifest.sha256)
archive_sha256=$(awk '{print $1}' "$checksum_path")
archive_bytes=$(wc -c < "$archive_path" | tr -d ' ')

cat <<EOF > "$manifest_path"
{
  "database": "${PGDATABASE:-nexus}",
  "archive_file": "nexus.dump",
  "archive_sha256": "$archive_sha256",
  "archive_bytes": $archive_bytes,
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

restic backup "$staging_dir" --host nexus-postgres --tag nexus-postgres --tag logical
restic forget --host nexus-postgres --tag logical --keep-hourly 48 --keep-daily 14 --keep-weekly 8 --prune
restic check --read-data-subset "${RESTIC_CHECK_SUBSET:-5%}"

end_time=$(date +%s)
duration=$((end_time - start_time))
iso_now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

status_json=$(cat <<EOF
{
  "status": "ok",
  "timestamp": "$iso_now",
  "archive_sha256": "$archive_sha256",
  "archive_bytes": $archive_bytes,
  "duration_seconds": $duration,
  "rpo_seconds": 3600
}
EOF
)

write_status "/var/lib/nexus-backup/status/last-backup.json" "$status_json"
backup_success=1
