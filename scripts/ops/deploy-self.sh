#!/usr/bin/env bash
set -euo pipefail
umask 077

unset GH_TOKEN GITHUB_TOKEN
for credential_variable in ${!GIT_CONFIG_@}; do
  case "$credential_variable" in
    GIT_CONFIG_COUNT | GIT_CONFIG_KEY_* | GIT_CONFIG_VALUE_* | GIT_CONFIG_PARAMETERS) unset "$credential_variable" ;;
  esac
done
GITHUB_COMMAND_WRAPPER="${CAIRN_GH_WRAPPER:-$HOME/.cairn/tools/app-token/as-bot.sh}"

gh() {
  "$GITHUB_COMMAND_WRAPPER" gh "$@"
}

usage() {
  cat >&2 <<'EOF'
usage: deploy-self.sh <40-hex sha on origin/main> | --recover

Deploys one green main commit to this host's cairn checkout and user units, with rollback.
  1. refuses a SHA not on origin/main, without every required check green, while autonomy
     is paused, or whose pnpm-workspace.yaml allows a new install script (exit 2)
  2. respects $CAIRN_DEPLOY_STATE/hold; daemon changes pause claims with a durable lease
     and drain within CAIRN_DEPLOY_STEP_WAIT_SECONDS (exit 75 on timeout), always resuming
  3. rehearses the target's migrations on an online copy of the live DB in a scratch worktree
  4. checks out the target, installs with --frozen-lockfile, builds the daemon and web assets
  5. stops daemon and server, snapshots the DB, starts server then daemon, health-checks both
  6. on a failed health check restores the snapshot and the previous checkout (exit 1;
     exit 3 when the rollback itself is unhealthy)
An interrupted deploy leaves $CAIRN_DEPLOY_STATE/in-progress; the next run (or --recover) health-checks
the target and finishes it or rolls it back before doing anything else.
Writes the result to $CAIRN_DEPLOY_STATE/deployed.json and $CAIRN_DATA_DIR/deploy.json.
After each record, if $CAIRN_DEPLOY_NOTIFY (default $CAIRN_DEPLOY_STATE/notify.sh) is
executable, feeds that JSON on stdin. A missing, non-executable, failing or timed-out
notify never changes the deploy exit status.

Environment (defaults in brackets):
  CAIRN_CHECKOUT [~/Code/AgentProjects/cairn-exec]  CAIRN_DATA_DIR [~/.cairn/server]
  CAIRN_DEPLOY_STATE [~/.local/state/cairn-deploy]  CAIRN_DEPLOY_BACKUPS [~/backups/cairn-server/predeploy]
  CAIRN_DEPLOY_SCRATCH [$CAIRN_DEPLOY_STATE/scratch]  CAIRN_REPO [xiechimon/cairn]
  CAIRN_REQUIRED_CHECKS [check pack-smoke e2e-gate]  CAIRN_HEALTH_URL [http://127.0.0.1:8787]
  CAIRN_HEALTH_TRIES [60]  CAIRN_HEALTH_INTERVAL [2]  CAIRN_MACHINE_NAME [hostname -s]
  CAIRN_DEPLOY_KEEP_SNAPSHOTS [10]  CAIRN_DEPLOY_STEP_WAIT_SECONDS [1800]
  CAIRN_DEPLOY_NOTIFY [$CAIRN_DEPLOY_STATE/notify.sh]
  CAIRN_DEPLOY_NOTIFY_TIMEOUT [5]
  CAIRN_GH_WRAPPER [~/.cairn/tools/app-token/as-bot.sh]
  CAIRN_DEPLOY_TOKEN_FILE [~/.cairn/token]
EOF
  exit 2
}

CHECKOUT="${CAIRN_CHECKOUT:-$HOME/Code/AgentProjects/cairn-exec}"
DATA_DIR="${CAIRN_DATA_DIR:-$HOME/.cairn/server}"
STATE="${CAIRN_DEPLOY_STATE:-$HOME/.local/state/cairn-deploy}"
BACKUPS="${CAIRN_DEPLOY_BACKUPS:-$HOME/backups/cairn-server/predeploy}"
SCRATCH="${CAIRN_DEPLOY_SCRATCH:-$STATE/scratch}"
REPO="${CAIRN_REPO:-xiechimon/cairn}"
REQUIRED_CHECKS="${CAIRN_REQUIRED_CHECKS:-check pack-smoke e2e-gate}"
HEALTH_URL="${CAIRN_HEALTH_URL:-http://127.0.0.1:8787}"
HEALTH_TRIES="${CAIRN_HEALTH_TRIES:-60}"
HEALTH_INTERVAL="${CAIRN_HEALTH_INTERVAL:-2}"
MACHINE_NAME="${CAIRN_MACHINE_NAME:-$(hostname -s)}"
KEEP_SNAPSHOTS="${CAIRN_DEPLOY_KEEP_SNAPSHOTS:-10}"
NOTIFY_HOOK="${CAIRN_DEPLOY_NOTIFY:-$STATE/notify.sh}"
NOTIFY_TIMEOUT="${CAIRN_DEPLOY_NOTIFY_TIMEOUT:-5}"
STEP_WAIT_SECONDS="${CAIRN_DEPLOY_STEP_WAIT_SECONDS:-1800}"
TOKEN_FILE="${CAIRN_DEPLOY_TOKEN_FILE:-$HOME/.cairn/token}"
HOST_TOOLS_ROOT="${CAIRN_HOST_TOOLS_ROOT:-$HOME/.cairn/tools}"
HOST_LANES_ROOT="${CAIRN_HOST_LANES_ROOT:-$HOME/lanes}"
HOST_BIN_ROOT="${CAIRN_HOST_BIN_ROOT:-$HOME/.local/bin}"
HOST_UNITS_ROOT="${CAIRN_HOST_UNITS_ROOT:-$HOME/.config/systemd/user}"
HOST_TOOLS_ALARM_TITLE="Host tools differ from main"
SERVER_UNIT=cairn-server.service
DAEMON_UNIT=cairn-daemon.service
ORB_UNIT=cairn-daemon-orb.service
ORB_ALARM_TITLE="Orb daemon needs attention"
DB="$DATA_DIR/server.db"

EXIT_REFUSED=2
EXIT_BUSY=75
EXIT_ROLLBACK_UNHEALTHY=3

[ $# -eq 1 ] || usage
RECOVER_ONLY=0
TARGET="$1"
if [ "$TARGET" = --recover ]; then
  RECOVER_ONLY=1
  TARGET=""
else
  [[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo "refused: '$TARGET' is not a full 40-hex SHA" >&2; exit "$EXIT_REFUSED"; }
fi

mkdir -p "$STATE"
if [ "${CAIRN_DEPLOY_RUNNING_COPY:-}" != 1 ]; then
  running_copy="$(mktemp "$STATE/deploy-self.running.XXXXXX")"
  cp "$0" "$running_copy"
  CAIRN_DEPLOY_RUNNING_COPY=1 exec bash "$running_copy" "$@"
fi
RUNNING_COPY="$0"

log() { echo "$(date -u +%FT%TZ) $*"; }
refuse() { echo "refused: $*" >&2; exit "$EXIT_REFUSED"; }
busy() { printf '%s\n' "$*" >"$STATE/last-reason"; echo "busy: $*" >&2; exit "$EXIT_BUSY"; }

LOCK="$STATE/lock"
trap 'rm -f "$RUNNING_COPY"' EXIT
if ! mkdir "$LOCK" 2>/dev/null; then
  holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$holder" ]; then
    ! kill -0 "$holder" 2>/dev/null || busy "deploy already running (pid $holder)"
  elif [ -z "$(find "$LOCK" -maxdepth 0 -mmin +10)" ]; then
    busy "deploy lock is being taken"
  fi
  mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null || busy "deploy lock reclaimed concurrently"
  rm -rf "$LOCK.stale.$$"
  mkdir "$LOCK" 2>/dev/null || busy "deploy lock taken concurrently"
fi
echo $$ >"$LOCK/pid"
RUNTIME=daemon
LEASE_OWNER=""

health_url_is_loopback() {
  [[ "$HEALTH_URL" =~ ^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?$ ]]
}

owner_token() {
  health_url_is_loopback && [ -r "$TOKEN_FILE" ] || return 0
  sed -nE 's/^[[:space:]]*CAIRN_TOKEN[[:space:]]*=[[:space:]]*//p' "$TOKEN_FILE" | head -n1 |
    sed -E "s/[[:space:]]+$//; s/^\"(.*)\"$/\\1/; s/^'(.*)'$/\\1/"
}

lease_request() {
  local token
  token="$(owner_token)"
  token="${token//\\/\\\\}"
  token="${token//\"/\\\"}"
  { [ -z "$token" ] || printf 'header = "Authorization: Bearer %s"\n' "$token"; } |
    curl -sS --noproxy '*' --max-time 10 -K - -o "$STATE/lease-response" -w '%{http_code}' \
      -H "Origin: $HEALTH_URL" -H 'Content-Type: application/json' "$@" "$HEALTH_URL/api/server/deploy/lease"
}

refuse_lease_status() {
  local status="$1" cause
  case "$status" in
    404) refuse "server lacks the deployment lease endpoint (HTTP 404); bootstrap server-only first" ;;
    401 | 403)
      if ! health_url_is_loopback; then
        cause="it is sent only to a loopback CAIRN_HEALTH_URL, not $HEALTH_URL"
      elif [ ! -r "$TOKEN_FILE" ]; then
        cause="that file is missing or unreadable"
      elif [ -z "$(owner_token)" ]; then
        cause="that file has no CAIRN_TOKEN value"
      else
        cause="the server did not accept it"
      fi
      refuse "server rejected the deployment lease request (HTTP $status); the owner token is read from $TOKEN_FILE and $cause" ;;
    000 | '') refuse "no response to the deployment lease request at $HEALTH_URL within 10s" ;;
    *) refuse "deployment lease request answered HTTP $status" ;;
  esac
}

