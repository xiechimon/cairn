#!/usr/bin/env bash
set -euo pipefail
[ -f /etc/cairn-runner-firewall/apply.sh ] || { echo 'Missing rule: installed firewall validator' >&2; exit 1; }
exec bash /etc/cairn-runner-firewall/apply.sh check
