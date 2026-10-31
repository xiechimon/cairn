#!/bin/bash
set -euo pipefail
REPO=~/Code/AgentProjects/cairn
cd "$REPO"
git fetch -q origin main
git checkout -q --detach origin/main
start=$(date +%s)
flock /tmp/cairn-heavy.lock sh -c 'pnpm install --frozen-lockfile >/tmp/deploy.log 2>&1 && pnpm -C apps/daemon build >>/tmp/deploy.log 2>&1 && pnpm -C apps/web build >>/tmp/deploy.log 2>&1' || { tail -20 /tmp/deploy.log; exit 1; }
git checkout -q pnpm-lock.yaml
for f in apps/daemon/dist/cli.mjs; do
  [ "$(stat -c %Y "$f")" -ge "$start" ] || { echo "stale build output: $f"; exit 1; }
done
echo "built $(git log -1 --format='%h %s')"
[ "${1:-}" = "--restart" ] || exit 0
systemctl --user restart cairn-server
sleep 8
systemctl --user restart cairn-daemon
systemctl --user is-active cairn-server cairn-daemon