resume_claims() {
  [ -n "$LEASE_OWNER" ] || return 0
  [[ "$LEASE_OWNER" =~ ^[0-9a-f-]{36}$ ]] || return 1
  lease_request -X DELETE --data-binary "{\"owner\":\"$LEASE_OWNER\"}" >/dev/null 2>&1 || true
  local tables
  tables="$(sqlite3 -readonly "$DB" "select count(*) from sqlite_master where name='deploy_lease'")" || return 1
  if [ "$tables" = 1 ]; then
    sqlite3 -cmd '.timeout 10000' "$DB" "update deploy_lease set status='accepting', expiresAt=0 where id='server' and owner='$LEASE_OWNER';" || return 1
    [ "$(sqlite3 -readonly "$DB" "select count(*) from deploy_lease where id='server' and owner='$LEASE_OWNER' and status='draining' and expiresAt > $(($(date +%s) * 1000))")" = 0 ] || return 1
  fi
  log "claims resumed: owned deployment lease released and read back"
  rm -f "$STATE/lease-owner"
  LEASE_OWNER=""
}

cleanup() {
  local status=$?
  if [ "$status" != 0 ] && [ -f "$STATE/in-progress" ] && grep -qx 'phase=building' "$STATE/in-progress"; then
    switch_code "$PREVIOUS" || log "CRITICAL: restoring the previous checkout failed"
    clear_in_progress
  fi
  if ! resume_claims; then
    echo "CRITICAL: claims resume failed; recover $STATE/lease-owner" >&2
    status=3
  fi
  rm -rf "$LOCK"
  rm -f "$RUNNING_COPY"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
if [ -s "$STATE/lease-owner" ]; then
  LEASE_OWNER="$(cat "$STATE/lease-owner")"
  [[ "$LEASE_OWNER" =~ ^[0-9a-f-]{36}$ ]] || refuse "invalid recovery lease owner"
  if [ ! -e "$STATE/in-progress" ]; then resume_claims || exit 3; fi
fi
rm -f "$STATE/last-reason"

run_notify() {
  local record="$1" status=0
  [ -e "$NOTIFY_HOOK" ] || return 0
  if [ ! -x "$NOTIFY_HOOK" ]; then
    log "deploy notify skipped: $NOTIFY_HOOK is not executable"
    return 0
  fi
  log "deploy notify $NOTIFY_HOOK"
  if command -v timeout >/dev/null 2>&1; then
    printf '%s' "$record" | timeout "$NOTIFY_TIMEOUT" "$NOTIFY_HOOK" || status=$?
  else
    printf '%s' "$record" | "$NOTIFY_HOOK" || status=$?
  fi
  [ "$status" -eq 0 ] || log "deploy notify exited $status (ignored)"
  return 0
}

write_record() {
  local sha="$1" previous="$2" result="$3" failed="${4:-}" snapshot="${5:-}"
  local record
  if [ "$result" = deployed ]; then
    resume_claims || return 1
    install_host_tools "$sha" "$previous"
  fi
  record="$(printf '{"sha":"%s","previous":"%s","result":"%s","failed":"%s","snapshot":"%s","at":"%s","host":"%s"}\n' \
    "$sha" "$previous" "$result" "$failed" "$snapshot" "$(date -u +%FT%TZ)" "$MACHINE_NAME")"
  printf '%s' "$record" >"$STATE/deployed.json.tmp" && mv "$STATE/deployed.json.tmp" "$STATE/deployed.json"
  printf '%s' "$record" >"$DATA_DIR/deploy.json.tmp" && mv "$DATA_DIR/deploy.json.tmp" "$DATA_DIR/deploy.json"
  run_notify "$record"
}

mark_failed() {
  mkdir -p "$STATE/failed"
  echo "$2" >"$STATE/failed/$1"
}

install_host_tools() {
  local target="$1" previous="${2:-}" rel dest source kept="" units_changed="" new_timers="" was_missing timer
  mkdir -p "$HOST_TOOLS_ROOT" "$HOST_LANES_ROOT" "$HOST_BIN_ROOT" "$HOST_UNITS_ROOT" || { log "host tools: cannot create the host roots"; return 0; }
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    case "$rel" in
      scripts/ops/host/tools/*) dest="$HOST_TOOLS_ROOT/${rel#scripts/ops/host/tools/}" ;;
      scripts/ops/host/lanes/*) dest="$HOST_LANES_ROOT/${rel#scripts/ops/host/lanes/}" ;;
      scripts/ops/host/bin/*) dest="$HOST_BIN_ROOT/${rel#scripts/ops/host/bin/}" ;;
      scripts/ops/host/units/*) dest="$HOST_UNITS_ROOT/${rel#scripts/ops/host/units/}" ;;
      packages/shared/commit-identity.json) dest="$HOST_TOOLS_ROOT/app-token/${rel##*/}" ;;
      *) continue ;;
    esac
    source="$CHECKOUT/$rel"
    if [ -f "$dest" ] && cmp -s "$source" "$dest"; then
      continue
    fi
    if [ -f "$dest" ] && [ -n "$previous" ] && git -C "$CHECKOUT" cat-file -e "$previous:$rel" 2>/dev/null &&
      [ "$(git -C "$CHECKOUT" rev-parse "$previous:$rel" 2>/dev/null)" = "$(git hash-object "$dest")" ]; then
      :
    elif [ -f "$dest" ]; then
      kept="$kept $dest"
      continue
    fi
    mkdir -p "$(dirname "$dest")" || continue
    was_missing=0
    [ -e "$dest" ] || was_missing=1
    if cp "$source" "$dest.tmp.$$" && mv "$dest.tmp.$$" "$dest"; then
      case "$rel" in
        scripts/ops/host/bin/* | *.sh) chmod 755 "$dest" ;;
        *) if [ -x "$source" ]; then chmod 755 "$dest"; else chmod 644 "$dest"; fi ;;
      esac
    else
      rm -f "$dest.tmp.$$"
      log "host tools: cannot write $dest"
      continue
    fi
    case "$rel" in
      scripts/ops/host/units/*.timer)
        units_changed=1
        [ "$was_missing" = 0 ] || new_timers="$new_timers $(basename "$rel")" ;;
      scripts/ops/host/units/*) units_changed=1 ;;
    esac
  done < <(git -C "$CHECKOUT" ls-tree -r --name-only "$target" -- scripts/ops/host/tools scripts/ops/host/lanes scripts/ops/host/bin scripts/ops/host/units packages/shared/commit-identity.json)
  if [ -n "$units_changed" ]; then
    systemctl --user daemon-reload || log "host tools: daemon-reload failed"
    for timer in $new_timers; do
      systemctl --user enable --now "$timer" || log "host tools: cannot enable $timer"
    done
  fi
  printf '%s\n' "$target" >"$HOST_TOOLS_ROOT/.installed-sha" 2>/dev/null || true
  printf '%s\n' "$target" >"$STATE/host-tools-sha" 2>/dev/null || true
  if [ -n "$kept" ]; then
    log "host tools: kept hand-edited files:$kept"
    host_tools_alarm "$kept"
  else
    rm -f "$STATE/alarms/host-tools-edited"
  fi
}

host_tools_alarm() {
  local kept="$1" reason="host-tools-edited" open_issue body
  mkdir -p "$STATE/alarms" || return 0
  [ ! -e "$STATE/alarms/$reason" ] || return 0
  body="$reason: on $MACHINE_NAME these host files differ from both the previous and the new main:$(printf ' %s' $kept). They were kept; move the change upstream or delete them by hand."
  open_issue="$(gh issue list -R "$REPO" --state open --author "@me" --search "\"$HOST_TOOLS_ALARM_TITLE\" in:title" --json number --jq '.[0].number // empty')" || return 0
  if [ -n "$open_issue" ]; then
    gh issue comment "$open_issue" -R "$REPO" -b "$body" >/dev/null || return 0
  else
    gh issue create -R "$REPO" -t "$HOST_TOOLS_ALARM_TITLE" -b "$body" -a xiechimon >/dev/null || return 0
  fi
  touch "$STATE/alarms/$reason" || true
}

assert_hold() {
  [ ! -e "$STATE/hold" ] || busy "hold: $(head -n1 "$STATE/hold")"
}

classify_runtime() {
  local path
  RUNTIME=server
  while IFS= read -r path; do
    case "$path" in
      *package.json | pnpm-lock.yaml | pnpm-workspace.yaml) RUNTIME=daemon ;;
      apps/server/* | apps/web/* | integration/test/* | docs/* | packages/shared/src/tables.ts | packages/shared/test/vocabulary.test.ts | packages/shared/test/__snapshots__/snapshot.test.ts.snap | .claude/skills/verify-cairn/feature-map.json | .claude/skills/verify-cairn/feature-map.md | scripts/ops/deploy-self.sh | scripts/ops/deploy-watch.sh | scripts/ops/deploy-self.test.mjs | scripts/ops/bootstrap-deploy.sh) ;;
      *) RUNTIME=daemon ;;
    esac
  done < <(git -C "$CHECKOUT" diff --name-only "$PREVIOUS" "$TARGET")
}


assert_lease() {
  python3 - "$STATE/lease-response" "$LEASE_OWNER" <<'PYLEASE'
import json, sys, time
with open(sys.argv[1]) as response:
    lease = json.load(response)
assert lease['owner'] == sys.argv[2] and lease['status'] == 'draining'
assert lease['expiresAt'] > time.time() * 1000
PYLEASE
}

wait_for_steps() {
  local deadline=$(( $(date +%s) + STEP_WAIT_SECONDS )) running
  while :; do
    [ "$(sqlite3 -readonly "$DB" "select count(*) from deploy_lease where id='server' and owner='$LEASE_OWNER' and status='draining' and expiresAt > $(($(date +%s) * 1000))")" = 1 ] || refuse "deployment lease lost during drain"
    running="$(sqlite3 -readonly "$DB" "select count(*) from step where status='claimed' and machineId is not null")" || refuse "cannot read running steps"
    [[ "$running" =~ ^[0-9]+$ ]] || refuse "invalid running step count"
    [ "$running" != 0 ] || return 0
    [ "$(date +%s)" -lt "$deadline" ] || busy "starved: steps never idle ($running still running after ${STEP_WAIT_SECONDS}s drain)"
    sleep 1
  done
}

drain_steps() {
  [ "$RUNTIME" = daemon ] || return 0
  [ -n "$LEASE_OWNER" ] || LEASE_OWNER="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  printf '%s\n' "$LEASE_OWNER" >"$STATE/lease-owner"
  local status
  status="$(lease_request -X PUT --data-binary "{\"owner\":\"$LEASE_OWNER\",\"ttlMs\":3600000}")" || true
  [ "$status" = 200 ] || refuse_lease_status "$status"
  assert_lease || refuse "cannot acquire deployment lease: the server returned another owner or an expired lease"
  wait_for_steps
}

allow_builds_block() {
  git -C "$CHECKOUT" show "$1:pnpm-workspace.yaml" 2>/dev/null |
    awk '/^allowBuilds:/{inside=1; print; next} inside && /^[^[:space:]#]/{inside=0} inside{print}'
}

hook_lines() {
  { git -C "$CHECKOUT" show "$1:$2" 2>/dev/null || true; } |
    { grep -E '"(pre|post)?(install|prepare)"[[:space:]]*:' || true; } |
    sed -E 's/^[[:space:]]*//; s/,[[:space:]]*$//'
}

