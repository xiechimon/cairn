#!/bin/sh
set -eu
case "${1-}" in
  '') [ "$#" -eq 0 ] || { printf '%s\n' 'Usage: setup-runner-user.sh [--dry-run]' >&2; exit 2; } ;;
  --dry-run) [ "$#" -eq 1 ] || { printf '%s\n' 'Usage: setup-runner-user.sh [--dry-run]' >&2; exit 2; } ;;
  *) printf '%s\n' 'Usage: setup-runner-user.sh [--dry-run]' >&2; exit 2 ;;
esac
node="${SECRET_REACH_SYSTEM_NODE:-/usr/bin/node}"
if ! [ -x "$node" ]; then
  printf '%s\n' "setup-runner-user.sh needs a root-owned system Node at $node (on Arch: pacman -S --needed nodejs); a per-user Node such as mise or fnm is not used under sudo" >&2
  exit 2
fi
exec "$node" "$(dirname "$0")/setup-runner-user.mjs" "$@"
