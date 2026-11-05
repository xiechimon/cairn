#!/usr/bin/env bash
set -euo pipefail

readonly COMPUTER_SOCKET=/run/cairn-computer/computer.sock
readonly DAEMON_ENTRY=/opt/cairn/daemon/cli.mjs
readonly NODE_BINARY=/usr/bin/node
readonly PROXY_PORT=7890

if [[ $(id -u) != 1000 ]]; then printf 'Computer agent must run as uid 1000\n' >&2; exit 1; fi
umask 077
export CAIRN_ORB=1

bridge_pid=
agent_pid=
stopping=false

cleanup() {
  if [[ -n $bridge_pid ]]; then kill -TERM "$bridge_pid" 2>/dev/null || true; fi
  if [[ -n $agent_pid ]]; then kill -TERM "$agent_pid" 2>/dev/null || true; fi
  for _ in {1..30}; do
    live=false
    for child in "$bridge_pid" "$agent_pid"; do
      if [[ -n $child ]] && kill -0 "$child" 2>/dev/null; then live=true; fi
    done
    if ! $live; then break; fi
    sleep 0.1
  done
  for child in "$bridge_pid" "$agent_pid"; do
    if [[ -n $child ]]; then
      kill -KILL "$child" 2>/dev/null || true
      wait "$child" 2>/dev/null || true
    fi
  done
}

on_signal() {
  stopping=true
  if [[ -n $agent_pid ]]; then kill -TERM "$agent_pid" 2>/dev/null || true; fi
}

trap cleanup EXIT
trap on_signal TERM INT

if [[ -n ${CAIRN_ORB_EGRESS_SOCKET:-} ]]; then
  socat "TCP-LISTEN:$PROXY_PORT,bind=127.0.0.1,fork,reuseaddr" "UNIX-CONNECT:$CAIRN_ORB_EGRESS_SOCKET" &
  bridge_pid=$!
  ready=false
  for _ in {1..50}; do
    if $stopping; then exit 143; fi
    if ! kill -0 "$bridge_pid" 2>/dev/null; then printf 'Computer egress bridge failed\n' >&2; exit 1; fi
    listeners=$(ss -ltnpH "sport = :$PROXY_PORT")
    if [[ $listeners == *"pid=$bridge_pid,"* ]]; then ready=true; break; fi
    sleep 0.1
  done
  $ready && kill -0 "$bridge_pid" 2>/dev/null || { printf 'Computer egress bridge timed out\n' >&2; exit 1; }
  export HTTP_PROXY=http://127.0.0.1:$PROXY_PORT HTTPS_PROXY=http://127.0.0.1:$PROXY_PORT
  export http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY
  export NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1
fi

agent_environment=(
  env -i
  "HOME=$HOME"
  USER=user LOGNAME=user
  PATH=/usr/local/bin:/usr/bin:/bin
  "LANG=${LANG:-C.UTF-8}"
  DISPLAY=:1 CAIRN_ORB=1
)
if [[ -n $bridge_pid ]]; then
  agent_environment+=(
    "HTTP_PROXY=$HTTP_PROXY" "HTTPS_PROXY=$HTTPS_PROXY"
    "http_proxy=$http_proxy" "https_proxy=$https_proxy"
    "NO_PROXY=$NO_PROXY" "no_proxy=$no_proxy"
  )
fi

while true; do
  if $stopping; then exit 143; fi
  until [[ -S $COMPUTER_SOCKET ]]; do
    if $stopping; then exit 143; fi
    sleep 0.1
  done
  if $stopping; then exit 143; fi
  "${agent_environment[@]}" "$NODE_BINARY" "$DAEMON_ENTRY" orb-computer --socket "$COMPUTER_SOCKET" &
  agent_pid=$!
  while true; do
    status=0
    wait "$agent_pid" || status=$?
    kill -0 "$agent_pid" 2>/dev/null || break
  done
  agent_pid=
  if $stopping; then exit "$status"; fi
  if ((status != 75)); then exit "$status"; fi
  sleep 1
done
