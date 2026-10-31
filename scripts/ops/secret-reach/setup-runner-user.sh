#!/bin/sh
set -eu
case "${1-}" in
  '') [ "$#" -eq 0 ] || { printf '%s\n' 'Usage: setup-runner-user.sh [--dry-run]' >&2; exit 2; } ;;
  --dry-run) [ "$#" -eq 1 ] || { printf '%s\n' 'Usage: setup-runner-user.sh [--dry-run]' >&2; exit 2; } ;;
  *) printf '%s\n' 'Usage: setup-runner-user.sh [--dry-run]' >&2; exit 2 ;;
esac
exec node "$(dirname "$0")/setup-runner-user.mjs" "$@"
