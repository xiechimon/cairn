#!/bin/bash
set -euo pipefail
NODE="$HOME/.local/share/fnm/node-versions/v24.14.0/installation/bin/node"; [ -x "$NODE" ] || NODE=$(command -v node)
{ read -r BOT_NAME; read -r BOT_EMAIL; read -r OWNER_COAUTHOR; } < <("$NODE" ~/.cairn/tools/app-token/bot-identity.mjs)
[ -n "${BOT_EMAIL:-}" ] || { echo "sign-commits: could not read the bot identity" >&2; exit 1; }
export GIT_AUTHOR_NAME="$BOT_NAME" GIT_AUTHOR_EMAIL="$BOT_EMAIL"
export GIT_COMMITTER_NAME="$BOT_NAME" GIT_COMMITTER_EMAIL="$BOT_EMAIL"
export CAIRN_COAUTHOR="${CAIRN_COAUTHOR-$OWNER_COAUTHOR}"
base=$(git merge-base origin/main HEAD)
exec git rebase -q --force-rebase --exec 'git commit -q --allow-empty --amend --no-edit --reset-author ${CAIRN_COAUTHOR:+--trailer "$CAIRN_COAUTHOR"}' "$base"
