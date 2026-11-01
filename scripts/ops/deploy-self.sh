#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat >&2 <<'EOF'
usage: deploy-self.sh <40-hex sha on origin/main> | --recover

Deploys one green main commit to this host's cairn checkout and user units, with rollback.
  1. refuses a SHA not on origin/main, without every required check green, while autonomy
     is paused, or whose pnpm-workspace.yaml allows a new install script (exit 2)
  2. waits while a step is claimed or $CAIRN_DEPLOY_STATE/hold exists (exit 75)
  3. rehearses the target's migrations on an online copy of the live DB in a scratch worktree
  4. checks out the target, installs with --frozen-lockfile, builds the daemon and web assets
  5. stops daemon and server, snapshots the DB, starts server then daemon, health-checks both
  6. on a failed health check restores the snapshot and the previous checkout (exit 1;
     exit 3 when the rollback itself is unhealthy)
An interrupted deploy leaves $CAIRN_DEPLOY_STATE/in-progress; the next run (or --recover) health-checks
the target and finishes it or rolls it back before doing anything else.
Writes the result to $CAIRN_DEPLOY_STATE/deployed.json and $CAIRN_DATA_DIR/deploy.json.

Environment (defaults in brackets):
  CAIRN_CHECKOUT [~/Code/AgentProjects/cairn]  CAIRN_DATA_DIR [~/.cairn/server]
  CAIRN_DEPLOY_STATE [~/.local/state/cairn-deploy]  CAIRN_DEPLOY_BACKUPS [~/backups/cairn-server/predeploy]
  CAIRN_DEPLOY_SCRATCH [$CAIRN_DEPLOY_STATE/scratch]  CAIRN_REPO [xiechimon/cairn]
  CAIRN_REQUIRED_CHECKS [check pack-smoke e2e-gate]  CAIRN_HEALTH_URL [http://127.0.0.1:8787]
  CAIRN_HEALTH_TRIES [60]  CAIRN_HEALTH_INTERVAL [2]  CAIRN_MACHINE_NAME [hostname -s]
  CAIRN_DEPLOY_KEEP_SNAPSHOTS [10]
EOF
  exit 2
}

CHECKOUT="${CAIRN_CHECKOUT:-$HOME/Code/AgentProjects/cairn}"
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
SERVER_UNIT=cairn-server.service
DAEMON_UNIT=cairn-daemon.service
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
busy() { echo "busy: $*" >&2; exit "$EXIT_BUSY"; }

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
trap 'rm -rf "$LOCK"; rm -f "$RUNNING_COPY"' EXIT

write_record() {
  local sha="$1" previous="$2" result="$3" failed="${4:-}" snapshot="${5:-}"
  local record
  record="$(printf '{"sha":"%s","previous":"%s","result":"%s","failed":"%s","snapshot":"%s","at":"%s","host":"%s"}\n' \
    "$sha" "$previous" "$result" "$failed" "$snapshot" "$(date -u +%FT%TZ)" "$MACHINE_NAME")"
  printf '%s' "$record" >"$STATE/deployed.json.tmp" && mv "$STATE/deployed.json.tmp" "$STATE/deployed.json"
  printf '%s' "$record" >"$DATA_DIR/deploy.json.tmp" && mv "$DATA_DIR/deploy.json.tmp" "$DATA_DIR/deploy.json"
}

mark_failed() {
  mkdir -p "$STATE/failed"
  echo "$2" >"$STATE/failed/$1"
}

claimed_steps() {
  sqlite3 -readonly "$DB" "select count(*) from step where status = 'claimed'"
}

assert_idle() {
  [ ! -e "$STATE/hold" ] || busy "hold: $(head -n1 "$STATE/hold")"
  local running
  running="$(claimed_steps)"
  [ "$running" = 0 ] || busy "$running step running"
}

allow_builds_block() {
  git -C "$CHECKOUT" show "$1:pnpm-workspace.yaml" 2>/dev/null |
    awk '/^allowBuilds:/{inside=1; print; next} inside && /^[^[:space:]#]/{inside=0} inside{print}'
}

install_hooks_changed() {
  git -C "$CHECKOUT" diff "$PREVIOUS" "$TARGET" -- '*package.json' |
    grep -E '^[+-][^+-].*"(pre|post)?(install|prepare)"[[:space:]]*:' || true
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
    (cd "$CHECKOUT" && pnpm -C apps/daemon build) &&
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

stop_services() {
  systemctl --user stop "$DAEMON_UNIT" && systemctl --user stop "$SERVER_UNIT"
}

start_and_check() {
  local started_ms
  [ -s "$DB" ] || { echo "refusing to start services: $DB is missing" >&2; return 1; }
  systemctl --user start "$SERVER_UNIT"
  server_healthy || return 1
  started_ms="$(($(date +%s) * 1000))"
  systemctl --user start "$DAEMON_UNIT"
  daemon_healthy "$started_ms"
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

UNTRACKED_TABLES=" __drizzle_migrations "
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
  printf 'phase=%s\ntarget=%s\nprevious=%s\nsnapshot=%s\nfailed=%s\n' "$1" "$TARGET" "$PREVIOUS" "${2:-}" "${3:-}" >"$IN_PROGRESS.tmp"
  mv "$IN_PROGRESS.tmp" "$IN_PROGRESS"
}

restore_snapshot() {
  local snapshot="$1" failed_dir="$2" file
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
  if [ "$phase" = restoring ]; then
    stop_or_give_up "$snapshot"
    restore_snapshot "$snapshot" "$failed_dir" || {
      echo "CRITICAL: could not restore $snapshot during recovery; marker kept" >&2
      exit "$EXIT_ROLLBACK_UNHEALTHY"
    }
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
assert_idle

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

if ! (assert_idle); then
  switch_code "$PREVIOUS" || echo "CRITICAL: could not rebuild $PREVIOUS" >&2
  clear_in_progress
  busy "a step started during the build; restored $PREVIOUS"
fi

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
