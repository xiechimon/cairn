#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat >&2 <<'USAGE'
usage: install-eval-daily.sh --env-file <path> --launchd [--hour <0-23>] [--minute <0-59>] [--no-load]
USAGE
  exit 2
}

ENV_FILE=""
MODE=""
HOUR="5"
MINUTE="0"
NO_LOAD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --launchd) MODE="launchd"; shift ;;
    --hour) HOUR="${2:-}"; shift 2 ;;
    --minute) MINUTE="${2:-}"; shift 2 ;;
    --no-load) NO_LOAD=1; shift ;;
    *) usage ;;
  esac
done

[ -n "$ENV_FILE" ] && [ "$MODE" = "launchd" ] || usage
[[ "$HOUR" =~ ^[0-9]+$ ]] && [ "$HOUR" -ge 0 ] && [ "$HOUR" -le 23 ] || usage
[[ "$MINUTE" =~ ^[0-9]+$ ]] && [ "$MINUTE" -ge 0 ] && [ "$MINUTE" -le 59 ] || usage
[ -f "$ENV_FILE" ] || { echo "missing env file $ENV_FILE" >&2; exit 2; }

set -a
. "$ENV_FILE"
set +a

REPO="${EVAL_DAILY_REPO:-}"
STATE="${EVAL_DAILY_STATE:-}"
[ -n "$REPO" ] || { echo "EVAL_DAILY_REPO is required in $ENV_FILE" >&2; exit 2; }
[ -n "$STATE" ] || { echo "EVAL_DAILY_STATE is required in $ENV_FILE" >&2; exit 2; }
[ -f "$REPO/scripts/ops/eval-daily.mjs" ] || {
  echo "$REPO does not contain scripts/ops/eval-daily.mjs" >&2
  exit 2
}
[ -f "$REPO/scripts/owned-process.mjs" ] || {
  echo "$REPO does not contain scripts/owned-process.mjs" >&2
  exit 2
}
command -v node >/dev/null 2>&1 || { echo "node not found on PATH after sourcing $ENV_FILE" >&2; exit 2; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm not found on PATH after sourcing $ENV_FILE" >&2; exit 2; }

mkdir -p "$STATE"

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

LABEL="${EVAL_DAILY_LAUNCHD_LABEL:-com.xiechimon.cairn-eval-daily}"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/$LABEL.plist"
mkdir -p "$PLIST_DIR"

escaped_env="$(xml_escape "$ENV_FILE")"
escaped_log="$(xml_escape "$STATE/eval-daily.log")"
escaped_label="$(xml_escape "$LABEL")"
escaped_path="$(xml_escape "${PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}")"

cat >"$PLIST" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$escaped_label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>set -a; . "\$1"; set +a; exec node "\$EVAL_DAILY_REPO/scripts/owned-process.mjs" --name eval-daily --max-runtime-sec 8100 -- node "\$EVAL_DAILY_REPO/scripts/ops/eval-daily.mjs"</string>
    <string>cairn-eval-daily</string>
    <string>$escaped_env</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>$HOUR</integer>
    <key>Minute</key>
    <integer>$MINUTE</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$escaped_log</string>
  <key>StandardErrorPath</key>
  <string>$escaped_log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$escaped_path</string>
  </dict>
</dict>
</plist>
EOF2

chmod 600 "$PLIST"
echo "wrote $PLIST"
if [ "$NO_LOAD" = 0 ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "loaded gui/$(id -u)/$LABEL"
fi
