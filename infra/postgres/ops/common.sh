#!/bin/sh
set -eu

umask 077

read_secret() {
  secret_path="$1"
  if [ ! -r "$secret_path" ]; then
    printf 'required secret is not readable: %s\n' "$secret_path" >&2
    exit 1
  fi

  IFS= read -r secret_value < "$secret_path" || true
  if [ -z "${secret_value:-}" ]; then
    printf 'required secret is empty: %s\n' "$secret_path" >&2
    exit 1
  fi
  printf '%s' "$secret_value"
}

write_status() {
  status_file="$1"
  json_content="$2"
  status_dir="$(dirname "$status_file")"

  require_directory "$status_dir"
  tmp_file="${status_file}.tmp.$$"
  printf '%s\n' "$json_content" > "$tmp_file"
  mv -f "$tmp_file" "$status_file"
}

require_directory() {
  dir_path="$1"
  if [ ! -d "$dir_path" ]; then
    printf 'required directory does not exist or is not a directory: %s\n' "$dir_path" >&2
    exit 1
  fi
}
