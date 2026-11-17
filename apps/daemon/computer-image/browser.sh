#!/bin/bash
set -euo pipefail
state=/run/cairn
profile=$HOME/.cairn/cloak-profile
env_file=$state/cloak.env
key_file=$state/cloak.key
owner_pid=$state/owner.pid
export DISPLAY=:1

read_key() {
  key=
  IFS= read -r key < "$key_file" || [[ -n $key ]]
  [[ -n $key ]]
}

owner_alive() {
  local pid
  [[ -r $owner_pid ]] || return 1
  pid=$(< "$owner_pid")
  [[ $pid =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null
}

lock_released() {
  local lock=$profile/SingletonLock owner pid
  for _ in $(seq 100); do
    [[ -L $lock ]] || return 0
    owner=$(readlink "$lock")
    pid=${owner##*-}
    [[ $pid =~ ^[0-9]+$ ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  return 1
}

launch_owner() {
  local url=$1 pid
  read_key || { echo 'No CloakBrowser license; set team secret CLOAKBROWSER_LICENSE_KEY' >&2; exit 2; }
  . "$env_file"
  read -r -a args <<< "$CAIRN_CLOAK_ARGS"
  CLOAKBROWSER_LICENSE_KEY=$key setsid "$CAIRN_CLOAK_EXECUTABLE" "${args[@]}" "--user-data-dir=$profile" ${url:+"$url"} >/dev/null 2>&1 < /dev/null &
  pid=$!
  printf '%s\n' "$pid" > "$owner_pid"
  for _ in $(seq 100); do
    kill -0 "$pid" 2>/dev/null || { echo 'The owner browser could not be started' >&2; exit 1; }
    xdotool search --onlyvisible --pid "$pid" >/dev/null 2>&1 && exit 0
    sleep 0.1
  done
  echo 'The owner browser could not be started' >&2
  exit 1
}

case ${1:-} in
  key)
    umask 077
    cat > "$key_file.tmp"
    mv -f "$key_file.tmp" "$key_file"
    chmod 400 "$key_file"
    ;;
  prepare)
    read_key || { echo 'The CloakBrowser license is not set in this computer' >&2; exit 2; }
    mkdir -p "$profile"
    CLOAKBROWSER_LICENSE_KEY=$key exec node /opt/cloak/cloak.mjs "$profile" "$env_file" "${2:-}" "${3:-}"
    ;;
  owner)
    session=${2:?session}
    owner_alive && exit 0
    [[ -r $env_file ]] || exit 0
    agent-browser --json session list 2>/dev/null | grep -qF "\"$session\"" || exit 0
    current=$(agent-browser --session "$session" get url 2>/dev/null | tail -n 1 || true)
    url=
    [[ $current =~ ^https?:// ]] && url=$current
    agent-browser --session "$session" close >/dev/null 2>&1 || { echo 'The agent browser did not close' >&2; exit 1; }
    lock_released || { echo 'The agent browser did not close' >&2; exit 1; }
    launch_owner "$url"
    ;;
  agent)
    owner_alive || exit 0
    pid=$(< "$owner_pid")
    windows=$(xdotool search --onlyvisible --pid "$pid" 2>/dev/null || true)
    [[ -n $windows ]] || { echo 'The owner browser did not close' >&2; exit 1; }
    for window in $windows; do xdotool windowquit "$window" || { echo 'The owner browser did not close' >&2; exit 1; }; done
    for _ in $(seq 100); do
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$owner_pid"
        lock_released && exit 0
        break
      fi
      sleep 0.1
    done
    echo 'The owner browser did not close' >&2
    exit 1
    ;;
  quit)
    session=${2:?session}
    "$0" agent
    agent-browser --session "$session" close >/dev/null 2>&1 || true
    agent-browser --session "${session%-stealth}" close >/dev/null 2>&1 || true
    lock_released
    ;;
  open)
    owner_alive && exit 0
    [[ -r $env_file ]] || { echo 'Open the stealth browser once from the agent first' >&2; exit 2; }
    lock_released || { echo 'The agent is using the stealth browser' >&2; exit 1; }
    launch_owner ''
    ;;
  *)
    echo 'usage: cairn-browser key|prepare|owner|agent|quit|open' >&2
    exit 64
    ;;
esac
