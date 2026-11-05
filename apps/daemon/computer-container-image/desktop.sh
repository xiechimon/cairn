#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 0 ]]; then printf 'Usage: cairn-computer-desktop\n' >&2; exit 2; fi
if [[ $(id -u) != 1000 ]]; then printf 'Computer desktop must run as uid 1000\n' >&2; exit 1; fi
readonly runtime=/run/cairn-computer
[[ -d $runtime && ! -L $runtime && $(stat -c %u "$runtime") == 1000 && $(stat -c %a "$runtime") == 700 ]] || { printf 'Computer desktop requires its private runtime directory\n' >&2; exit 1; }
umask 077
export DISPLAY=:1
exec 9>"$runtime/desktop.lock"
flock -n 9 || { printf 'Computer desktop is already running\n' >&2; exit 75; }

children=()
cleanup() {
  for child in "${children[@]}"; do kill -TERM "$child" 2>/dev/null || true; done
  for child in "${children[@]}"; do wait "$child" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 143' TERM INT

Xvfb :1 -screen 0 1280x800x24 -nolisten tcp &
children+=("$!")
for _ in {1..50}; do
  if [[ -S /tmp/.X11-unix/X1 ]]; then break; fi
  if ! kill -0 "${children[0]}" 2>/dev/null; then printf 'Computer display failed\n' >&2; exit 1; fi
  sleep 0.1
done
[[ -S /tmp/.X11-unix/X1 ]] || { printf 'Computer display timed out\n' >&2; exit 1; }
fluxbox &
children+=("$!")
x11vnc -display :1 -rfbport 0 -unixsock "$runtime/vnc.sock" -nopw -forever -shared -quiet &
children+=("$!")
x11vnc -display :1 -rfbport 0 -unixsock "$runtime/view.sock" -viewonly -nopw -forever -shared -quiet &
children+=("$!")
wait -n "${children[@]}" || true
exit 1
