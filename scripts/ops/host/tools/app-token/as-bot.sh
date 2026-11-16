#!/bin/bash
set -euo pipefail
DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NODE="$HOME/.local/share/fnm/node-versions/v24.14.0/installation/bin/node"; [ -x "$NODE" ] || NODE=$(command -v node)
"$NODE" "$DIR/as-bot-policy.mjs" "$@" || exit 126
{ read -r OWNER_NAME; read -r OWNER_EMAIL; read -r OWNER_COAUTHOR; } < <("$NODE" "$DIR/bot-identity.mjs")
[ -n "${OWNER_EMAIL:-}" ] || { echo "as-bot: could not read the owner identity" >&2; exit 1; }
unset GH_TOKEN GITHUB_TOKEN
export GH_HOST=github.com GH_CONFIG_DIR="$HOME/.config/gh"
export GIT_AUTHOR_NAME="$OWNER_NAME" GIT_AUTHOR_EMAIL="$OWNER_EMAIL"
export GIT_COMMITTER_NAME="$OWNER_NAME" GIT_COMMITTER_EMAIL="$OWNER_EMAIL"
export GIT_CONFIG_COUNT=3 GIT_CONFIG_KEY_0='http.https://github.com/.extraheader' GIT_CONFIG_VALUE_0='' GIT_CONFIG_KEY_1='credential.helper' GIT_CONFIG_VALUE_1='' GIT_CONFIG_KEY_2='credential.helper' GIT_CONFIG_VALUE_2='!gh auth git-credential'
if [ "$1" = git ] && [ "${2:-}" = commit ] && [ -n "${CAIRN_COAUTHOR:-}" ]; then
  exec git commit --trailer "$CAIRN_COAUTHOR" "${@:3}"
fi
exec "$@"
