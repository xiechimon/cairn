#!/usr/bin/env bash
set -euo pipefail
umask 077

if [ "$#" != 1 ] || ! [[ "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'usage: bootstrap-deploy.sh <40-hex SHA on origin/main>' >&2
  exit 2
fi

CHECKOUT="${CAIRN_CHECKOUT:-$HOME/Code/AgentProjects/cairn-exec}"
STATE="${CAIRN_DEPLOY_STATE:-$HOME/.local/state/cairn-deploy}"
TARGET="$1"
git -C "$CHECKOUT" fetch -q origin main
if ! git -C "$CHECKOUT" merge-base --is-ancestor "$TARGET" origin/main; then
  echo 'refused: bootstrap target is not on origin/main' >&2
  exit 2
fi

mkdir -p "$STATE"
runner="$(mktemp "$STATE/deploy-bootstrap.XXXXXX")"
trap 'rm -f "$runner"' EXIT
git -C "$CHECKOUT" show "$TARGET:scripts/ops/deploy-self.sh" >"$runner"
CAIRN_DEPLOY_RUNNING_COPY=1 exec bash "$runner" "$TARGET"