install_hooks_changed() {
  local manifest
  while IFS= read -r manifest; do
    [ "$(hook_lines "$PREVIOUS" "$manifest")" = "$(hook_lines "$TARGET" "$manifest")" ] ||
      echo "$manifest"
  done < <(git -C "$CHECKOUT" diff --name-only "$PREVIOUS" "$TARGET" -- '*package.json')
  git -C "$CHECKOUT" diff --name-only "$PREVIOUS" "$TARGET" -- .pnpmfile.cjs .pnpmfile.mjs .npmrc '*/.npmrc'
}

assert_deployable() {
  git -C "$CHECKOUT" fetch -q origin main
  git -C "$CHECKOUT" cat-file -e "$TARGET^{commit}" 2>/dev/null || refuse "$TARGET is not on origin/main"
  git -C "$CHECKOUT" merge-base --is-ancestor "$TARGET" origin/main || refuse "$TARGET is not on origin/main"

  local paused
  paused="$(gh issue list -R "$REPO" --label autonomy-paused --state open --json number --jq length)"
  [ "$paused" = 0 ] || refuse "an autonomy-paused issue is open"

  local checks name
  checks="$(gh api "repos/$REPO/commits/$TARGET/check-runs?per_page=100" --jq '.check_runs[] | "\(.name)\t\(.conclusion)"')"
  for name in $REQUIRED_CHECKS; do
    grep -qxF "$name"$'\t'success <<<"$checks" || refuse "required check $name is not green on $TARGET"
  done

  [ "$(allow_builds_block "$PREVIOUS")" = "$(allow_builds_block "$TARGET")" ] ||
    refuse "allowBuilds in pnpm-workspace.yaml changed; deploy by hand after reviewing install scripts"
  local hooks
  hooks="$(install_hooks_changed)"
  [ -z "$hooks" ] || refuse "install hooks or pnpm config changed; deploy by hand after review: $hooks"
}

