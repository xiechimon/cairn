#!/bin/bash
# Main requires branches to be up to date, so armed PRs merge one at a time on top of the latest main.
# Each round: oldest-armed PRs that are BEHIND get rebased onto main (at most 2 in flight), so CI runs on the combined result.
set -uo pipefail
R=xiechimon/cairn
gh pr list -R $R --state open --limit 100 --json number,author,autoMergeRequest,mergeStateStatus \
  --jq '[.[]|select(.autoMergeRequest!=null)]|sort_by(.autoMergeRequest.enabledAt)|.[]|"\(.number) \(.author.login) \(.mergeStateStatus)"' > /tmp/merge-queue.txt || exit 0
updating=0
while read -r n who state; do
  [ $updating -ge 3 ] && break
  case "$state" in
    BEHIND)
      if [ "$who" = app/cairnwright ]; then ~/.cairn/tools/app-token/as-bot.sh gh pr update-branch "$n" -R $R --rebase >/dev/null 2>&1
      else gh pr update-branch "$n" -R $R >/dev/null 2>&1; fi && echo "$(date -u +%H:%M) queue: rebased #$n onto main"
      updating=$((updating+1));;
    BLOCKED|UNSTABLE|HAS_HOOKS|UNKNOWN) updating=$((updating+1));;
  esac
done < /tmp/merge-queue.txt
exit 0
