#!/usr/bin/env bash
set -euo pipefail
umask 077
exec python3 "$(cd "$(dirname "$0")" && pwd)/restore-drill.py" "$@"
