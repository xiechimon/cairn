#!/bin/bash
# squash the lane into one commit authored by Cairnwright, keeping every Co-authored-by and closing line
set -euo pipefail
base=$(git merge-base origin/main HEAD)
n=$(git rev-list --count "$base"..HEAD)
[ "$n" -gt 0 ] || exit 0
if [ "$n" = 1 ] && [ "$(git log -1 --format=%ae)" = "348051526+cairnwright@users.noreply.github.com" ] && git log -1 --format=%B | grep -q '^Co-authored-by: xiechimon'; then exit 0; fi
subject=$(git log --reverse --format=%s "$base"..HEAD | head -1)
bodies=$(git log --reverse --format=%b "$base"..HEAD | { grep -v '^Co-authored-by:' || true; } | { grep -v '^[Cc]loses #' || true; } | sed '/^$/N;/^\n$/D')
others=$(git log --reverse --format=%s "$base"..HEAD | tail -n +2 | sed 's/^/- /')
closes=$(git log --format=%B "$base"..HEAD | { grep -iE '^closes #[0-9]+' || true; } | sort -u)
coauth=$( { git log --format=%B "$base"..HEAD | grep '^Co-authored-by:' || true; git log --format='%an <%ae>' "$base"..HEAD | { grep -v 'cairnwright' || true; } | sed 's/^/Co-authored-by: /'; echo "Co-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>"; } | grep -v 'cairnwright\|Cairnwright' | awk -F'<' '!seen[tolower($1)]++')
msg=$(printf '%s\n\n%s\n%s\n\n%s\n\n%s\n' "$subject" "$bodies" "$others" "$closes" "$coauth" | sed '/^$/N;/^\n$/D')
git reset -q --soft "$base"
~/.cairn/tools/app-token/as-bot.sh git commit -q --no-verify --allow-empty -m "$msg"
