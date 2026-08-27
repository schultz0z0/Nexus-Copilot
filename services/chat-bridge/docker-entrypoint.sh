#!/usr/bin/env sh
set -eu

mkdir -p /app/data/runs /app/data/hermes-image-inputs /app/data/hermes-artifacts
chown node:node /app/data 2>/dev/null || true
chown -R node:node /app/data/runs /app/data/hermes-image-inputs 2>/dev/null || true
chown node:node /app/data/hermes-artifacts 2>/dev/null || true

exec su-exec node "$@"
