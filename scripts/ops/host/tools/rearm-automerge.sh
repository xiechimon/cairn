#!/bin/bash
gh pr list -R xiechimon/cairn --state open --limit 100 --json number,author,autoMergeRequest --jq '.[]|select(.autoMergeRequest!=null)|select(.autoMergeRequest.mergeMethod!="SQUASH" or .autoMergeRequest.authorEmail!=null or .autoMergeRequest.commitBody!=null)|.number' | while read -r pr; do
  ~/.cairn/tools/app-token/as-bot.sh gh pr merge "$pr" -R xiechimon/cairn --disable-auto >/dev/null 2>&1 || gh pr merge "$pr" -R xiechimon/cairn --disable-auto >/dev/null 2>&1
  ~/.cairn/tools/merge-pr.sh "$pr" --auto >/dev/null 2>&1 && echo "$(date -u +%H:%M) re-armed #$pr" || echo "$(date -u +%H:%M) re-arm failed #$pr"
done
