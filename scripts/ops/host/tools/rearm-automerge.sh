#!/bin/bash
# keep auto-merge consistent with merge-pr.sh: bot PRs use REBASE, human PRs use SQUASH, no author/body overrides
gh pr list -R xiechimon/cairn --state open --limit 100 --json number,author,autoMergeRequest --jq '.[]|select(.autoMergeRequest!=null)|select((.author.login=="app/cairnwright" and .autoMergeRequest.mergeMethod!="REBASE") or (.author.login!="app/cairnwright" and (.autoMergeRequest.authorEmail!=null or .autoMergeRequest.commitBody!=null)))|.number' | while read -r pr; do
  ~/.cairn/tools/app-token/as-bot.sh gh pr merge "$pr" -R xiechimon/cairn --disable-auto >/dev/null 2>&1 || gh pr merge "$pr" -R xiechimon/cairn --disable-auto >/dev/null 2>&1
  ~/.cairn/tools/merge-pr.sh "$pr" --auto >/dev/null 2>&1 && echo "$(date -u +%H:%M) re-armed #$pr" || echo "$(date -u +%H:%M) re-arm failed #$pr"
done
# arm bot PRs opened outside the driver (none of their own auto-merge), skipping held lanes and protected PRs left to review-gate
gh pr list -R xiechimon/cairn --state open --limit 100 --json number,author,autoMergeRequest,isDraft,headRefName --jq '.[]|select(.author.login=="app/cairnwright" and .autoMergeRequest==null and (.isDraft|not))|"\(.number) \(.headRefName)"' | while read -r pr ref; do
  [[ $ref == lane/* ]] && continue
  node ~/.cairn/tools/review-gate/review-gate.mjs --check "$pr" >/dev/null 2>&1; [ $? = 3 ] || continue
  ~/.cairn/tools/merge-pr.sh "$pr" --auto >/dev/null 2>&1 && echo "$(date -u +%H:%M) armed #$pr"
done
