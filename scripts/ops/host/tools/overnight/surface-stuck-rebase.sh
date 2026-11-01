#!/bin/bash
# usage: surface-stuck-rebase.sh <issue> <stamp-file> [pr]
set -uo pipefail
n=$1; f=$2; pr=${3:-}
R=xiechimon/cairn
BOT=~/.cairn/tools/app-token/as-bot.sh
[ -e "$f.surfaced" ] && exit 0
[ "$(wc -l < "$f.fail" 2>/dev/null || echo 0)" -ge 3 ] || exit 0
files=$(git merge-tree --write-tree --name-only --no-messages origin/main HEAD 2>/dev/null | tail -n +2 | grep -v '^$' | sort -u | sed 's/^/- `/; s/$/`/')
[ -n "$files" ] || files='- (git merge-tree reported no conflicting file; the worker failed for another reason, see ~/lanes/logs/rr-'"$n"'.log)'
body=$(printf 'The lane rebase worker failed 3 times on `%s`, so the overnight driver stops retrying #%s. Files that conflict with main:\n\n%s\n\nA person or the coordinator needs to rebase this lane.' "$(git rev-parse --short HEAD)" "$n" "$files")
if [ -n "$pr" ]; then
  $BOT gh pr edit "$pr" -R $R --add-label stale-pr >/dev/null && $BOT gh pr comment "$pr" -R $R --body "$body" >/dev/null || exit 1
else
  $BOT gh issue comment "$n" -R $R --body "$body" >/dev/null || exit 1
fi
touch "$f.surfaced"
echo "$(date -u +%H:%M) #$n rebase worker exhausted -> surfaced on ${pr:+PR #$pr}${pr:-issue #$n}"
