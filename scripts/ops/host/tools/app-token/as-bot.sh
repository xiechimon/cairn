#!/bin/bash
set -euo pipefail
DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NODE="$HOME/.local/share/fnm/node-versions/v24.14.0/installation/bin/node"; [ -x "$NODE" ] || NODE=$(command -v node)
"$NODE" "$DIR/as-bot-policy.mjs" "$@" || exit 126
{ read -r BOT_NAME; read -r BOT_EMAIL; read -r OWNER_COAUTHOR; } < <("$NODE" "$DIR/bot-git.mjs" identity)
[ -n "${BOT_EMAIL:-}" ] || { echo "as-bot: could not read the bot identity" >&2; exit 1; }
T=""
for d in 2 4 8 16; do T=$("$NODE" "$DIR/token.mjs" 2>/dev/null) && [ -n "$T" ] && break; sleep $d; done
[ -n "$T" ] || { echo "as-bot: could not get an installation token" >&2; exit 1; }
B64=$(printf 'x-access-token:%s' "$T" | base64 | tr -d '\n')
export GH_TOKEN="$T"
export GIT_AUTHOR_NAME="$BOT_NAME" GIT_AUTHOR_EMAIL="$BOT_EMAIL"
export GIT_COMMITTER_NAME="$BOT_NAME" GIT_COMMITTER_EMAIL="$BOT_EMAIL"
export CAIRN_COAUTHOR="${CAIRN_COAUTHOR-$OWNER_COAUTHOR}"
export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0='http.https://github.com/.extraheader' GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $B64" GIT_CONFIG_KEY_1='credential.helper' GIT_CONFIG_VALUE_1=''
if [ "$1" = git ]; then
  shift
  exec "$NODE" "$DIR/bot-git.mjs" "$@"
fi
exec "$@"
