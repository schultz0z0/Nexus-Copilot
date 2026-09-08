#!/bin/sh
set -eu

profile_name="${HERMES_PROFILE_NAME:-ens}"
distribution_dir="${HERMES_DISTRIBUTION_DIR:-/distribution}"
hermes_cli="${HERMES_CLI:-hermes}"

test -f "${distribution_dir}/distribution.yaml"

if "${hermes_cli}" profile info "${profile_name}" >/dev/null 2>&1; then
  "${hermes_cli}" profile update "${profile_name}" --yes
else
  "${hermes_cli}" profile install "${distribution_dir}" --name "${profile_name}" --yes
fi

"${hermes_cli}" profile use "${profile_name}"
"${hermes_cli}" profile info "${profile_name}"
