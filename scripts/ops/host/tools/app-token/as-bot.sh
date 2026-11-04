#!/bin/bash
set -euo pipefail
DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NODE="$HOME/.local/share/fnm/node-versions/v24.14.0/installation/bin/node"; [ -x "$NODE" ] || NODE=$(command -v node)
"$NODE" "$DIR/as-bot-policy.mjs" "$@" || exit 126
T=""
for d in 2 4 8 16; do T=$("$NODE" "$DIR/token.mjs" 2>/dev/null) && [ -n "$T" ] && break; sleep $d; done
[ -n "$T" ] || { echo "as-bot: could not get an installation token" >&2; exit 1; }
B64=$(printf 'x-access-token:%s' "$T" | base64 | tr -d '\n')
export GH_TOKEN="$T"
export GIT_AUTHOR_NAME='Cairnwright' GIT_AUTHOR_EMAIL='348051526+cairnwright@users.noreply.github.com'
export GIT_COMMITTER_NAME='cairnwright[bot]' GIT_COMMITTER_EMAIL='347615582+cairnwright[bot]@users.noreply.github.com'
export CAIRN_COAUTHOR='Co-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>'
export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0='http.https://github.com/.extraheader' GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $B64" GIT_CONFIG_KEY_1='credential.helper' GIT_CONFIG_VALUE_1=''
exec "$@"
