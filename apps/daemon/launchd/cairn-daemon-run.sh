#!/bin/sh
# Guarded cairn daemon launcher for launchd (user domain).
#
# A daemon that is still running gets CAIRN_RUN_TWIN_WAIT_S seconds to exit,
# since `launchctl kickstart -k` starts this launcher while the old daemon is
# still shutting down. If it outlives the wait the launcher exits 75: with
# KeepAlive {SuccessfulExit: false} launchd relaunches it after the throttle,
# so the job comes back once the other daemon is gone.
# pgrep -f takes an ERE: the pattern is end-anchored (verify-stack daemons
# carry extra args and must not match), `[.]` keeps the pattern from matching
# this script's own command line, and the server URL is dot-escaped.
set -u

REPO="@CAIRN_REPO@"
NODE_BIN="@NODE_BIN@"

CAIRN_HOME_DIR="${CAIRN_HOME:-$HOME/.cairn}"
SERVER_URL="${CAIRN_SERVER:-http://127.0.0.1:8787}"
DAEMON_JSON="$CAIRN_HOME_DIR/daemon.json"

note() { printf '%s [cairn-daemon-run] %s\n' "$(date '+%F %T')" "$*"; }

TWIN_WAIT_S="${CAIRN_RUN_TWIN_WAIT_S:-20}"

supervisor_twin() {
  [ -f "$DAEMON_JSON" ] || return 1
  twin_pid="$(sed -n 's/.*"pid"[ :]*\([0-9][0-9]*\).*/\1/p' "$DAEMON_JSON" | head -n 1)"
  [ -n "${twin_pid:-}" ] && kill -0 "$twin_pid" 2>/dev/null
}

foreground_twin() {
  command -v pgrep >/dev/null 2>&1 && command -v lsof >/dev/null 2>&1 || return 1
  server_re="$(printf '%s' "$SERVER_URL" | sed 's/\./[.]/g')"
  for pid in $(pgrep -f "src/cli[.]ts start -f(\$| .*--server $server_re)" 2>/dev/null); do
    [ "$pid" = "$$" ] && continue
    if lsof -nP -a -p "$pid" -d cwd 2>/dev/null | grep -q "$REPO"; then
      twin_pid="$pid"
      return 0
    fi
  done
  return 1
}

if ! command -v pgrep >/dev/null 2>&1 || ! command -v lsof >/dev/null 2>&1; then
  note "WARNING: pgrep/lsof unavailable, G2 foreground check skipped (G1 still guards supervisor twins)"
fi

waited=0
while supervisor_twin || foreground_twin; do
  if [ "$waited" -ge "$TWIN_WAIT_S" ]; then
    note "another daemon is still running (pid $twin_pid) after ${TWIN_WAIT_S}s; exiting 75 so launchd retries"
    exit 75
  fi
  [ "$waited" -eq 0 ] && note "waiting up to ${TWIN_WAIT_S}s for daemon pid $twin_pid to exit"
  sleep 1
  waited=$((waited + 1))
done

if [ ! -d "$REPO" ]; then
  note "ERROR: checkout missing: $REPO (plist WorkingDirectory points at a removed worktree?)" >&2
  exit 1
fi
TSX_ENTRY="$REPO/apps/daemon/node_modules/tsx/dist/cli.mjs"
if [ ! -x "$NODE_BIN" ]; then
  note "ERROR: node not executable: $NODE_BIN (fnm default moved? re-run install.sh)" >&2
  exit 1
fi
if [ ! -f "$TSX_ENTRY" ]; then
  note "ERROR: tsx entry missing: $TSX_ENTRY (run pnpm install in $REPO first)" >&2
  exit 1
fi

note "starting foreground daemon (server $SERVER_URL, home $CAIRN_HOME_DIR)"
cd "$REPO/apps/daemon" || exit 1
exec "$NODE_BIN" "$TSX_ENTRY" src/cli.ts start -f
