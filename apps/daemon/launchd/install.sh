#!/bin/sh
# Install (or remove) the cairn daemon user-domain launchd job.
#
#   install.sh                        render + bootstrap com.xiechimon.cairn-daemon
#   install.sh --uninstall             bootout + remove the plist (leaves logs)
#   install.sh --label NAME            job label override (test jobs)
#   install.sh --repo DIR              checkout override (default: main checkout)
#   install.sh --home DIR              CAIRN_HOME override (default: ~/.cairn)
#   install.sh --server URL            CAIRN_SERVER override (test jobs)
#
# Installed artifacts live OUTSIDE the repo (plist in ~/Library/LaunchAgents,
# rendered wrapper in $HOME_DIR) so deleting this checkout never orphans the
# job. Re-run after pulling daemon updates. Test jobs pass --label plus
# --home/--server so the real daemon is never disturbed — the run.sh
# singleton guard is scoped to its own home/server/cwd, not global.
#
# User domain only: refuses root/sudo (a system-domain job needs a reboot to
# take effect and must never host this).
set -eu

LABEL="com.xiechimon.cairn-daemon"
REPO="/Users/xmon/Code/AgentProjects/cairn"
NODE_BIN="/Users/xmon/.local/share/fnm/node-versions/v24.14.0/installation/bin/node"
HOME_DIR="$HOME/.cairn"
SERVER_URL=""
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --home) HOME_DIR="$2"; shift 2 ;;
    --server) SERVER_URL="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" = "0" ]; then
  echo "refusing: run as your user, never under sudo (user-domain job only)" >&2
  exit 1
fi

UID_N="$(id -u)"
DOMAIN_TARGET="gui/$UID_N"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUN_DEST="$HOME_DIR/cairn-daemon-run.sh"
HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$HERE/com.xiechimon.cairn-daemon.plist.template"
RUN_SRC="$HERE/cairn-daemon-run.sh"

if [ "$UNINSTALL" = "1" ]; then
  if launchctl list "$LABEL" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN_TARGET/$LABEL"
    echo "booted out $LABEL"
  else
    echo "$LABEL not loaded; nothing to boot out"
  fi
  rm -f "$DEST"
  echo "removed $DEST (wrapper copy and logs kept under $HOME_DIR)"
  exit 0
fi

if [ ! -f "$TEMPLATE" ] || [ ! -f "$RUN_SRC" ]; then
  echo "missing template or wrapper next to $0" >&2
  exit 1
fi
if [ ! -x "$NODE_BIN" ]; then
  echo "node not executable: $NODE_BIN (fnm default moved? edit NODE_BIN in $0)" >&2
  exit 1
fi
mkdir -p "$HOME/Library/LaunchAgents" "$HOME_DIR"

esc() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
REPO_ESC="$(esc "$REPO")"
RUN_ESC="$(esc "$RUN_DEST")"
HOME_ESC="$(esc "$HOME_DIR")"

# Rendered wrapper copy: the installed job never depends on this checkout.
sed -e "s|@CAIRN_REPO@|$REPO_ESC|g" -e "s|@NODE_BIN@|$(esc "$NODE_BIN")|g" \
  "$RUN_SRC" > "$RUN_DEST"
chmod +x "$RUN_DEST"

NODE_DIR="$(dirname "$NODE_BIN")"
# BSD sed cannot substitute multiline text; feed the env block via r-file.
ENV_SNIPPET="$(mktemp)"
trap 'rm -f "$ENV_SNIPPET"' EXIT
if [ -n "$SERVER_URL" ] || [ "$HOME_DIR" != "$HOME/.cairn" ]; then
  {
    printf '    <key>CAIRN_HOME</key>\n    <string>%s</string>\n' "$HOME_DIR"
    if [ -n "$SERVER_URL" ]; then
      printf '    <key>CAIRN_SERVER</key>\n    <string>%s</string>\n' "$SERVER_URL"
    fi
  } > "$ENV_SNIPPET"
else
  : > "$ENV_SNIPPET"
fi

sed -e "s|@LABEL@|$LABEL|g" \
    -e "s|@RUN_SH@|$RUN_ESC|g" \
    -e "s|@REPO@|$REPO_ESC|g" \
    -e "s|@NODE_DIR@|$NODE_DIR|g" \
    -e "s|@LOG_DIR@|$HOME_ESC|g" \
    -e "/@EXTRA_ENV@/r $ENV_SNIPPET" \
    -e "/@EXTRA_ENV@/d" \
    "$TEMPLATE" > "$DEST"
plutil -lint "$DEST" >/dev/null && echo "plist lint ok: $DEST"

if launchctl list "$LABEL" >/dev/null 2>&1; then
  echo "$LABEL already loaded; files re-rendered in place."
  echo "apply: launchctl kickstart -k $DOMAIN_TARGET/$LABEL"
else
  launchctl bootstrap "$DOMAIN_TARGET" "$DEST"
  launchctl enable "$DOMAIN_TARGET/$LABEL"
  echo "bootstrapped $LABEL (logs: $HOME_DIR/launchd-daemon.{out,err}.log)"
fi
launchctl list "$LABEL" | head -n 8
