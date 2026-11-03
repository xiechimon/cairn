#!/bin/bash
# keep auto-merge consistent with merge-pr.sh: bot PRs use REBASE, human PRs use SQUASH, no author/body overrides
gh pr list -R xiechimon/cairn --state open --limit 100 --json number,author,autoMergeRequest --jq '.[]|select(.autoMergeRequest!=null)|select((.author.login=="app/cairnwright" and .autoMergeRequest.mergeMethod!="REBASE") or (.author.login!="app/cairnwright" and (.autoMergeRequest.authorEmail!=null or .autoMergeRequest.commitBody!=null)))|.number' | while read -r pr; do
  ~/.cairn/tools/app-token/as-bot.sh gh pr merge "$pr" -R xiechimon/cairn --disable-auto >/dev/null 2>&1 || gh pr merge "$pr" -R xiechimon/cairn --disable-auto >/dev/null 2>&1
  ~/.cairn/tools/merge-pr.sh "$pr" --auto >/dev/null 2>&1 && echo "$(date -u +%H:%M) re-armed #$pr" || echo "$(date -u +%H:%M) re-arm failed #$pr"
done
# arm bot PRs opened outside the driver (none of their own auto-merge), skipping held lanes and owner-route PRs
gh pr list -R xiechimon/cairn --state open --limit 100 --json number,author,autoMergeRequest,isDraft,headRefName,headRefOid --jq '.[]|select(.author.login=="app/cairnwright" and .autoMergeRequest==null and (.isDraft|not))|"\(.number) \(.headRefName) \(.headRefOid)"' | while read -r pr ref head; do
  [[ $ref == lane/* ]] && continue
  route=$(gh api "repos/xiechimon/cairn/commits/$head/check-runs?check_name=merge-route&filter=latest&per_page=100" --jq '[.check_runs[] | select(.app.slug == "github-actions")] | sort_by(.id) | last | .conclusion // ""')
  [ "$route" = success ] || continue
  ~/.cairn/tools/merge-pr.sh "$pr" --auto >/dev/null 2>&1 && echo "$(date -u +%H:%M) armed #$pr"
done
