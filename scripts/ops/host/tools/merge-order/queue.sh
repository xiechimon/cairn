#!/bin/bash
set -uo pipefail
R=xiechimon/cairn
gh pr list -R $R --state open --limit 100 --json number,autoMergeRequest,mergeStateStatus \
  --jq '[.[]|select(.autoMergeRequest!=null)]|sort_by(.autoMergeRequest.enabledAt)|.[]|"\(.number) \(.mergeStateStatus)"' > /tmp/merge-queue.txt || exit 0
updating=0
while read -r n state; do
  [ $updating -ge 3 ] && break
  case "$state" in
    BEHIND)
      ~/.cairn/tools/app-token/as-bot.sh gh pr update-branch "$n" -R $R >/dev/null 2>&1 && echo "$(date -u +%H:%M) queue: merged main into #$n"
      updating=$((updating+1));;
    BLOCKED|UNSTABLE|HAS_HOOKS|UNKNOWN) updating=$((updating+1));;
  esac
done < /tmp/merge-queue.txt
exit 0