rehearse_migrations() {
  local tree="$SCRATCH/tree" copy="$SCRATCH/server.db"
  rm -rf "$SCRATCH"
  mkdir -p "$SCRATCH" || return 1
  git -C "$CHECKOUT" worktree prune
  git -C "$CHECKOUT" worktree add -q --detach "$tree" "$TARGET" || return 1
  local result=0
  sqlite3 "$DB" ".backup '$copy'" &&
    [ "$(sqlite3 "$copy" 'select count(*) from __drizzle_migrations')" -gt 0 ] &&
    (cd "$tree" && pnpm install --frozen-lockfile --reporter=silent) &&
    (cd "$tree/apps/server" && node --import tsx --input-type=module \
      -e 'const { openDbWithHandle } = await import(process.argv[1]); openDbWithHandle(process.argv[2]).close();' \
      "$tree/apps/server/src/db/client.ts" "$copy") &&
    [ "$(sqlite3 "$copy" 'pragma integrity_check')" = ok ] &&
    [ -z "$(sqlite3 "$copy" 'pragma foreign_key_check')" ] || result=1
  git -C "$CHECKOUT" worktree remove --force "$tree" || true
  rm -rf "$SCRATCH"
  return "$result"
}

switch_code() {
  git -C "$CHECKOUT" checkout -q --detach "$1" &&
    (cd "$CHECKOUT" && pnpm install --frozen-lockfile --reporter=silent) &&
    { [ "$RUNTIME" = server ] || (cd "$CHECKOUT" && pnpm -C apps/daemon build); } &&
    (cd "$CHECKOUT" && pnpm -C apps/web build)
}

