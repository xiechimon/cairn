#!/bin/sh
set -eu
script=$(dirname "$0")/canary.mjs
if [ "${1-}" = '--cleanup' ]; then
  exec node "$script" "$@"
fi
run_id=${CAIRN_CANARY_RUN_ID:-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(12).toString("hex"))')}
child=
cleanup() {
  status=$?
  trap - EXIT
  if ! node "$script" --cleanup "$run_id" >/dev/null; then
    status=1
  fi
  exit "$status"
}
interrupt() {
  if [ -n "$child" ]; then
    kill -s "$1" "$child" 2>/dev/null || :
  fi
}
trap cleanup EXIT
trap 'interrupt INT' INT
trap 'interrupt TERM' TERM
trap 'interrupt HUP' HUP
CAIRN_CANARY_RUN_ID=$run_id node "$script" "$@" &
child=$!
status=0
while :; do
  if wait "$child"; then
    break
  else
    status=$?
    if ! kill -0 "$child" 2>/dev/null; then
      break
    fi
  fi
done
exit "$status"
