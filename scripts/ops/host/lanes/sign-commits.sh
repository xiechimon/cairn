#!/bin/bash
set -euo pipefail
base=$(git merge-base origin/main HEAD)
exec ~/.cairn/tools/app-token/as-bot.sh git sign "$base"
