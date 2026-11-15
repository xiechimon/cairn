#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dry_run=false
owner=
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case ${args[i]} in
    --dry-run) dry_run=true ;;
    --owner) owner=${args[i + 1]:-} ;;
  esac
done
owner_pattern='^[a-z_][a-z0-9_-]{0,31}$'
if [[ -z $owner && -f /etc/cairn-orb/owner && ! -L /etc/cairn-orb/owner ]]; then owner=$(</etc/cairn-orb/owner); fi
if [[ -z $owner ]]; then owner=${SUDO_USER:-}; fi
if ! [[ $owner =~ $owner_pattern && $owner != root ]] || ! id -u "$owner" >/dev/null 2>&1; then
  printf 'Cannot choose the orb owner "%s"; pass --owner <user> or run through sudo as the owner account\n' "$owner" >&2
  exit 1
fi
node_bin=$(command -v node || true)
if [[ -z $node_bin && $dry_run == false ]]; then
  node_bin=$(runuser -u "$owner" -- bash -lc 'command -v node')
fi
[[ -n $node_bin && -x $node_bin ]] || { printf 'Node >=22.19 is required to run the installer\n' >&2; exit 1; }
export HTTP_PROXY=${HTTP_PROXY:-http://127.0.0.1:7890}
export HTTPS_PROXY=${HTTPS_PROXY:-$HTTP_PROXY}
export http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY
exec "$node_bin" "$script_dir/install-host.mjs" "$@"
