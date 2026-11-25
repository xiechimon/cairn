#!/usr/bin/env bash
set -euo pipefail
umask 077

BUILD_CHECKOUT="${CAIRN_DEPLOY_BUILD_CHECKOUT:-${CAIRN_CHECKOUT:-$HOME/deploy-build}}"
APP_ROOT="${CAIRN_DEPLOY_APP_ROOT:-$HOME/cairn-server}"
STATE="${CAIRN_DEPLOY_STATE:-$HOME/.local/state/cairn-deploy}"
REPO="${CAIRN_REPO:-xiechimon/cairn}"
REQUIRED_CHECKS="${CAIRN_REQUIRED_CHECKS:-check pack-smoke e2e-gate}"
SCAN_COMMITS="${CAIRN_DEPLOY_SCAN_COMMITS:-50}"
LAG_LIMIT_SECONDS="${CAIRN_DEPLOY_LAG_LIMIT_SECONDS:-7200}"
MACHINE_NAME="${CAIRN_DEPLOY_MACHINE_NAME:-$(hostname -s)}"
LAG_ISSUES="${CAIRN_DEPLOY_LAG_ISSUES:-0}"
GH_WRAPPER="${CAIRN_GH_WRAPPER:-}"

mkdir -p "$STATE"
if [ "${CAIRN_DEPLOY_WATCH_COPY:-}" != 1 ]; then
  ops_dir="$(cd "$(dirname "$0")" && pwd)"
  running_dir="$(mktemp -d "$STATE/deploy-watch.running.XXXXXX")"
  cp "$0" "$running_dir/deploy-watch.sh"
  cp "$ops_dir/deploy-self.sh" "$ops_dir/github-ci-evidence.mjs" "$ops_dir/stage-server-artifact.mjs" "$running_dir/"
  CAIRN_DEPLOY_WATCH_COPY=1 CAIRN_DEPLOY_WATCH_COPY_DIR="$running_dir" exec bash "$running_dir/deploy-watch.sh" "$@"
fi
OPS_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNING_DIR="$(dirname "$0")"
trap 'if [ "${CAIRN_DEPLOY_WATCH_COPY_DIR:-}" = "$RUNNING_DIR" ]; then rm -rf "$RUNNING_DIR"; fi' EXIT

log() { echo "$(date -u +%FT%TZ) $*"; }

lag_reason() {
  if [ -e "$STATE/hold" ]; then
    echo "a deploy hold is set: $(head -n1 "$STATE/hold")"
  elif [ -s "$STATE/last-attempt" ] && [ -s "$STATE/last-reason" ]; then
    echo "last attempt: $(cat "$STATE/last-attempt"); $(cat "$STATE/last-reason")"
  elif [ -s "$STATE/last-attempt" ]; then
    echo "last attempt: $(cat "$STATE/last-attempt")"
  else
    echo "no green main commit newer than the deployed one, or no attempt yet"
  fi
}

gh_command() {
  if [ -n "$GH_WRAPPER" ]; then "$GH_WRAPPER" gh "$@"; else command gh "$@"; fi
}

check_lag() {
  [ "$LAG_ISSUES" = 1 ] || return 0
  command -v gh >/dev/null 2>&1 || [ -n "$GH_WRAPPER" ] || return 0
  local head oldest committed age open_issue title body
  head="$(git -C "$BUILD_CHECKOUT" rev-parse origin/main)"
  title="deploy lag: $MACHINE_NAME is behind main"
  open_issue="$(gh_command issue list -R "$REPO" --state open --author "@me" --search "\"$title\" in:title" --json number --jq '.[0].number // empty' 2>/dev/null)" || return 0
  if [ "$deployed" = "$head" ]; then
    if [ -n "$open_issue" ]; then
      gh_command issue close "$open_issue" -R "$REPO" -c "Caught up: $MACHINE_NAME runs $head." >/dev/null 2>&1 || true
    fi
    return 0
  fi
  oldest="$(git -C "$BUILD_CHECKOUT" rev-list --reverse --first-parent "$deployed..origin/main" 2>/dev/null | head -n1)"
  [ -n "$oldest" ] || return 0
  committed="$(git -C "$BUILD_CHECKOUT" show -s --format=%ct "$oldest")"
  age=$(($(date +%s) - committed))
  [ "$age" -gt "$LAG_LIMIT_SECONDS" ] || return 0
  mkdir -p "$STATE/alarms"
  [ ! -e "$STATE/alarms/$head" ] || return 0
  body="$(printf '%s runs `%s`; origin/main is `%s`. The oldest undeployed main commit `%s` landed %s minutes ago (limit %s).\n\nReason: %s\n\nOpened by deploy-watch; closed automatically once the deployed SHA equals main.' \
    "$MACHINE_NAME" "$deployed" "$head" "$oldest" "$((age / 60))" "$((LAG_LIMIT_SECONDS / 60)) minutes" "$(lag_reason)")"
  if [ -n "$open_issue" ]; then
    gh_command issue comment "$open_issue" -R "$REPO" -b "$body" >/dev/null 2>&1 || return 0
  else
    gh_command issue create -R "$REPO" -t "$title" -b "$body" >/dev/null 2>&1 || return 0
  fi
  touch "$STATE/alarms/$head"
}

git -C "$BUILD_CHECKOUT" fetch -q origin main
raw=""
[ -f "$APP_ROOT/DEPLOYED_SHA" ] && raw="$(head -n1 "$APP_ROOT/DEPLOYED_SHA" | tr -d '[:space:]')"
[ -n "$raw" ] || { echo "cannot read $APP_ROOT/DEPLOYED_SHA" >&2; exit 1; }
deployed="$(git -C "$BUILD_CHECKOUT" rev-parse --verify "$raw^{commit}" 2>/dev/null)" || {
  echo "cannot resolve deployed SHA $raw" >&2
  exit 1
}
check_lag || true
if [ "$deployed" = "$(git -C "$BUILD_CHECKOUT" rev-parse origin/main)" ]; then
  exit 0
fi
if [ -e "$STATE/in-progress" ]; then
  log "recovering an interrupted deploy"
  CAIRN_DEPLOY_RUNNING_COPY= bash "$OPS_DIR/deploy-self.sh" --recover
  exit $?
fi
if [ -e "$STATE/hold" ]; then
  log "holding: $(head -n1 "$STATE/hold")"
  exit 0
fi

range="$deployed..origin/main"
if ! git -C "$BUILD_CHECKOUT" merge-base --is-ancestor "$deployed" origin/main; then
  range="origin/main"
fi
required_csv="${REQUIRED_CHECKS// /,}"
target=""
while read -r sha; do
  [ ! -e "$STATE/failed/$sha" ] || continue
  if node "$OPS_DIR/github-ci-evidence.mjs" --repo "$REPO" --sha "$sha" --required "$required_csv" --state "$STATE" >/dev/null 2>&1; then
    target="$sha"
    break
  fi
done < <(git -C "$BUILD_CHECKOUT" rev-list --first-parent --max-count "$SCAN_COMMITS" "$range")

[ -n "$target" ] || exit 0
log "deploying $target (currently $deployed)"
set +e
CAIRN_DEPLOY_RUNNING_COPY= bash "$OPS_DIR/deploy-self.sh" "$target"
status=$?
set -e
printf 'target=%s\nstatus=%s\nat=%s\n' "$target" "$status" "$(date -u +%FT%TZ)" >"$STATE/last-attempt"
exit "$status"
