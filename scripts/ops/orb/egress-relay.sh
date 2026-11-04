#!/usr/bin/env bash
set -euo pipefail

[[ $# == 0 || ( $# == 1 && $1 == --dry-run ) ]] || { printf 'Usage: egress-relay.sh [--dry-run]\n' >&2; exit 2; }
bridge_ip=$(ip -o -4 address show dev vz-cairn | awk '{split($4, address, "/"); print address[1]}')
[[ $bridge_ip == 10.203.0.1 ]] || { printf 'vz-cairn is not ready at 10.203.0.1\n' >&2; exit 1; }
printf 'filtering relay %s:7890 via 127.0.0.1:7890\n' "$bridge_ip"
if [[ ${1:-} != --dry-run ]]; then
  script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  exec "${CAIRN_ORB_NODE:-node}" "$script_dir/egress-relay.mjs"
fi
