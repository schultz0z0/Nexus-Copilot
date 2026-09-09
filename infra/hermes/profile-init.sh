#!/bin/sh
set -eu

profile_name="${HERMES_PROFILE_NAME:-ens}"
distribution_dir="${HERMES_DISTRIBUTION_DIR:-/distribution}"
hermes_cli="${HERMES_CLI:-hermes}"
hermes_home="${HERMES_HOME:-/opt/data}"
hermes_python="${HERMES_PYTHON:-/opt/hermes/.venv/bin/python}"
config_migrator="${HERMES_CONFIG_MIGRATOR:-/opt/hermes/scripts/docker_config_migrate.py}"
config_schema_floor="${HERMES_CONFIG_SCHEMA_FLOOR:-12}"

migrate_config() {
  target_profile="$1"
  target_home="$2"
  config_path="${target_home}/config.yaml"

  test -f "${config_path}"
  version_line="$(grep '^_config_version:' "${config_path}" | sed -n '1p' || true)"
  raw_version="$(printf '%s' "${version_line#*:}" | tr -d '[:space:]"' | tr -d "'")"

  if [ -z "${version_line}" ]; then
    "${hermes_cli}" -p "${target_profile}" config set _config_version "${config_schema_floor}"
  else
    case "${raw_version}" in
      ''|*[!0-9]*)
        echo "Invalid _config_version in ${config_path}" >&2
        exit 1
        ;;
    esac
    if [ "${raw_version}" -lt "${config_schema_floor}" ]; then
      echo "Config schema ${raw_version} in ${config_path} is below the supported floor ${config_schema_floor}; migrate it manually before deployment" >&2
      exit 1
    fi
  fi

  HERMES_HOME="${target_home}" "${hermes_python}" "${config_migrator}"
}

test -f "${distribution_dir}/distribution.yaml"

if "${hermes_cli}" profile info "${profile_name}" >/dev/null 2>&1; then
  "${hermes_cli}" profile update "${profile_name}" --yes
else
  "${hermes_cli}" profile install "${distribution_dir}" --name "${profile_name}" --yes
fi

# The Docker image's non-interactive migrator currently treats an unversioned
# seeded config as pre-v12. Stamp only unversioned configs, refuse genuinely
# old explicit versions, then let the official migrator advance both homes.
migrate_config default "${hermes_home}"
migrate_config "${profile_name}" "${hermes_home}/profiles/${profile_name}"

# The product owns one named ENS gateway. Persist the unused default gateway as
# stopped so the official boot reconciler cannot race ENS for the API port.
"${hermes_cli}" -p default gateway stop
"${hermes_cli}" profile use "${profile_name}"
"${hermes_cli}" profile info "${profile_name}"
