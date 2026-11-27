#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  set -- node dist/index.mjs
fi

bucket=$(printf '%s' "${CAIRN_LITESTREAM_BUCKET:-}" | tr -d '[:space:]')
if [ -z "$bucket" ] || [ "$#" -ne 2 ] || [ "$1" != "node" ] || [ "$2" != "dist/index.mjs" ]; then
  exec "$@"
fi

cairn_home="${CAIRN_HOME:-/data}"
req=$(printf '%s' "${CAIRN_REQUIRE_TOKEN:-}" | tr '[:upper:]' '[:lower:]')
if { [ "$req" = "1" ] || [ "$req" = "true" ] || [ "$req" = "yes" ]; } \
  && [ -z "${CAIRN_TOKEN:-}" ] \
  && [ ! -f "${cairn_home}/token" ]; then
  exec "$@"
fi

if [ -f /app/litestream-config.mjs ]; then
  config_script=/app/litestream-config.mjs
else
  config_script="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/litestream-config.mjs"
fi

db_path="${cairn_home}/server/server.db"
cfg=$(mktemp "${TMPDIR:-/tmp}/litestream-XXXXXX")
chmod 600 "$cfg"

if ! node "$config_script" "$db_path" "$cfg"; then
  rm -f "$cfg"
  exit 1
fi

mkdir -p "${cairn_home}/server"
rc=0
litestream restore -if-db-not-exists -if-replica-exists -config "$cfg" "$db_path" || rc=$?
if [ "$rc" -ne 0 ]; then
  rm -f "$cfg"
  exit "$rc"
fi

exec litestream replicate -config "$cfg" -exec "node dist/index.mjs"