probe() {
  curl -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 5 "$HEALTH_URL$1" || true
}

server_healthy() {
  local streak=0 i
  for ((i = 0; i < HEALTH_TRIES; i++)); do
    if [ "$(probe /app)" = 200 ] && [[ "$(probe /api/user/me)" =~ ^(200|401)$ ]]; then
      streak=$((streak + 1))
      [ "$streak" -ge 3 ] && return 0
    else
      streak=0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

daemon_healthy() {
  local since_ms="$1" i seen
  for ((i = 0; i < HEALTH_TRIES; i++)); do
    seen="$(sqlite3 -readonly "$DB" "select coalesce(max(lastSeenAt), 0) from machine where name = '$MACHINE_NAME'")"
    [ "${seen:-0}" -ge "$since_ms" ] && return 0
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

unit_alarm() {
  local unit="$1" slug="$2" action="$3" title="$4" reason open_issue
  reason="$slug-unit-$action-failed"
  echo "$reason: $unit; continuing the deploy" >&2
  mkdir -p "$STATE/alarms" || return 0
  [ ! -e "$STATE/alarms/$reason" ] || return 0
  open_issue="$(gh issue list -R "$REPO" --state open --author "@me" --search "\"$title\" in:title" --json number --jq '.[0].number // empty')" || return 0
  if [ -n "$open_issue" ]; then
    gh issue comment "$open_issue" -R "$REPO" -b "$reason: $unit on $MACHINE_NAME. Core deployment continues; inspect the unit logs." >/dev/null || return 0
  else
    gh issue create -R "$REPO" -t "$title" -b "$reason: $unit on $MACHINE_NAME. Core deployment continues; inspect the unit logs." -a xiechimon >/dev/null || return 0
  fi
  touch "$STATE/alarms/$reason" || true
}

unit_recovered() {
  local slug="$1" action
  shift
  for action in "$@"; do rm -f "$STATE/alarms/$slug-unit-$action-failed"; done
}

optional_unit_healthy() {
  local unit="$1" previous="" current streak=0 i
  for ((i = 0; i < HEALTH_TRIES; i++)); do
    current="$(systemctl --user show "$unit" -p ActiveState -p SubState -p MainPID -p NRestarts)" || current=""
    if grep -qxF 'ActiveState=active' <<<"$current" &&
      grep -qxF 'SubState=running' <<<"$current" &&
      grep -qE '^MainPID=[1-9][0-9]*$' <<<"$current" &&
      grep -qE '^NRestarts=[0-9]+$' <<<"$current"; then
      if [ "$current" = "$previous" ]; then streak=$((streak + 1)); else streak=1; fi
      previous="$current"
      [ "$streak" -ge 3 ] && return 0
    else
      streak=0
      previous=""
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

STOP_FAILED=""

stop_optional_unit() {
  local unit="$1" slug="$2" title="$3"
  systemctl --user is-enabled --quiet "$unit" || return 0
  if systemctl --user stop "$unit"; then
    STOP_FAILED="${STOP_FAILED/ $slug/}"
    unit_recovered "$slug" stop
  else
    STOP_FAILED="$STOP_FAILED $slug"
    unit_alarm "$unit" "$slug" stop "$title"
  fi
}

start_optional_unit() {
  local unit="$1" slug="$2" title="$3"
  systemctl --user is-enabled --quiet "$unit" || return 0
  if [[ "$STOP_FAILED" == *" $slug"* ]]; then
    if systemctl --user restart "$unit" && optional_unit_healthy "$unit"; then
      unit_recovered "$slug" stop start
    else
      unit_alarm "$unit" "$slug" start "$title"
    fi
  elif systemctl --user start "$unit" && optional_unit_healthy "$unit"; then
    unit_recovered "$slug" start
  else
    unit_alarm "$unit" "$slug" start "$title"
  fi
}

stop_services() {
  if [ "$RUNTIME" = daemon ]; then
    stop_optional_unit "$ORB_UNIT" orb "$ORB_ALARM_TITLE"
    systemctl --user stop "$DAEMON_UNIT" || return 1
  fi
  systemctl --user stop "$SERVER_UNIT"
}

start_and_check() {
  local started_ms
  [ -s "$DB" ] || { echo "refusing to start services: $DB is missing" >&2; return 1; }
  systemctl --user start "$SERVER_UNIT"
  server_healthy || return 1
  started_ms="$(($(date +%s) * 1000))"
  if [ "$RUNTIME" = daemon ]; then
    systemctl --user start "$DAEMON_UNIT" || return 1
    start_optional_unit "$ORB_UNIT" orb "$ORB_ALARM_TITLE"
  fi
  daemon_healthy "$started_ms" || return 1
  return 0
}

PREVIOUS_BUILT=0

build_previous() {
  [ "$PREVIOUS_BUILT" = 1 ] && return 0
  switch_code "$PREVIOUS" || return 1
  PREVIOUS_BUILT=1
}

restart_previous() {
  log "restarting $PREVIOUS: $1"
  build_previous || log "rebuilding $PREVIOUS failed; starting with the checkout as it is"
  if start_and_check; then
    clear_in_progress
    echo "$1; restarted $PREVIOUS with its DB untouched" >&2
    exit 1
  fi
  write_record "$PREVIOUS" "$PREVIOUS" rollback-unhealthy "$TARGET" ""
  clear_in_progress
  echo "CRITICAL: $1, and $PREVIOUS did not come back healthy" >&2
  exit "$EXIT_ROLLBACK_UNHEALTHY"
}

prune_snapshots() {
  find "$BACKUPS" -maxdepth 1 -name 'stopped-*.db' -print | sort -r | tail -n +"$((KEEP_SNAPSHOTS + 1))" | xargs -r rm -f
}

UNTRACKED_TABLES=" __drizzle_migrations deploy_lease "
HEARTBEAT_COLUMNS=" machine.lastSeenAt machine.capabilities autonomy_state.lastEvaluatedAt "

user_tables() {
  local names
  names="$(sqlite3 -readonly "$1" "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")" || return 1
  [ -n "$names" ] || return 1
  while read -r table; do [[ "$UNTRACKED_TABLES" == *" $table "* ]] || echo "$table"; done <<<"$names"
}

quoted_columns() {
  local names column quoted=""
  names="$(sqlite3 -readonly "$1" "select name from pragma_table_info('$2')")" || return 1
  while read -r column; do
    [[ "$HEARTBEAT_COLUMNS" == *" $2.$column "* ]] && continue
    quoted+="${quoted:+,}\"${column//\"/\"\"}\""
  done <<<"$names"
  echo "${quoted:-1}"
}

added_column_checks() {
  sqlite3 -readonly "$DB" "attach '$1' as snap;
    select group_concat('\"' || replace(c.name, '\"', '\"\"') || '\" is not ' || coalesce(c.dflt_value, 'null'), ' or ')
    from pragma_table_info('$2', 'main') c
    where c.name not in (select name from pragma_table_info('$2', 'snap'));"
}

writes_after_snapshot() {
  local snapshot="$1" table columns added differing snapshot_tables current_tables
  snapshot_tables="$(user_tables "$snapshot")" || return 0
  current_tables="$(user_tables "$DB")" || return 0
  while read -r table; do
    grep -qxF "$table" <<<"$current_tables" || return 0
    columns="$(quoted_columns "$snapshot" "$table")" || return 0
    added="$(added_column_checks "$snapshot" "$table")" || return 0
    differing="$(sqlite3 -readonly "$DB" "attach '$snapshot' as snap;
      select (select count(*) from (select $columns from main.\"$table\" except select $columns from snap.\"$table\"))
           + (select count(*) from (select $columns from snap.\"$table\" except select $columns from main.\"$table\"))
           + (select count(*) from main.\"$table\" where ${added:-0});")" || return 0
    [ "$differing" = 0 ] || return 0
  done <<<"$snapshot_tables"
  while read -r table; do
    grep -qxF "$table" <<<"$snapshot_tables" && continue
    [ "$(sqlite3 -readonly "$DB" "select count(*) from \"$table\"")" = 0 ] || return 0
  done <<<"$current_tables"
  return 1
}

stop_or_give_up() {
  stop_services && return 0
  write_record "$TARGET" "$PREVIOUS" rollback-unhealthy "$TARGET" "$1"
  clear_in_progress
  echo "CRITICAL: could not stop services to roll back $TARGET; DB left in place, snapshot $1" >&2
  exit "$EXIT_ROLLBACK_UNHEALTHY"
}

roll_back() {
  local snapshot="$1" reason="$2" failed_dir
  log "rolling back to $PREVIOUS: $reason"
  mark_failed "$TARGET" "$reason"
  stop_or_give_up "$snapshot"
  if writes_after_snapshot "$snapshot"; then
    log "data changed after the snapshot; keeping the DB and rolling back code only"
    if build_previous && start_and_check; then
      write_record "$PREVIOUS" "$PREVIOUS" rolled-back-code "$TARGET" "$snapshot"
      clear_in_progress
      echo "deploy of $TARGET failed ($reason); rolled code back to $PREVIOUS and kept the DB, which changed after the snapshot" >&2
      exit 1
    fi
    write_record "$PREVIOUS" "$PREVIOUS" rollback-unhealthy "$TARGET" "$snapshot"
    clear_in_progress
    echo "CRITICAL: $PREVIOUS is unhealthy on the DB that changed after the snapshot; kept that DB, snapshot $snapshot" >&2
    exit "$EXIT_ROLLBACK_UNHEALTHY"
  fi
  failed_dir="$BACKUPS/failed-$(date -u +%Y%m%dT%H%M%SZ)-${TARGET:0:12}"
  set_in_progress restoring "$snapshot" "$failed_dir"
  restore_snapshot "$snapshot" "$failed_dir" || {
    write_record "$PREVIOUS" "$PREVIOUS" rollback-unhealthy "$TARGET" "$snapshot"
    echo "CRITICAL: restoring $snapshot failed; failed DB in $failed_dir, deploy marker kept for --recover" >&2
    exit "$EXIT_ROLLBACK_UNHEALTHY"
  }
  set_in_progress restored "$snapshot" "$failed_dir"
  build_previous || log "rebuilding $PREVIOUS failed; starting with the checkout as it is"
  if start_and_check; then
    write_record "$PREVIOUS" "$PREVIOUS" rolled-back "$TARGET" "$snapshot"
    clear_in_progress
    echo "deploy of $TARGET failed ($reason); rolled back to $PREVIOUS, failed DB kept in $failed_dir" >&2
    exit 1
  fi
  write_record "$PREVIOUS" "$PREVIOUS" rollback-unhealthy "$TARGET" "$snapshot"
  clear_in_progress
  echo "CRITICAL: rollback to $PREVIOUS is unhealthy; snapshot $snapshot, failed DB in $failed_dir" >&2
  exit "$EXIT_ROLLBACK_UNHEALTHY"
}

IN_PROGRESS="$STATE/in-progress"

set_in_progress() {
  printf 'phase=%s\ntarget=%s\nprevious=%s\nsnapshot=%s\nfailed=%s\nruntime=%s\n' "$1" "$TARGET" "$PREVIOUS" "${2:-}" "${3:-}" "$RUNTIME" >"$IN_PROGRESS.tmp"
  mv "$IN_PROGRESS.tmp" "$IN_PROGRESS"
}

restore_snapshot() {
  local snapshot="$1" failed_dir="$2" file lease_tables
  [ -s "$snapshot" ] || return 1
  mkdir -p "$failed_dir" || return 1
  if [ -e "$DB" ] && ! cmp -s "$DB" "$snapshot"; then
    for file in server.db server.db-wal server.db-shm; do
      [ ! -e "$DATA_DIR/$file" ] || mv "$DATA_DIR/$file" "$failed_dir/$file.$(date -u +%Y%m%dT%H%M%SZ).$$" || return 1
    done
  fi
  rm -f "$DB-wal" "$DB-shm"
  if [ ! -e "$DB" ]; then
    cp "$snapshot" "$DB.restoring" && mv "$DB.restoring" "$DB" || return 1
  fi
  if [ -n "$LEASE_OWNER" ]; then
    lease_tables="$(sqlite3 -readonly "$DB" "select count(*) from sqlite_master where name='deploy_lease'")" || return 1
    if [ "$lease_tables" = 1 ]; then
      sqlite3 -cmd '.timeout 10000' "$DB" "insert into deploy_lease(id,owner,status,expiresAt) values ('server','$LEASE_OWNER','draining',$(($(date +%s) * 1000 + 3600000)))
        on conflict(id) do update set owner=excluded.owner,status=excluded.status,expiresAt=excluded.expiresAt;" || return 1
    fi
  fi
}

clear_in_progress() {
  rm -f "$IN_PROGRESS"
}

recorded() {
  sed -nE "s/.*\"$1\":\"([^\"]*)\".*/\1/p" "$STATE/deployed.json" 2>/dev/null
}

recover_interrupted() {
  [ -e "$IN_PROGRESS" ] || return 0
  local phase="" key value snapshot="" failed_dir=""
  while IFS='=' read -r key value; do
    case "$key" in
      runtime) RUNTIME="$value" ;;
      phase) phase="$value" ;;
      target) TARGET="$value" ;;
      previous) PREVIOUS="$value" ;;
      snapshot) snapshot="$value" ;;
      failed) failed_dir="$value" ;;
    esac
  done <"$IN_PROGRESS"
  log "recovering an interrupted deploy of $TARGET (phase $phase, previous $PREVIOUS)"
  if [ "$phase" = building ]; then
    build_previous || echo "CRITICAL: could not rebuild $PREVIOUS after an interrupted build" >&2
    clear_in_progress
    log "restored the $PREVIOUS checkout; running services were not touched"
    return 0
  fi
  if [ "$RUNTIME" = daemon ] && [ -s "$DB" ]; then
    local lease_now
    [ -n "$LEASE_OWNER" ] || LEASE_OWNER="$(python3 -c 'import uuid; print(uuid.uuid4())')"
    [[ "$LEASE_OWNER" =~ ^[0-9a-f-]{36}$ ]] || refuse "invalid recovery lease owner"
    printf '%s\n' "$LEASE_OWNER" >"$STATE/lease-owner"
    lease_now="$(($(date +%s) * 1000))"
    sqlite3 -cmd '.timeout 10000' "$DB" "begin immediate;
      insert into deploy_lease(id,owner,status,expiresAt) values ('server','$LEASE_OWNER','draining',$((lease_now + 3600000)))
      on conflict(id) do update set owner=excluded.owner, status=excluded.status, expiresAt=excluded.expiresAt
      where deploy_lease.owner=excluded.owner or deploy_lease.status='accepting' or deploy_lease.expiresAt <= $lease_now;
      commit;" || refuse "cannot recover deployment lease"
    wait_for_steps
  fi
  if [ "$phase" = restoring ] || [ "$phase" = restored ]; then
    stop_or_give_up "$snapshot"
    if [ "$phase" = restoring ]; then
      restore_snapshot "$snapshot" "$failed_dir" || {
        echo "CRITICAL: could not restore $snapshot during recovery; marker kept" >&2
        exit "$EXIT_ROLLBACK_UNHEALTHY"
      }
      set_in_progress restored "$snapshot" "$failed_dir"
    fi
    build_previous || log "rebuilding $PREVIOUS failed; starting with the checkout as it is"
    if start_and_check; then
      write_record "$PREVIOUS" "$PREVIOUS" rolled-back "$TARGET" "$snapshot"
      clear_in_progress
      echo "finished the interrupted rollback of $TARGET to $PREVIOUS; failed DB in $failed_dir" >&2
      exit 1
    fi
    write_record "$PREVIOUS" "$PREVIOUS" rollback-unhealthy "$TARGET" "$snapshot"
    clear_in_progress
    echo "CRITICAL: interrupted rollback to $PREVIOUS is unhealthy after restoring $snapshot" >&2
    exit "$EXIT_ROLLBACK_UNHEALTHY"
  fi
  if [ ! -s "$DB" ]; then
    stop_or_give_up "$snapshot"
    restore_snapshot "$snapshot" "${failed_dir:-$BACKUPS/failed-recovery-${TARGET:0:12}}" || {
      echo "CRITICAL: $DB is missing and $snapshot cannot be restored; marker kept" >&2
      exit "$EXIT_ROLLBACK_UNHEALTHY"
    }
  fi
  if [ -s "$snapshot" ] && [ "$(git -C "$CHECKOUT" rev-parse HEAD)" = "$TARGET" ] && start_and_check; then
    write_record "$TARGET" "$PREVIOUS" deployed "" "$snapshot"
    clear_in_progress
    log "finished the interrupted deploy of $TARGET"
    return 0
  fi
  if [ -s "$snapshot" ]; then
    roll_back "$snapshot" "interrupted deploy was unhealthy"
  fi
  restart_previous "interrupted deploy had no snapshot"
}

