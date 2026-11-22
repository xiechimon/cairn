#!/bin/bash
set -euo pipefail
display=${1:-:1}
for _ in $(seq 100); do
  DISPLAY=$display xdotool getdisplaygeometry >/dev/null 2>&1 && exit 0
  sleep 0.1
done
exit 1
