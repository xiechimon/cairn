#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat >&2 <<'USAGE'
usage: install-self-deploy.sh --env-file <path> (--launchd | --systemd) [--no-load]
USAGE
  exit 2
}

ENV_FILE=""
MODE=""
NO_LOAD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --launchd) MODE=launchd; shift ;;
    --systemd) MODE=systemd; shift ;;
    --no-load) NO_LOAD=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$ENV_FILE" ] && [ -n "$MODE" ] || usage
[ -f "$ENV_FILE" ] || { echo "missing env file $ENV_FILE" >&2; exit 2; }
set -a
. "$ENV_FILE"
set +a
BUILD_CHECKOUT="${CAIRN_DEPLOY_BUILD_CHECKOUT:-}"
[ -n "$BUILD_CHECKOUT" ] || { echo "CAIRN_DEPLOY_BUILD_CHECKOUT is required" >&2; exit 2; }
[ -f "$BUILD_CHECKOUT/scripts/ops/deploy-watch.sh" ] || {
  echo "$BUILD_CHECKOUT does not contain scripts/ops/deploy-watch.sh" >&2
  exit 2
}
STATE="${CAIRN_DEPLOY_STATE:-$HOME/.local/state/cairn-deploy}"
mkdir -p "$STATE"
xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

case "$MODE" in
  launchd)
    LABEL="${CAIRN_DEPLOY_SELF_LABEL:-com.cairn.self-deploy}"
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST="$PLIST_DIR/$LABEL.plist"
    mkdir -p "$PLIST_DIR"
    escaped_checkout="$(xml_escape "$BUILD_CHECKOUT")"
    escaped_env="$(xml_escape "$ENV_FILE")"
    escaped_state="$(xml_escape "$STATE")"
    cat >"$PLIST" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>set -a; . "\$1"; set +a; exec /bin/bash "\$CAIRN_DEPLOY_BUILD_CHECKOUT/scripts/ops/deploy-watch.sh"</string>
    <string>cairn-self-deploy</string>
    <string>$escaped_env</string>
  </array>
  <key>StartInterval</key>
  <integer>120</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$escaped_state/deploy-watch.log</string>
  <key>StandardErrorPath</key>
  <string>$escaped_state/deploy-watch.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF2
    chmod 600 "$PLIST"
    echo "wrote $PLIST"
    if [ "$NO_LOAD" = 0 ]; then
      launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
      launchctl bootstrap "gui/$(id -u)" "$PLIST"
      launchctl kickstart "gui/$(id -u)/$LABEL"
      echo "loaded gui/$(id -u)/$LABEL"
    fi
    ;;
  systemd)
    UNIT_DIR="$HOME/.config/systemd/user"
    mkdir -p "$UNIT_DIR"
    case "$ENV_FILE" in *[[:space:]]*) echo "systemd EnvironmentFile paths cannot contain whitespace" >&2; exit 2 ;; esac
    cat >"$UNIT_DIR/cairn-self-deploy.service" <<EOF2
[Unit]
Description=Cairn self-deployment watcher

[Service]
Type=oneshot
UMask=0077
EnvironmentFile=$ENV_FILE
ExecStart=/bin/bash \${CAIRN_DEPLOY_BUILD_CHECKOUT}/scripts/ops/deploy-watch.sh
EOF2
    cat >"$UNIT_DIR/cairn-self-deploy.timer" <<EOF2
[Unit]
Description=Check for deployable Cairn main commits

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
EOF2
    chmod 600 "$UNIT_DIR/cairn-self-deploy.service" "$UNIT_DIR/cairn-self-deploy.timer"
    echo "wrote $UNIT_DIR/cairn-self-deploy.service and cairn-self-deploy.timer"
    if [ "$NO_LOAD" = 0 ]; then
      systemctl --user daemon-reload
      systemctl --user enable --now cairn-self-deploy.timer
      echo "enabled cairn-self-deploy.timer"
    fi
    ;;
esac