[[ "$STEP_WAIT_SECONDS" =~ ^[0-9]+$ ]] && [ "$STEP_WAIT_SECONDS" -le 1800 ] || refuse "drain deadline must be between 0 and 1800 seconds"
recover_interrupted
[ "$RECOVER_ONLY" = 0 ] || exit 0

PREVIOUS="$(git -C "$CHECKOUT" rev-parse HEAD)"
if [ "$PREVIOUS" = "$TARGET" ] && [ "$(recorded sha)" = "$TARGET" ] && [ "$(recorded result)" = deployed ]; then
  log "already deployed: $TARGET"
  exit 0
fi
if [ "$PREVIOUS" = "$TARGET" ]; then
  if server_healthy; then
    write_record "$TARGET" "$(recorded previous)" deployed "" ""
    log "already deployed: $TARGET (record written after a health check)"
    exit 0
  fi
  echo "checkout is at $TARGET without a deploy record and the server is unhealthy; deploy the previous SHA by hand" >&2
  exit 1
fi
assert_deployable
assert_hold
classify_runtime
if [ "$RUNTIME" = daemon ]; then
  LEASE_PROBE_STATUS="$(lease_request)" || true
  [ "$LEASE_PROBE_STATUS" = 200 ] || refuse_lease_status "$LEASE_PROBE_STATUS"
