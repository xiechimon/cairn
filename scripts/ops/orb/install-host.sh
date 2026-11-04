#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
node_bin=$(command -v node || true)
if [[ -z $node_bin && ${1:-} != --dry-run ]]; then
  node_bin=$(runuser -u ian -- bash -lc 'command -v node')
fi
[[ -n $node_bin && -x $node_bin ]] || { printf 'Node >=22.19 is required to run the installer\n' >&2; exit 1; }
export HTTP_PROXY=${HTTP_PROXY:-http://127.0.0.1:7890}
export HTTPS_PROXY=${HTTPS_PROXY:-$HTTP_PROXY}
export http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY
exec "$node_bin" "$script_dir/install-host.mjs" "$@"
