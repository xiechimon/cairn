#!/usr/bin/env bash
set -uo pipefail
umask 077

CHECKOUT="${CAIRN_CHECKOUT:-$HOME/Code/AgentProjects/cairn}"
STATE="${CAIRN_DEPLOY_STATE:-$HOME/.local/state/cairn-deploy}"
REPO="${CAIRN_REPO:-xiechimon/cairn}"
REQUIRED_CHECKS="${CAIRN_REQUIRED_CHECKS:-check pack-smoke e2e-gate}"
LAG_LIMIT_SECONDS="${CAIRN_DEPLOY_LAG_LIMIT_SECONDS:-7200}"
SCAN_DEPTH="${CAIRN_DEPLOY_SCAN_DEPTH:-20}"
DEPLOY_SCRIPT="${CAIRN_DEPLOY_SCRIPT:-$CHECKOUT/scripts/ops/deploy-self.sh}"
LAG_TITLE="deploy lag: omarchy is behind main"

mkdir -p "$STATE/alarms"
if [ "${CAIRN_DEPLOY_WATCH_RUNNING_COPY:-}" != 1 ]; then
  running_copy="$(mktemp "$STATE/deploy-watch.running.XXXXXX")"
  cp "$0" "$running_copy"
  CAIRN_DEPLOY_WATCH_RUNNING_COPY=1 exec bash "$running_copy" "$@"
fi
trap 'rm -f "$0"' EXIT

log() { echo "$(date -u +%FT%TZ) $*"; }

green() {
  local checks name
  checks="$(gh api "repos/$REPO/commits/$1/check-runs?per_page=100" --jq '.check_runs[] | "\(.name)\t\(.conclusion)"')" || return 1
  for name in $REQUIRED_CHECKS; do
    grep -qxF "$name"$'\t'success <<<"$checks" || return 1
  done
}

newest_green_after() {
  local deployed="$1" sha
  for sha in $(git -C "$CHECKOUT" rev-list --first-parent --max-count="$SCAN_DEPTH" "$deployed..origin/main"); do
    if [ -e "$STATE/failed/$sha" ]; then
      log "skip $sha: already failed ($(head -n1 "$STATE/failed/$sha"))" >&2
    elif green "$sha"; then
      echo "$sha"
      return 0
    fi
  done
}

deploy_newest_green() {
  local deployed target
  if [ -e "$STATE/in-progress" ]; then
    log "recovering an interrupted deploy"
    CAIRN_DEPLOY_RUNNING_COPY= bash "$DEPLOY_SCRIPT" --recover >>"$STATE/last-attempt.log" 2>&1 ||
      echo "$(date -u +%FT%TZ) recovery exit $?" >"$STATE/last-attempt"
    [ ! -e "$STATE/in-progress" ] || return 0
  fi
  deployed="$(git -C "$CHECKOUT" rev-parse HEAD)"
  target="$(newest_green_after "$deployed")"
  [ -n "$target" ] || return 0
  log "deploying $target"
  local status=0
  CAIRN_DEPLOY_RUNNING_COPY= bash "$DEPLOY_SCRIPT" "$target" >>"$STATE/last-attempt.log" 2>&1 || status=$?
  echo "$(date -u +%FT%TZ) $target exit $status" >"$STATE/last-attempt"
  log "deploy of $target exited $status"
}

lag_reason() {
  if [ -e "$STATE/hold" ]; then
    echo "a deploy hold is set: $(head -n1 "$STATE/hold")"
  elif [ -s "$STATE/last-attempt" ]; then
    echo "last attempt: $(cat "$STATE/last-attempt"); see $STATE/last-attempt.log on the host"
  else
    echo "no green main commit newer than the deployed one, or no attempt yet"
  fi
}

check_lag() {
  local deployed head oldest committed age open_issue
  deployed="$(git -C "$CHECKOUT" rev-parse HEAD)"
  head="$(git -C "$CHECKOUT" rev-parse origin/main)"
  open_issue="$(gh issue list -R "$REPO" --state open --author "@me" --search "\"$LAG_TITLE\" in:title" --json number --jq '.[0].number // empty')"
  if [ "$deployed" = "$head" ]; then
    if [ -n "$open_issue" ]; then
      gh issue close "$open_issue" -R "$REPO" -c "Caught up: omarchy runs $head." >/dev/null && log "closed lag issue #$open_issue"
    fi
    return 0
  fi
  oldest="$(git -C "$CHECKOUT" rev-list --reverse --first-parent "$deployed..origin/main" | head -n1)"
  committed="$(git -C "$CHECKOUT" show -s --format=%ct "$oldest")"
  age=$(($(date +%s) - committed))
  [ "$age" -gt "$LAG_LIMIT_SECONDS" ] || return 0
  [ ! -e "$STATE/alarms/$head" ] || return 0
  local body
  body="$(printf 'omarchy runs `%s`; origin/main is `%s`. The oldest undeployed main commit `%s` landed %s minutes ago (limit %s).\n\nReason: %s\n\nOpened by deploy-watch on omarchy; closed automatically once the deployed SHA equals main.' \
    "$deployed" "$head" "$oldest" "$((age / 60))" "$((LAG_LIMIT_SECONDS / 60)) minutes" "$(lag_reason)")"
  if [ -n "$open_issue" ]; then
    gh issue comment "$open_issue" -R "$REPO" -b "$body" >/dev/null || return 0
    log "commented lag issue #$open_issue"
  else
    gh issue create -R "$REPO" -t "$LAG_TITLE" -b "$body" -a xiechimon >/dev/null || return 0
    log "opened lag issue"
  fi
  touch "$STATE/alarms/$head"
}

git -C "$CHECKOUT" fetch -q origin main || { log "fetch failed"; exit 1; }
deploy_newest_green
check_lag
