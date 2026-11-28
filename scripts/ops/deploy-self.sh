#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat >&2 <<'USAGE'
usage: deploy-self.sh <40-hex sha on origin/main> | --recover
USAGE
  exit 2
}

marker_aware_check() {
  node -e '
const fs = require("node:fs");
const path = require("node:path");
const dir = path.join(process.argv[1] || "", "drizzle");
let sql = "";
try {
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    sql += fs.readFileSync(path.join(dir, name), "utf8") + "\n";
  }
} catch {
  process.exit(1);
}
sql = sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*|\x27(?:[^\x27]|\x27\x27)*\x27/g, " ");
const creates = /(?:^|[\s;])create\s+trigger\s+(?:if\s+not\s+exists\s+)?["`\[]?step_require_writer_generation_update["`\]]?(?=[\s;]|$)/i;
process.exit(creates.test(sql) ? 0 : 1);
' "$1"
}

if [ "${1:-}" = --marker-aware ]; then
  marker_aware_check "${2:-}"
  exit $?
fi

[ $# -eq 1 ] || usage
RECOVER_ONLY=0
TARGET="$1"
if [ "$TARGET" = --recover ]; then
  RECOVER_ONLY=1
  TARGET=""
else
  [[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo "refused: '$TARGET' is not a full 40-hex SHA" >&2; exit 2; }
fi

BUILD_CHECKOUT="${CAIRN_DEPLOY_BUILD_CHECKOUT:-${CAIRN_CHECKOUT:-$HOME/deploy-build}}"
RUNNER_CHECKOUT="${CAIRN_DEPLOY_RUNNER_CHECKOUT:-}"
APP_ROOT="${CAIRN_DEPLOY_APP_ROOT:-$HOME/cairn-server}"
DATA_DIR="${CAIRN_DATA_DIR:-$HOME/.cairn/server}"
STATE="${CAIRN_DEPLOY_STATE:-$HOME/.local/state/cairn-deploy}"
BACKUPS="${CAIRN_DEPLOY_BACKUPS:-$STATE/backups}"
SCRATCH="${CAIRN_DEPLOY_SCRATCH:-$STATE/scratch}"
RELEASES="${CAIRN_DEPLOY_RELEASES:-$STATE/releases}"
REPO="${CAIRN_REPO:-xiechimon/cairn}"
REQUIRED_CHECKS="${CAIRN_REQUIRED_CHECKS:-check pack-smoke e2e-gate}"
HEALTH_URL="${CAIRN_HEALTH_URL:-http://127.0.0.1:8787}"
HEALTH_TRIES="${CAIRN_HEALTH_TRIES:-60}"
HEALTH_INTERVAL="${CAIRN_HEALTH_INTERVAL:-2}"
RUNNER_HEALTH_TRIES="${CAIRN_RUNNER_HEALTH_TRIES:-15}"
RUNNER_HEALTH_INTERVAL="${CAIRN_RUNNER_HEALTH_INTERVAL:-1}"
MACHINE_NAME="${CAIRN_DEPLOY_MACHINE_NAME:-$(hostname -s)}"
KEEP_SNAPSHOTS="${CAIRN_DEPLOY_KEEP_SNAPSHOTS:-10}"
KEEP_RELEASES="${CAIRN_DEPLOY_KEEP_RELEASES:-5}"
TOKEN_FILE="${CAIRN_DEPLOY_TOKEN_FILE:-$HOME/.cairn/token}"
SERVICE_MANAGER="${CAIRN_DEPLOY_SERVICE_MANAGER:-systemd}"
SYSTEMD_UNIT="${CAIRN_DEPLOY_SYSTEMD_UNIT:-cairn-server.service}"
LAUNCHD_LABEL="${CAIRN_DEPLOY_LAUNCHD_LABEL:-com.cairn.server}"
LAUNCHD_PLIST="${CAIRN_DEPLOY_LAUNCHD_PLIST:-$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist}"
RUNNER_SYSTEMD_UNIT="${CAIRN_DEPLOY_RUNNER_SYSTEMD_UNIT:-cairn-daemon.service}"
RUNNER_LAUNCHD_LABEL="${CAIRN_DEPLOY_RUNNER_LAUNCHD_LABEL:-com.cairn.daemon}"
RUNNER_LAUNCHD_PLIST="${CAIRN_DEPLOY_RUNNER_LAUNCHD_PLIST:-$HOME/Library/LaunchAgents/$RUNNER_LAUNCHD_LABEL.plist}"
RUNNER_PROCESS_PATTERN="${CAIRN_DEPLOY_RUNNER_PROCESS_PATTERN:-}"
COORDINATOR_WAIT_SECONDS="${CAIRN_DEPLOY_COORDINATOR_WAIT_SECONDS:-600}"
DB="$DATA_DIR/server.db"
IN_PROGRESS="$STATE/in-progress"
EXIT_REFUSED=2
EXIT_BUSY=75
EXIT_ROLLBACK_UNHEALTHY=3

mkdir -p "$STATE" "$RELEASES" "$BACKUPS"
if [ "${CAIRN_DEPLOY_RUNNING_COPY:-}" != 1 ]; then
  ops_dir="$(cd "$(dirname "$0")" && pwd)"
  running_dir="$(mktemp -d "$STATE/deploy-self.running.XXXXXX")"
  cp "$0" "$running_dir/deploy-self.sh"
  cp "$ops_dir/github-ci-evidence.mjs" "$ops_dir/stage-server-artifact.mjs" "$running_dir/"
  CAIRN_DEPLOY_RUNNING_COPY=1 CAIRN_DEPLOY_COPY_DIR="$running_dir" exec bash "$running_dir/deploy-self.sh" "$@"
fi
OPS_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNING_DIR="$(dirname "$0")"

log() { echo "$(date -u +%FT%TZ) $*"; }
refuse() { echo "refused: $*" >&2; exit "$EXIT_REFUSED"; }
busy() { printf '%s\n' "$*" >"$STATE/last-reason"; echo "busy: $*" >&2; exit "$EXIT_BUSY"; }

LOCK="$STATE/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then busy "deploy already running (pid $holder)"; fi
  rm -rf "$LOCK"
  mkdir "$LOCK" 2>/dev/null || busy "deploy lock taken concurrently"
fi
echo $$ >"$LOCK/pid"
LEASE_OWNER=""
if [ -s "$STATE/lease-owner" ]; then
  LEASE_OWNER="$(cat "$STATE/lease-owner")"
fi
RUNNER_PREVIOUS=""
RUNNER_CHECKOUT_DIRTY=0
LEASE_FROZEN=0
STOP_FIRST=0
JOURNAL_PHASE=repair-required
REASON=""
REPAIR_RETRIED=0
HELD_TARGET=""
HELD_RELEASE=""
CANDIDATE=""
CANDIDATE_RELEASE=""
MARKER_STATE=error
SCAN_COMMITS="${CAIRN_DEPLOY_SCAN_COMMITS:-50}"
STEP_MARKER=step_require_writer_generation_update

sqlite_ro() {
  local path="$1" sql="$2"
  if [ ! -e "${path}-shm" ] && [ ! -e "${path}-wal" ]; then
    sqlite3 "file:${path}?immutable=1" "$sql"
  else
    sqlite3 -readonly "$path" "$sql"
  fi
}

health_url_is_loopback() {
  [[ "$HEALTH_URL" =~ ^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?$ ]]
}

owner_token() {
  health_url_is_loopback && [ -r "$TOKEN_FILE" ] || return 0
  sed -nE 's/^[[:space:]]*CAIRN_TOKEN[[:space:]]*=[[:space:]]*//p' "$TOKEN_FILE" | head -n1 |
    sed -E "s/[[:space:]]+$//; s/^\"(.*)\"$/\\1/; s/^'(.*)'$/\\1/"
}

auth_config() {
  local token
  token="$(owner_token)"
  token="${token//\\/\\\\}"
  token="${token//\"/\\\"}"
  [ -z "$token" ] || printf 'header = "Authorization: Bearer %s"\n' "$token"
}

lease_request() {
  auth_config |
    curl -sS --noproxy '*' --max-time 10 -K - -o "$STATE/lease-response" -w '%{http_code}' \
      -H "Origin: $HEALTH_URL" -H 'Content-Type: application/json' "$@" "$HEALTH_URL/api/server/deploy/lease"
}

release_lease() {
  [ "$LEASE_FROZEN" = 0 ] || return 0
  [ -n "$LEASE_OWNER" ] || return 0
  [[ "$LEASE_OWNER" =~ ^[0-9a-f-]{36}$ ]] || return 1
  lease_request -X DELETE --data-binary "{\"owner\":\"$LEASE_OWNER\"}" >/dev/null 2>&1 || true
  local tables
  tables="$(sqlite_ro "$DB" "select count(*) from sqlite_master where name='deploy_lease'" 2>/dev/null || echo 0)"
  if [ "$tables" = 1 ]; then
    sqlite3 -cmd '.timeout 10000' "$DB" "update deploy_lease set status='accepting', expiresAt=0 where id='server' and owner='$LEASE_OWNER';" || return 1
  fi
  rm -f "$STATE/lease-owner"
  LEASE_OWNER=""
}

restore_build_checkout() {
  if [ -d "$BUILD_CHECKOUT/.git" ] || [ -f "$BUILD_CHECKOUT/.git" ]; then
    if git -C "$BUILD_CHECKOUT" rev-parse --verify origin/main >/dev/null 2>&1; then
      git -C "$BUILD_CHECKOUT" checkout -q --detach origin/main >/dev/null 2>&1 || true
    fi
  fi
}

cleanup() {
  local status=$?
  if ! release_lease; then
    echo "CRITICAL: deployment lease resume failed" >&2
    status=$EXIT_ROLLBACK_UNHEALTHY
  fi
  if [ "$RUNNER_CHECKOUT_DIRTY" = 1 ] && [ -n "$RUNNER_CHECKOUT" ] && [ -n "$RUNNER_PREVIOUS" ] && [ ! -e "$IN_PROGRESS" ]; then
    git -C "$RUNNER_CHECKOUT" checkout -q --detach "$RUNNER_PREVIOUS" >/dev/null 2>&1 || true
  fi
  restore_build_checkout
  rm -rf "$LOCK"
  if [ "${CAIRN_DEPLOY_COPY_DIR:-}" = "$RUNNING_DIR" ]; then rm -rf "$RUNNING_DIR"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

unit_stop() {
  local unit="$1" label="$2" pattern="${3:-}" i
  case "$SERVICE_MANAGER" in
    systemd)
      systemctl --user stop "$unit" || return 1
      ;;
    launchd)
      local target="gui/$(id -u)/$label"
      if launchctl print "$target" >/dev/null 2>&1; then
        launchctl bootout "$target" || ! launchctl print "$target" >/dev/null 2>&1 || return 1
        for i in $(seq 1 30); do
          if ! launchctl print "$target" >/dev/null 2>&1; then
            break
          fi
          [ "$i" -eq 30 ] && return 1
          sleep 0.5
        done
      fi
      ;;
    *) echo "unknown service manager $SERVICE_MANAGER" >&2; return 2 ;;
  esac
  if [ -n "$pattern" ] && command -v pgrep >/dev/null 2>&1; then
    for i in $(seq 1 30); do
      pgrep -f "$pattern" >/dev/null 2>&1 || return 0
      sleep 0.5
    done
    return 1
  fi
}

unit_start() {
  local unit="$1" label="$2" plist="$3" i
  case "$SERVICE_MANAGER" in
    systemd) systemctl --user start "$unit" ;;
    launchd)
      local domain="gui/$(id -u)" target="gui/$(id -u)/$label"
      if launchctl print "$target" >/dev/null 2>&1; then
        launchctl kickstart -k "$target"
        return $?
      fi
      for i in 1 2 3; do
        if launchctl bootstrap "$domain" "$plist"; then
          return 0
        fi
        [ "$i" -lt 3 ] && sleep 1
      done
      return 1
      ;;
    *) echo "unknown service manager $SERVICE_MANAGER" >&2; return 2 ;;
  esac
}

service_stop() { unit_stop "$SYSTEMD_UNIT" "$LAUNCHD_LABEL"; }
service_start() { unit_start "$SYSTEMD_UNIT" "$LAUNCHD_LABEL" "$LAUNCHD_PLIST"; }

runner_stop() {
  [ -n "$RUNNER_CHECKOUT" ] || return 0
  unit_stop "$RUNNER_SYSTEMD_UNIT" "$RUNNER_LAUNCHD_LABEL" "$RUNNER_PROCESS_PATTERN"
}

runner_start() {
  [ -n "$RUNNER_CHECKOUT" ] || return 0
  unit_start "$RUNNER_SYSTEMD_UNIT" "$RUNNER_LAUNCHD_LABEL" "$RUNNER_LAUNCHD_PLIST"
}

runner_healthy() {
  [ -n "$RUNNER_CHECKOUT" ] || return 0
  if [ -n "${CAIRN_DEPLOY_RUNNER_CHECK_CMD:-}" ]; then
    sh -c "$CAIRN_DEPLOY_RUNNER_CHECK_CMD"
    return $?
  fi
  local streak=0 i active
  for ((i = 0; i < RUNNER_HEALTH_TRIES; i++)); do
    active=0
    case "$SERVICE_MANAGER" in
      systemd)
        systemctl --user is-active --quiet "$RUNNER_SYSTEMD_UNIT" && active=1 || active=0
        ;;
      launchd)
        if launchctl print "gui/$(id -u)/$RUNNER_LAUNCHD_LABEL" 2>/dev/null | grep -Eq '^[[:space:]]*(job )?state = running$'; then
          active=1
        fi
        ;;
    esac
    if [ "$active" = 1 ]; then
      streak=$((streak + 1))
      [ "$streak" -ge 2 ] && return 0
    else
      streak=0
    fi
    sleep "$RUNNER_HEALTH_INTERVAL"
  done
  return 1
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

real_path() {
  node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$1"
}

atomic_link() {
  local target="$1" tmp="$APP_ROOT.next.$$"
  rm -f "$tmp"
  ln -s "$target" "$tmp" || return 1
  node -e 'require("node:fs").renameSync(process.argv[1], process.argv[2])' "$tmp" "$APP_ROOT" || {
    rm -f "$tmp"
    return 1
  }
}

restore_app_link() {
  [ -n "${PREVIOUS_RELEASE:-}" ] || return 0
  if [ -L "$APP_ROOT" ] || [ ! -e "$APP_ROOT" ]; then
    atomic_link "$PREVIOUS_RELEASE"
  fi
}

set_in_progress() {
  printf 'phase=%s\ntarget=%s\nprevious=%s\nsnapshot=%s\nrelease=%s\nprevious_release=%s\nrunner_previous=%s\nreason=%s\nretried=%s\ncandidate=%s\ncandidate_release=%s\n' \
    "$1" "${HELD_TARGET:-$TARGET}" "$PREVIOUS" "${2:-}" "${3:-}" "${4:-}" "${RUNNER_PREVIOUS:-}" \
    "$REASON" "$REPAIR_RETRIED" "$CANDIDATE" "$CANDIDATE_RELEASE" >"$IN_PROGRESS.tmp"
  mv "$IN_PROGRESS.tmp" "$IN_PROGRESS"
}

clear_in_progress() { rm -f "$IN_PROGRESS"; }

mark_failed() {
  mkdir -p "$STATE/failed"
  echo "$2" >"$STATE/failed/$1"
}

recorded() {
  sed -nE "s/.*\"$1\":\"([^\"]*)\".*/\1/p" "$STATE/deployed.json" 2>/dev/null
}

write_record() {
  local sha="$1" previous="$2" result="$3" failed="${4:-}" snapshot="${5:-}" record
  if [ "$result" = deployed ]; then release_lease || return 1; fi
  record="$(printf '{"sha":"%s","previous":"%s","result":"%s","failed":"%s","snapshot":"%s","at":"%s","host":"%s"}\n' \
    "$sha" "$previous" "$result" "$failed" "$snapshot" "$(date -u +%FT%TZ)" "$MACHINE_NAME")"
  printf '%s' "$record" >"$STATE/deployed.json.tmp" && mv "$STATE/deployed.json.tmp" "$STATE/deployed.json"
  printf '%s' "$record" >"$DATA_DIR/deploy.json.tmp" && mv "$DATA_DIR/deploy.json.tmp" "$DATA_DIR/deploy.json"
}

active_work_count() {
  local chief=0 runner=0 computer=0 kind_column
  if [ -s "$DB" ]; then
    kind_column="$(sqlite_ro "$DB" "select count(*) from pragma_table_info('step') where name='kind'" 2>/dev/null || echo 0)"
    if [ "$kind_column" = 1 ]; then
      chief="$(sqlite_ro "$DB" "select count(*) from step where kind='chief' and status='claimed' and machineId is null" 2>/dev/null || echo 0)"
    fi
    if [ -n "$RUNNER_CHECKOUT" ]; then
      runner="$(sqlite_ro "$DB" "select count(*) from step where status='claimed' and machineId is not null" 2>/dev/null || echo 0)"
    fi
    computer="$(sqlite_ro "$DB" "select count(*) from computer_call where state in ('dispatched','running') and tool <> 'request_takeover'" 2>/dev/null || echo 0)"
  fi
  echo $((chief + runner + computer))
}

acquire_lease() {
  local status fresh=0
  [ -n "$LEASE_OWNER" ] || { LEASE_OWNER="$(node -e 'process.stdout.write(crypto.randomUUID())')"; fresh=1; }
  printf '%s\n' "$LEASE_OWNER" >"$STATE/lease-owner"
  status="$(lease_request -X PUT --data-binary "{\"owner\":\"$LEASE_OWNER\",\"ttlMs\":3600000}")" || true
  case "$status" in
    200) ;;
    404) refuse "server lacks the deployment lease endpoint" ;;
    000 | '')
      if [ "${ALLOW_DEAD_HTTP:-0}" = 1 ]; then
        if [ "$fresh" = 1 ]; then LEASE_OWNER=""; rm -f "$STATE/lease-owner"; fi
        return 1
      fi
      refuse "no response to the deployment lease request"
      ;;
    *) refuse "deployment lease request answered HTTP $status" ;;
  esac
}

wait_for_active_work() {
  local deadline=$(( $(date +%s) + COORDINATOR_WAIT_SECONDS )) open
  while :; do
    open="$(active_work_count)"
    [[ "$open" =~ ^[0-9]+$ ]] || refuse "invalid active work count"
    [ "$open" = 0 ] && return 0
    if [ "$(date +%s)" -ge "$deadline" ]; then
      busy "active Coordinator turn, runner step, or computer call still open ($open after ${COORDINATOR_WAIT_SECONDS}s)"
    fi
    sleep 1
  done
}

package_manager() {
  node -e 'const p=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(p.packageManager)' \
    "$1/package.json"
}

check_out_target() {
  git -C "$BUILD_CHECKOUT" fetch -q --tags --force origin main &&
  git -C "$BUILD_CHECKOUT" checkout -q --detach "$TARGET"
}

install_dependencies_in() {
  local dir="$1" pkg
  pkg="$(package_manager "$dir")" || return 1
  (cd "$dir" && npx -y "$pkg" install --frozen-lockfile --ignore-scripts --reporter=silent)
}

build_target() {
  local pkg
  pkg="$(package_manager "$BUILD_CHECKOUT")" || return 1
  (cd "$BUILD_CHECKOUT/apps/server" && node build.mjs) || return 1
  (cd "$BUILD_CHECKOUT" && npx -y "$pkg" --filter @cairn/web build)
}

rehearse_migrations() {
  local copy="$SCRATCH/server.db" count
  rm -rf "$SCRATCH" || return 1
  mkdir -p "$SCRATCH" || return 1
  sqlite3 "$DB" ".backup '$copy'" || return 1
  count="$(sqlite3 "$copy" 'select count(*) from __drizzle_migrations')" || return 1
  [ "$count" -gt 0 ] || return 1
  (cd "$BUILD_CHECKOUT" && node --import tsx --input-type=module \
    -e 'const { openDbWithHandle } = await import(process.argv[1]); openDbWithHandle(process.argv[2]).close();' \
    "$BUILD_CHECKOUT/apps/server/src/db/client.ts" "$copy") || return 1
  [ "$(sqlite3 "$copy" 'pragma integrity_check')" = ok ] || return 1
  [ -z "$(sqlite3 "$copy" 'pragma foreign_key_check')" ] || return 1
  rm -rf "$SCRATCH"
}

stage_release() {
  RELEASE_DIR="$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-${TARGET:0:12}"
  [ ! -e "$RELEASE_DIR" ] || RELEASE_DIR="$RELEASE_DIR-$$"
  node "$OPS_DIR/stage-server-artifact.mjs" "$BUILD_CHECKOUT" "$RELEASE_DIR" "$TARGET" || return 1
  local sidecar
  for sidecar in "$PREVIOUS_RELEASE"/tsnet-sidecar*; do
    [ ! -f "$sidecar" ] || cp -p "$sidecar" "$RELEASE_DIR/" || return 1
  done
}

prepare_runner() {
  [ -n "$RUNNER_CHECKOUT" ] || return 0
  RUNNER_CHECKOUT_DIRTY=1
  git -C "$RUNNER_CHECKOUT" fetch -q --tags --force origin main || return 1
  git -C "$RUNNER_CHECKOUT" checkout -q --detach "$TARGET" || return 1
  install_dependencies_in "$RUNNER_CHECKOUT" || return 1
  [ -f "$RUNNER_CHECKOUT/apps/daemon/src/cli.ts" ]
}

restore_runner_checkout() {
  [ -n "$RUNNER_CHECKOUT" ] || return 0
  local target_sha="${1:-$RUNNER_PREVIOUS}"
  [ -n "$target_sha" ] || return 0
  git -C "$RUNNER_CHECKOUT" checkout -q --detach "$target_sha" || return 1
  install_dependencies_in "$RUNNER_CHECKOUT" || return 1
  RUNNER_CHECKOUT_DIRTY=0
}

deployed_sha() {
  local raw=""
  [ -f "$APP_ROOT/DEPLOYED_SHA" ] && raw="$(head -n1 "$APP_ROOT/DEPLOYED_SHA" | tr -d '[:space:]')"
  [ -n "$raw" ] || return 1
  git -C "$BUILD_CHECKOUT" rev-parse --verify "$raw^{commit}" 2>/dev/null
}

prepare_previous_release() {
  PREVIOUS_RELEASE=""
  if [ -L "$APP_ROOT" ] || [ ! -d "$APP_ROOT" ]; then
    [ -e "$APP_ROOT" ] || refuse "application path $APP_ROOT does not exist"
    PREVIOUS_RELEASE="$(real_path "$APP_ROOT")"
    [ -f "$PREVIOUS_RELEASE/DEPLOYED_SHA" ] || refuse "active release has no DEPLOYED_SHA"
    return 0
  fi
  PREVIOUS_RELEASE="$RELEASES/legacy-$(date -u +%Y%m%dT%H%M%SZ)-${PREVIOUS:0:12}"
  [ ! -e "$PREVIOUS_RELEASE" ] || refuse "legacy release path already exists"
  mkdir -p "$PREVIOUS_RELEASE" || refuse "cannot create legacy release"
  rsync -a "$APP_ROOT/" "$PREVIOUS_RELEASE/" || refuse "cannot copy the legacy application directory"
  printf '%s\n' "$PREVIOUS" >"$PREVIOUS_RELEASE/DEPLOYED_SHA"
}

snapshot_db() {
  SNAPSHOT="$BACKUPS/predeploy-$(date -u +%Y%m%dT%H%M%SZ)-${PREVIOUS:0:12}.db"
  sqlite3 "$DB" ".backup '$SNAPSHOT'" || return 1
  [ "$(sqlite3 "file:${SNAPSHOT}?immutable=1" 'pragma integrity_check')" = ok ] || return 1
}

UNTRACKED_TABLES=" __drizzle_migrations deploy_lease "
HEARTBEAT_COLUMNS=" machine.lastSeenAt machine.capabilities "

user_tables() {
  local names
  names="$(sqlite_ro "$1" "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")" || return 1
  [ -n "$names" ] || return 1
  while read -r table; do [[ "$UNTRACKED_TABLES" == *" $table "* ]] || echo "$table"; done <<<"$names"
}

quoted_columns() {
  local names column quoted=""
  names="$(sqlite_ro "$1" "select name from pragma_table_info('$2')")" || return 1
  while read -r column; do
    [[ "$HEARTBEAT_COLUMNS" == *" $2.$column "* ]] && continue
    quoted+="${quoted:+,}\"${column//\"/\"\"}\""
  done <<<"$names"
  echo "${quoted:-1}"
}

added_column_checks() {
  sqlite_ro "$DB" "attach 'file:${1}?immutable=1' as snap;
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
    differing="$(sqlite_ro "$DB" "attach 'file:${snapshot}?immutable=1' as snap;
      select (select count(*) from (select $columns from main.\"$table\" except select $columns from snap.\"$table\"))
           + (select count(*) from (select $columns from snap.\"$table\" except select $columns from main.\"$table\"))
           + (select count(*) from main.\"$table\" where ${added:-0});")" || return 0
    [ "$differing" = 0 ] || return 0
  done <<<"$snapshot_tables"
  while read -r table; do
    grep -qxF "$table" <<<"$snapshot_tables" && continue
    [ "$(sqlite_ro "$DB" "select count(*) from \"$table\"")" = 0 ] || return 0
  done <<<"$current_tables"
  return 1
}

restore_snapshot() {
  local snapshot="$1" failed_dir="$2" file
  [ -s "$snapshot" ] || return 1
  mkdir -p "$failed_dir" || return 1
  for file in server.db server.db-wal server.db-shm; do
    [ ! -e "$DATA_DIR/$file" ] || mv "$DATA_DIR/$file" "$failed_dir/$file.$(date -u +%Y%m%dT%H%M%SZ).$$" || return 1
  done
  cp "$snapshot" "$DB.restoring" && mv "$DB.restoring" "$DB"
}

critical() {
  write_record "$PREVIOUS" "$PREVIOUS" rollback-unhealthy "$TARGET" "${SNAPSHOT:-}" || true
  clear_in_progress
  echo "CRITICAL: $*" >&2
  exit "$EXIT_ROLLBACK_UNHEALTHY"
}

marker_state() {
  local count
  [ -s "$DB" ] || { echo error; return 0; }
  count="$(sqlite_ro "$DB" "select count(*) from sqlite_master where type = 'trigger' and name = '$STEP_MARKER'" 2>/dev/null)" ||
    { echo error; return 0; }
  case "$count" in 0) echo absent ;; 1) echo present ;; *) echo error ;; esac
}

artifact_marker_aware() {
  marker_aware_check "$1"
}

previous_may_open_live_db() {
  MARKER_STATE="$(marker_state)"
  case "$MARKER_STATE" in
    absent) return 0 ;;
    present) artifact_marker_aware "$PREVIOUS_RELEASE" ;;
    *) return 1 ;;
  esac
}

hold_repair() {
  LEASE_FROZEN=1
  REASON="${1//$'\n'/ }"
  set_in_progress "$JOURNAL_PHASE" "${SNAPSHOT:-}" "${HELD_RELEASE:-${RELEASE_DIR:-}}" "${PREVIOUS_RELEASE:-}"
  write_record "${HELD_TARGET:-$TARGET}" "$PREVIOUS" repair-required "${HELD_TARGET:-$TARGET}" "${SNAPSHOT:-}" || true
  echo "CRITICAL: $REASON; step storage kept, old code not started" >&2
  exit "$EXIT_ROLLBACK_UNHEALTHY"
}

freeze_unconfirmed() {
  LEASE_FROZEN=1
  echo "CRITICAL: $1" >&2
  exit "$EXIT_ROLLBACK_UNHEALTHY"
}

restart_previous() {
  log "restarting $PREVIOUS: $1"
  if [ "$STOP_FIRST" = 1 ]; then
    runner_stop || hold_repair "could not stop the runner before restarting $PREVIOUS"
    service_stop || hold_repair "could not stop the server before restarting $PREVIOUS"
    previous_may_open_live_db || hold_repair "step storage is marked and $PREVIOUS may not write it; $1"
  fi
  restore_app_link || true
  if [ -n "$RUNNER_CHECKOUT" ] && [ -n "$RUNNER_PREVIOUS" ]; then
    restore_runner_checkout "$RUNNER_PREVIOUS" || true
  fi
  if service_start && server_healthy && runner_start && runner_healthy; then
    clear_in_progress
    echo "$1; restarted $PREVIOUS with its DB untouched" >&2
    exit 1
  fi
  critical "$1, and $PREVIOUS did not come back healthy"
}

roll_back() {
  local reason="$1" failed_dir
  log "rolling back to $PREVIOUS: $reason"
  runner_stop || hold_repair "could not stop the runner to roll back $TARGET"
  service_stop || hold_repair "could not stop the server to roll back $TARGET"
  previous_may_open_live_db || hold_repair "step storage is marked and $PREVIOUS may not write it; $reason"
  mark_failed "$TARGET" "$reason"
  restore_app_link || critical "could not point the application path at $PREVIOUS_RELEASE"
  restore_runner_checkout "$RUNNER_PREVIOUS" || critical "could not restore runner checkout to $RUNNER_PREVIOUS"
  if writes_after_snapshot "$SNAPSHOT"; then
    log "data changed after the snapshot; keeping the DB and rolling back code only"
    if service_start && server_healthy && runner_start && runner_healthy; then
      write_record "$PREVIOUS" "$PREVIOUS" rolled-back-code "$TARGET" "$SNAPSHOT"
      clear_in_progress
      echo "deploy of $TARGET failed ($reason); rolled code back to $PREVIOUS and kept the DB, which changed after the snapshot" >&2
      exit 1
    fi
    critical "$PREVIOUS is unhealthy on the DB that changed after the snapshot"
  fi
  failed_dir="$BACKUPS/failed-$(date -u +%Y%m%dT%H%M%SZ)-${TARGET:0:12}"
  set_in_progress restoring "$SNAPSHOT" "$RELEASE_DIR" "$PREVIOUS_RELEASE"
  restore_snapshot "$SNAPSHOT" "$failed_dir" || critical "restoring $SNAPSHOT failed; failed DB in $failed_dir"
  set_in_progress restored "$SNAPSHOT" "$RELEASE_DIR" "$PREVIOUS_RELEASE"
  if service_start && server_healthy && runner_start && runner_healthy; then
    write_record "$PREVIOUS" "$PREVIOUS" rolled-back "$TARGET" "$SNAPSHOT"
    clear_in_progress
    echo "deploy of $TARGET failed ($reason); rolled back to $PREVIOUS, failed DB kept in $failed_dir" >&2
    exit 1
  fi
  critical "rollback to $PREVIOUS is unhealthy"
}

prune_old() {
  ls -1 "$BACKUPS"/predeploy-*.db 2>/dev/null | sort -r | tail -n +"$((KEEP_SNAPSHOTS + 1))" | while read -r file; do rm -f "$file"; done
  ls -1d "$RELEASES"/* 2>/dev/null | sort -r | tail -n +"$((KEEP_RELEASES + 1))" | while read -r dir; do
    [ "$dir" = "$PREVIOUS_RELEASE" ] || [ "$dir" = "${RELEASE_DIR:-}" ] || rm -rf "$dir"
  done
}

recover_interrupted() {
  [ -e "$IN_PROGRESS" ] || return 0
  local phase="" snapshot="" release="" previous_release="" runner_prev="" key value
  while IFS='=' read -r key value; do
    case "$key" in
      phase) phase="$value" ;;
      target) TARGET="$value" ;;
      previous) PREVIOUS="$value" ;;
      snapshot) snapshot="$value" ;;
      release) release="$value" ;;
      previous_release) previous_release="$value" ;;
      runner_previous) runner_prev="$value" ;;
      reason) REASON="$value" ;;
      retried) REPAIR_RETRIED="$value" ;;
      candidate) CANDIDATE="$value" ;;
      candidate_release) CANDIDATE_RELEASE="$value" ;;
    esac
  done <"$IN_PROGRESS"
  SNAPSHOT="$snapshot"
  RELEASE_DIR="$release"
  PREVIOUS_RELEASE="$previous_release"
  RUNNER_PREVIOUS="${runner_prev:-$PREVIOUS}"
  log "recovering an interrupted deploy of $TARGET (phase $phase)"
  case "$phase" in
    repair-required | repairing) JOURNAL_PHASE="$phase"; repair_forward ;;
  esac
  if [ "$phase" = building ]; then
    if [ -n "$RUNNER_CHECKOUT" ] && [ -n "$RUNNER_PREVIOUS" ]; then
      restore_runner_checkout "$RUNNER_PREVIOUS" || true
    fi
    clear_in_progress
    return 0
  fi
  if [ "$phase" != restoring ] && [ "$phase" != restored ] && ! ALLOW_DEAD_HTTP=1 acquire_lease; then
    runner_stop || freeze_unconfirmed "could not confirm the runner stopped with the server unreachable"
    service_stop || freeze_unconfirmed "could not confirm the server stopped while it was unreachable"
  fi
  if [ "$phase" = restoring ] || [ "$phase" = restored ]; then
    runner_stop || freeze_unconfirmed "could not confirm the runner stopped during recovery"
    service_stop || freeze_unconfirmed "could not confirm the server stopped during recovery"
    restore_app_link || critical "could not restore the previous application path"
    restore_runner_checkout "$RUNNER_PREVIOUS" || critical "could not restore runner checkout during recovery"
    if [ "$phase" = restoring ]; then
      restore_snapshot "$SNAPSHOT" "$BACKUPS/failed-recovery-${TARGET:0:12}" || critical "could not restore $SNAPSHOT during recovery"
    fi
    if service_start && server_healthy && runner_start && runner_healthy; then
      write_record "$PREVIOUS" "$PREVIOUS" rolled-back "$TARGET" "$SNAPSHOT"
      clear_in_progress
      exit 1
    fi
    critical "interrupted rollback is unhealthy"
  fi
  if [ -n "$RELEASE_DIR" ] && [ "$(real_path "$APP_ROOT" 2>/dev/null || echo missing)" = "$(real_path "$RELEASE_DIR" 2>/dev/null || echo none)" ]; then
    if service_start && server_healthy && runner_start && runner_healthy; then
      write_record "$TARGET" "$PREVIOUS" deployed "" "$SNAPSHOT"
      clear_in_progress
      return 0
    fi
    [ -s "$SNAPSHOT" ] && roll_back "interrupted deploy was unhealthy"
  fi
  [ -s "$SNAPSHOT" ] && roll_back "interrupted deploy had no healthy target"
  STOP_FIRST=1
  restart_previous "interrupted deploy had no snapshot"
}

build_candidate() {
  check_out_target && install_dependencies_in "$BUILD_CHECKOUT" && rehearse_migrations && build_target && stage_release && prepare_runner
}

select_repair_candidate() {
  local sha required_csv="${REQUIRED_CHECKS// /,}"
  git -C "$BUILD_CHECKOUT" fetch -q --tags --force origin main || return 1
  while read -r sha; do
    [ ! -e "$STATE/failed/$sha" ] || continue
    [ "$sha" != "$HELD_TARGET" ] || [ "$REPAIR_RETRIED" = 0 ] || continue
    git -C "$BUILD_CHECKOUT" grep -qiF "$STEP_MARKER" "$sha" -- 'apps/server/drizzle/*.sql' || continue
    node "$OPS_DIR/github-ci-evidence.mjs" --repo "$REPO" --sha "$sha" --required "$required_csv" --state "$STATE" >/dev/null 2>&1 || continue
    CANDIDATE="$sha"
    [ "$sha" != "$HELD_TARGET" ] || REPAIR_RETRIED=1
    return 0
  done < <(git -C "$BUILD_CHECKOUT" rev-list --first-parent --max-count "$SCAN_COMMITS" origin/main)
  return 1
}

repair_failed() {
  mark_failed "$CANDIDATE" "$1"
  CANDIDATE=""
  CANDIDATE_RELEASE=""
  JOURNAL_PHASE=repair-required
  hold_repair "$1"
}

local_version_commit() {
  health_url_is_loopback || return 1
  auth_config |
    curl -fsS --noproxy '*' --max-time 10 -K - -H "Origin: $HEALTH_URL" "$HEALTH_URL/api/server/version" |
    sed -nE 's/.*"commit"[[:space:]]*:[[:space:]]*"([0-9a-f]{7,40})".*/\1/p'
}

repair_attested() {
  local commit
  commit="$(local_version_commit)" || return 1
  [ -n "$commit" ] && [[ "$CANDIDATE" == "$commit"* ]] || return 1
  [ -z "$RUNNER_CHECKOUT" ] || [ "$(git -C "$RUNNER_CHECKOUT" rev-parse HEAD 2>/dev/null)" = "$CANDIDATE" ] || return 1
  [ "$(marker_state)" = present ]
}

repair_succeeded() {
  LEASE_FROZEN=0
  RUNNER_CHECKOUT_DIRTY=0
  RELEASE_DIR="$CANDIDATE_RELEASE"
  TARGET="$CANDIDATE"
  write_record "$CANDIDATE" "$HELD_TARGET" deployed "" "${SNAPSHOT:-}" || hold_repair "could not release the frozen lease after repair"
  clear_in_progress
  prune_old
  log "rolled forward to $CANDIDATE after $HELD_TARGET held the step storage"
  exit 0
}

repair_forward() {
  LEASE_FROZEN=1
  HELD_TARGET="$TARGET"
  HELD_RELEASE="$RELEASE_DIR"
  [ -s "$DB" ] || hold_repair "live database is missing; refusing to start an empty one"
  if [ "$JOURNAL_PHASE" = repairing ] && [ -n "$CANDIDATE_RELEASE" ] &&
    [ "$(real_path "$APP_ROOT" 2>/dev/null || echo missing)" = "$(real_path "$CANDIDATE_RELEASE" 2>/dev/null || echo none)" ] &&
    [ "$(probe /app)" = 200 ] && server_healthy && runner_healthy && repair_attested; then
    repair_succeeded
  fi
  runner_stop || hold_repair "could not confirm the runner stopped"
  service_stop || hold_repair "could not confirm the server stopped"
  if previous_may_open_live_db; then
    LEASE_FROZEN=0
    roll_back "${REASON:-held deploy of $TARGET}"
  fi
  [ "$MARKER_STATE" = present ] || hold_repair "the step marker on the live database is unreadable"
  if [ "$JOURNAL_PHASE" = repairing ] && [ -f "$CANDIDATE_RELEASE/DEPLOYED_SHA" ] && artifact_marker_aware "$CANDIDATE_RELEASE"; then
    RELEASE_DIR="$CANDIDATE_RELEASE"
  else
    CANDIDATE=""
    if ! select_repair_candidate; then
      log "holding $TARGET: waiting for a different compatible green build"
      exit 0
    fi
    TARGET="$CANDIDATE"
    build_candidate && artifact_marker_aware "$RELEASE_DIR" || repair_failed "candidate $CANDIDATE could not be built with the step marker"
    CANDIDATE_RELEASE="$RELEASE_DIR"
    JOURNAL_PHASE=repairing
    set_in_progress repairing "${SNAPSHOT:-}" "$HELD_RELEASE" "$PREVIOUS_RELEASE"
  fi
  TARGET="$CANDIDATE"
  atomic_link "$CANDIDATE_RELEASE" || repair_failed "could not point the application path at $CANDIDATE"
  if service_start && server_healthy && runner_start && runner_healthy && repair_attested; then
    repair_succeeded
  fi
  runner_stop || true
  service_stop || true
  repair_failed "candidate $CANDIDATE did not attest its commit, Runner and step marker"
}

[[ "$COORDINATOR_WAIT_SECONDS" =~ ^[0-9]+$ ]] || refuse "coordinator wait must be a nonnegative integer"
recover_interrupted
[ "$RECOVER_ONLY" = 0 ] || exit 0

git -C "$BUILD_CHECKOUT" fetch -q --tags --force origin main || refuse "cannot fetch origin/main"
git -C "$BUILD_CHECKOUT" merge-base --is-ancestor "$TARGET" origin/main || refuse "$TARGET is not on origin/main"
[ ! -e "$STATE/hold" ] || busy "hold: $(head -n1 "$STATE/hold")"
[ ! -e "$STATE/failed/$TARGET" ] || refuse "$TARGET already failed: $(head -n1 "$STATE/failed/$TARGET")"
PREVIOUS="$(deployed_sha)" || refuse "cannot resolve the currently deployed SHA"
if [ -n "$RUNNER_CHECKOUT" ]; then
  RUNNER_PREVIOUS="$(git -C "$RUNNER_CHECKOUT" rev-parse HEAD 2>/dev/null)" || refuse "cannot resolve runner checkout HEAD"
fi
if [ "$PREVIOUS" = "$TARGET" ]; then
  if server_healthy && runner_healthy; then
    write_record "$TARGET" "$(recorded previous)" deployed "" ""
    log "already deployed: $TARGET"
    exit 0
  fi
  echo "already at $TARGET but unhealthy; recover by hand" >&2
  exit 1
fi

required_csv="${REQUIRED_CHECKS// /,}"
evidence_error="$(node "$OPS_DIR/github-ci-evidence.mjs" --repo "$REPO" --sha "$TARGET" --required "$required_csv" --state "$STATE" 2>&1)" ||
  refuse "$evidence_error"

prepare_previous_release
log "building $TARGET"
set_in_progress building
if ! build_candidate; then
  mark_failed "$TARGET" "install, build, runner prepare, or migration rehearsal failed"
  clear_in_progress
  echo "install, build, runner prepare, or migration rehearsal failed for $TARGET; running services untouched" >&2
  exit 1
fi
live_marker="$(marker_state)"
if [ "$live_marker" = error ]; then
  clear_in_progress
  echo "the step marker on the live database is unreadable; running services untouched" >&2
  exit 1
fi
if [ "$live_marker" = present ] && ! artifact_marker_aware "$RELEASE_DIR"; then
  mark_failed "$TARGET" "the live database is marked and the staged artifact cannot write it"
  clear_in_progress
  echo "$TARGET cannot write the marked step storage; running services untouched" >&2
  exit 1
fi
clear_in_progress

log "pausing claims and waiting for in-server work"
acquire_lease
wait_for_active_work

log "snapshotting the live database"
if ! snapshot_db; then
  restart_previous "the DB snapshot failed"
fi

log "switching $APP_ROOT to $RELEASE_DIR"
set_in_progress switching "$SNAPSHOT" "$RELEASE_DIR" "$PREVIOUS_RELEASE"
runner_stop || restart_previous "stopping the runner failed"
service_stop || restart_previous "stopping the server failed"
if [ -d "$APP_ROOT" ] && [ ! -L "$APP_ROOT" ]; then
  legacy_moved="$STATE/legacy-root"
  [ ! -e "$legacy_moved" ] || critical "legacy root backup already exists"
  mv "$APP_ROOT" "$legacy_moved" || restart_previous "moving the legacy application directory failed"
  atomic_link "$RELEASE_DIR" || {
    mv "$legacy_moved" "$APP_ROOT" || true
    restart_previous "pointing the application path at the target failed"
  }
else
  atomic_link "$RELEASE_DIR" || restart_previous "pointing the application path at the target failed"
fi
set_in_progress switched "$SNAPSHOT" "$RELEASE_DIR" "$PREVIOUS_RELEASE"
service_start || roll_back "starting the server failed"
if ! server_healthy; then
  roll_back "health check failed after starting $TARGET"
fi
runner_start || roll_back "starting the runner failed"
if ! runner_healthy; then
  roll_back "runner health check failed after starting $TARGET"
fi

RUNNER_CHECKOUT_DIRTY=0
write_record "$TARGET" "$PREVIOUS" deployed "" "$SNAPSHOT"
clear_in_progress
prune_old
log "deployed $TARGET (previous $PREVIOUS)"
