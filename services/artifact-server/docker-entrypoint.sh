#!/usr/bin/env sh
set -eu

mkdir -p /app/data/metadata /app/data/objects /app/data/tmp
chown -R node:node /app/data

exec su-exec node "$@"
