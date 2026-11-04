#!/bin/sh
set -eu
case "${1-}" in
  '') [ "$#" -eq 0 ] || { printf '%s\n' 'Usage: install.sh [--dry-run]' >&2; exit 2; } ;;
  --dry-run) [ "$#" -eq 1 ] || { printf '%s\n' 'Usage: install.sh [--dry-run]' >&2; exit 2; } ;;
  *) printf '%s\n' 'Usage: install.sh [--dry-run]' >&2; exit 2 ;;
esac
node=/usr/bin/node
if ! [ -x "$node" ]; then
  printf '%s\n' "install.sh needs the root-owned system Node at $node (on Arch: pacman -S --needed nodejs)" >&2
  exit 2
fi
exec /usr/bin/env -i PATH=/usr/bin "$node" "$(dirname "$0")/install.mjs" "$@"
