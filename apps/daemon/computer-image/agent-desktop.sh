#!/bin/bash
set -euo pipefail
[[ -r /run/cairn/session.env ]] && . /run/cairn/session.env
export DISPLAY=:1
exec /opt/agent-desktop/agent-desktop "$@"
