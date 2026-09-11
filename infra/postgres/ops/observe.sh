#!/bin/sh
set -eu

. /opt/nexus-postgres/ops/common.sh

now_sec=$(date +%s)
iso_now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

extract_field() {
  json_file="$1"
  field_name="$2"
  perl -ne '
    if (/"'"$field_name"'"\s*:\s*"([^"]*)"/) { print $1; exit; }
    elsif (/"'"$field_name"'"\s*:\s*([0-9a-zA-Z._-]+)/) { print $1; exit; }
  ' "$json_file"
}

# 1. Database metrics
export PGPASSWORD="$(read_secret "${PGPASSWORD_FILE:-/run/secrets/postgres_backup_password}")"

sql_file="/opt/nexus-postgres/ops/observe.sql"
if [ ! -f "$sql_file" ]; then
  sql_file="/opt/nexus-postgres/observe.sql"
fi

db_available=0
db_json=""
if db_raw=$(psql -X -At -f "$sql_file" 2>/dev/null); then
  if [ -n "$db_raw" ]; then
    db_json="$db_raw"
    db_available=1
  fi
fi

if [ "$db_available" -eq 0 ]; then
  db_json='{"available":false}'
fi

# 2. Backup status
backup_status_file="${POSTGRES_BACKUP_STATUS_FILE:-/var/lib/nexus-backup/status/last-backup.json}"
backup_rpo_compliant=false
backup_state="missing"
backup_timestamp="null"
backup_age="null"
backup_sha="null"
backup_bytes="null"

if [ -f "$backup_status_file" ]; then
  raw_status=$(extract_field "$backup_status_file" "status")
  raw_ts=$(extract_field "$backup_status_file" "timestamp")
  raw_sha=$(extract_field "$backup_status_file" "archive_sha256")
  raw_bytes=$(extract_field "$backup_status_file" "archive_bytes")

  if [ -n "$raw_ts" ]; then
    ts_sec=$(date -d "$raw_ts" +%s 2>/dev/null || echo 0)
    if [ "$ts_sec" -gt 0 ]; then
      backup_age=$((now_sec - ts_sec))
      backup_timestamp="\"$raw_ts\""
    fi
  fi

  if [ -n "$raw_sha" ]; then
    backup_sha="\"$raw_sha\""
  fi

  if [ -n "$raw_bytes" ]; then
    backup_bytes="$raw_bytes"
  fi

  if [ "$raw_status" = "ok" ]; then
    if [ "$backup_age" != "null" ] && [ "$backup_age" -le 3600 ]; then
      backup_rpo_compliant=true
      backup_state="ok"
    else
      backup_state="expired"
    fi
  else
    backup_state="error"
  fi
fi

# 3. Restore drill status
drill_status_file="${POSTGRES_RESTORE_STATUS_FILE:-/var/lib/nexus-backup/status/last-restore-drill.json}"
drill_rto_compliant=false
drill_state="missing"
drill_timestamp="null"
drill_age="null"
drill_duration="null"

if [ -f "$drill_status_file" ]; then
  raw_drill_status=$(extract_field "$drill_status_file" "status")
  raw_drill_ts=$(extract_field "$drill_status_file" "timestamp")
  raw_duration=$(extract_field "$drill_status_file" "duration_seconds")
  raw_rto_compliant=$(extract_field "$drill_status_file" "rto_compliant")

  if [ -n "$raw_drill_ts" ]; then
    drill_ts_sec=$(date -d "$raw_drill_ts" +%s 2>/dev/null || echo 0)
    if [ "$drill_ts_sec" -gt 0 ]; then
      drill_age=$((now_sec - drill_ts_sec))
      drill_timestamp="\"$raw_drill_ts\""
    fi
  fi

  if [ -n "$raw_duration" ]; then
    drill_duration="$raw_duration"
  fi

  if [ "$raw_drill_status" = "ok" ] && [ "$raw_rto_compliant" = "true" ]; then
    drill_rto_compliant=true
    drill_state="ok"
  else
    drill_state="failed"
  fi
fi

# 4. Overall compliance
if [ "$db_available" -eq 1 ] && [ "$backup_rpo_compliant" = "true" ] && [ "$drill_rto_compliant" = "true" ]; then
  compliance_status="healthy"
  exit_code=0
else
  compliance_status="critical"
  exit_code=1
fi

cat <<EOF
{
  "database": $db_json,
  "backup": {
    "status": "$backup_state",
    "timestamp": $backup_timestamp,
    "age_seconds": $backup_age,
    "archive_sha256": $backup_sha,
    "archive_bytes": $backup_bytes
  },
  "restore_drill": {
    "status": "$drill_state",
    "timestamp": $drill_timestamp,
    "age_seconds": $drill_age,
    "duration_seconds": $drill_duration,
    "rto_compliant": $drill_rto_compliant
  },
  "compliance": {
    "status": "$compliance_status",
    "generated_at": "$iso_now",
    "rpo_compliant": $backup_rpo_compliant,
    "rto_compliant": $drill_rto_compliant,
    "rpo_target_seconds": 3600,
    "rto_target_seconds": 7200
  }
}
EOF

exit "$exit_code"
