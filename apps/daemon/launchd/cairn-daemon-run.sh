#!/bin/sh
# Guarded cairn daemon launcher for launchd (user domain).
#
# Why this wrapper exists: `cli.ts start -f` (foreground) carries no
# singleton lock — the daemon.json pid guard only covers `start`
# (supervisor mode). Without this check, a launchd job plus a manual
# `pnpm dev:daemon` on the same checkout would both claim steps from the
# server. Either guard hit means "already running" and exits 0:
# with KeepAlive {SuccessfulExit: false} a clean exit is NOT relaunched,
# while a crash still is.
#
# Guards (read-only, never kills — port/cwd钉选 discipline):
#   G1  $CAIRN_HOME/daemon.json holds a live pid (supervisor-mode twin).
#   G2  a bare `src/cli.ts start -f` foreground process whose cwd is this
#       checkout (manual `pnpm dev:daemon` twin). The pgrep pattern is
#       end-anchored so verify-stack daemons (extra --server/--api-key
#       args) never match; each hit is confirmed via lsof cwd, never by
#       shape alone. The `[.]` keeps the pattern from matching this
#       script's own command line.
set -u

REPO="@CAIRN_REPO@"
NODE_BIN="@NODE_BIN@"

CAIRN_HOME_DIR="${CAIRN_HOME:-$HOME/.cairn}"
SERVER_URL="${CAIRN_SERVER:-http://127.0.0.1:8787}"
DAEMON_JSON="$CAIRN_HOME_DIR/daemon.json"

note() { printf '%s [cairn-daemon-run] %s\n' "$(date '+%F %T')" "$*"; }

# G1: supervisor-mode twin via daemon.json.
if [ -f "$DAEMON_JSON" ]; then
  twin_pid="$(sed -n 's/.*"pid"[ :]*\([0-9][0-9]*\).*/\1/p' "$DAEMON_JSON" | head -n 1)"
  if [ -n "${twin_pid:-}" ] && kill -0 "$twin_pid" 2>/dev/null; then
    note "already running as supervisor (pid $twin_pid from $DAEMON_JSON); exiting 0"
    exit 0
  fi
fi

# G2: foreground twin from this same checkout.
if command -v pgrep >/dev/null 2>&1 && command -v lsof >/dev/null 2>&1; then
  # Escape the server URL for ERE (dots and slashes only; scheme/host/port shape).
  server_re="$(printf '%s' "$SERVER_URL" | sed 's/\./[.]/g')"
  for pid in $(pgrep -f "src/cli[.]ts start -f(\$| .*--server $server_re)" 2>/dev/null); do
    [ "$pid" = "$$" ] && continue
    if lsof -nP -a -p "$pid" -d cwd 2>/dev/null | grep -q "$REPO"; then
      note "already running in foreground (pid $pid, cwd under $REPO); exiting 0"
      exit 0
    fi
  done
else
  note "WARNING: pgrep/lsof unavailable, G2 foreground check skipped (G1 still guards supervisor twins)"
fi

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