fi

log "rehearsing migrations of $TARGET"
if ! rehearse_migrations; then
  mark_failed "$TARGET" "migration rehearsal failed"
  echo "migration rehearsal failed for $TARGET; nothing changed" >&2
  exit 1
fi

log "building $TARGET in $CHECKOUT"
set_in_progress building
if ! switch_code "$TARGET"; then
  mark_failed "$TARGET" "install or build failed"
  switch_code "$PREVIOUS" || echo "CRITICAL: could not rebuild $PREVIOUS after a failed build" >&2
  clear_in_progress
  echo "install or build failed for $TARGET; running services untouched" >&2
  exit 1
fi

assert_hold
drain_steps

mkdir -p "$BACKUPS" || restart_previous "creating $BACKUPS failed"
SNAPSHOT="$BACKUPS/stopped-$(date -u +%Y%m%dT%H%M%SZ)-${PREVIOUS:0:12}.db"
log "stopping services and snapshotting the DB to $SNAPSHOT"
set_in_progress switching
stop_services || restart_previous "stopping the services failed"
if ! sqlite3 "$DB" ".backup '$SNAPSHOT'" || [ "$(sqlite3 -readonly "$SNAPSHOT" 'pragma integrity_check')" != ok ]; then
  rm -f "$SNAPSHOT"
  restart_previous "the DB snapshot failed"
fi
set_in_progress switching "$SNAPSHOT"

if ! start_and_check; then
  roll_back "$SNAPSHOT" "health check failed after starting $TARGET"
fi

write_record "$TARGET" "$PREVIOUS" deployed "" "$SNAPSHOT"
clear_in_progress
prune_snapshots
log "deployed $TARGET (previous $PREVIOUS)"
