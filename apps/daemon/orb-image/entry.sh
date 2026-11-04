#!/usr/bin/env bash
set -eu

readonly RELAY_SOCKET=/run/cairn/relay.sock
readonly DAEMON_ENTRY=/opt/cairn/daemon/cli.mjs
readonly PROXY_PORT=7890
readonly STALE_RELEASE_EXIT=75

if [[ $(id -u) == 0 ]]; then
  printf 'cairn-orb-entry must not run as root\n' >&2
  exit 1
fi

umask 077
export CAIRN_ORB=1

bridge_pid=
worker_pid=
stopping=false

start_bridge() {
  socat "TCP-LISTEN:$PROXY_PORT,bind=127.0.0.1,fork,reuseaddr" "UNIX-CONNECT:$CAIRN_ORB_EGRESS_SOCKET" &
  bridge_pid=$!
  local waited=0
  until ss -ltnH "sport = :$PROXY_PORT" | grep -q .; do
    if ! kill -0 "$bridge_pid" 2> /dev/null || ((waited >= 50)); then
      printf 'egress bridge did not start listening on 127.0.0.1:%s\n' "$PROXY_PORT" >&2
      exit 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
}

stop_children() {
  if [[ -n $bridge_pid ]]; then kill "$bridge_pid" 2> /dev/null || true; fi
  if [[ -n $worker_pid ]]; then kill "$worker_pid" 2> /dev/null || true; fi
}

on_signal() {
  stopping=true
  if [[ -n $worker_pid ]]; then kill -TERM "$worker_pid" 2> /dev/null || true; fi
}

trap stop_children EXIT
trap on_signal TERM INT

if [[ -n ${CAIRN_ORB_EGRESS_SOCKET:-} ]]; then
  proxy_url=http://127.0.0.1:$PROXY_PORT
  export HTTP_PROXY=$proxy_url HTTPS_PROXY=$proxy_url http_proxy=$proxy_url https_proxy=$proxy_url
  export NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1
  start_bridge
fi

while true; do
  until [[ -S $RELAY_SOCKET ]]; do
    if $stopping; then exit 143; fi
    sleep 0.2
  done
  if [[ -n $bridge_pid ]] && ! kill -0 "$bridge_pid" 2> /dev/null; then start_bridge; fi
  node "$DAEMON_ENTRY" orb-step --socket "$RELAY_SOCKET" &
  worker_pid=$!
  while true; do
    status=0
    wait "$worker_pid" || status=$?
    kill -0 "$worker_pid" 2> /dev/null || break
  done
  worker_pid=
  if $stopping; then exit "$status"; fi
  if ((status != STALE_RELEASE_EXIT)); then exit "$status"; fi
  sleep 1
done
