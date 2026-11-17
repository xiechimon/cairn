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
if [[ $session != *-stealth ]]; then
  export AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
  export AGENT_BROWSER_PROFILE=$HOME/.cairn/browser-profile
  export AGENT_BROWSER_ARGS=--no-sandbox,--start-maximized,--ozone-platform=x11,--password-store=basic,--no-first-run,--no-default-browser-check,--hide-crash-restore-bubble,--restore-last-session
  exec /opt/agent-browser/agent-browser "$@"
fi
env_file=/run/cairn/cloak.env
[[ -r $env_file ]] || { echo 'No CloakBrowser license; set team secret CLOAKBROWSER_LICENSE_KEY' >&2; exit 1; }
. "$env_file"
key=
IFS= read -r key < /run/cairn/cloak.key || [[ -n $key ]] || { echo 'No CloakBrowser license; set team secret CLOAKBROWSER_LICENSE_KEY' >&2; exit 1; }
export AGENT_BROWSER_EXECUTABLE_PATH=$CAIRN_CLOAK_EXECUTABLE
export AGENT_BROWSER_PROFILE=$HOME/.cairn/cloak-profile
export AGENT_BROWSER_ARGS=${CAIRN_CLOAK_ARGS// /,}
unset CAIRN_CLOAK_EXECUTABLE CAIRN_CLOAK_ARGS
CLOAKBROWSER_LICENSE_KEY=$key exec /opt/agent-browser/agent-browser "$@"
