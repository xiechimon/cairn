#!/bin/bash
set -euo pipefail
session=
previous=
for arg in "$@"; do
  [[ $previous == --session ]] && session=$arg
  previous=$arg
done
export AGENT_BROWSER_NO_VERSION_CHECK=1
export AGENT_BROWSER_SOCKET_DIR=$HOME/.agent-browser
key=
if [[ $session == p_* ]]; then
  key=${session#p_}
  key=${key%-stealth}
  [[ $key =~ ^[A-Za-z0-9_-]+$ ]] || key=
fi
adopt_legacy() {
  local target=$1 legacy=$2
  [[ -e $target || ! -e $legacy ]] && return 0
  mkdir -p "$(dirname "$target")"
  mv "$legacy" "$target"
}
if [[ $session != *-stealth ]]; then
  profile=$HOME/.cairn/browser-profile
  if [[ -n $key ]]; then
    profile=$HOME/.cairn/browser-profiles/$key/chromium
    adopt_legacy "$profile" "$HOME/.cairn/browser-profile"
  fi
  export AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
  export AGENT_BROWSER_PROFILE=$profile
  export AGENT_BROWSER_ARGS=--no-sandbox,--disable-blink-features=AutomationControlled,--start-maximized,--ozone-platform=x11,--password-store=basic,--no-first-run,--no-default-browser-check,--hide-crash-restore-bubble,--restore-last-session
  exec /opt/agent-browser/agent-browser "$@"
fi
env_file=/run/cairn/cloak.env
[[ -r $env_file ]] || { echo 'No CloakBrowser license; set team secret CLOAKBROWSER_LICENSE_KEY' >&2; exit 1; }
. "$env_file"
key_material=
IFS= read -r key_material < /run/cairn/cloak.key || [[ -n $key_material ]] || { echo 'No CloakBrowser license; set team secret CLOAKBROWSER_LICENSE_KEY' >&2; exit 1; }
profile=$HOME/.cairn/cloak-profile
if [[ -n $key ]]; then
  profile=$HOME/.cairn/browser-profiles/$key/cloak
  adopt_legacy "$profile" "$HOME/.cairn/cloak-profile"
fi
export AGENT_BROWSER_EXECUTABLE_PATH=$CAIRN_CLOAK_EXECUTABLE
export AGENT_BROWSER_PROFILE=$profile
export AGENT_BROWSER_ARGS=${CAIRN_CLOAK_ARGS// /,}
unset CAIRN_CLOAK_EXECUTABLE CAIRN_CLOAK_ARGS
CLOAKBROWSER_LICENSE_KEY=$key_material exec /opt/agent-browser/agent-browser "$@"
