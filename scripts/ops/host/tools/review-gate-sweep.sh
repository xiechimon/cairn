#!/bin/bash
# Re-dispatch the review-gate workflow for PRs whose review-gate check is still unresolved
# 15+ minutes after their head commit. Replaces the unreliable GitHub schedule trigger.
set -u
repo=xiechimon/cairn
now=$(date +%s)
gh pr list --repo "$repo" --state open --json number,isDraft,headRefName,headRefOid --jq '.[] | select(.isDraft|not) | select(.headRefName|startswith("mergify/")|not) | "\(.number) \(.headRefOid)"' |
while read -r n sha; do
  state=$(gh api "repos/$repo/commits/$sha/check-runs?check_name=review-gate" --jq '[.check_runs[]|.status+":"+(.conclusion//"")][0] // "none"')
  [ "$state" = completed:success ] && continue
  committed=$(gh api "repos/$repo/commits/$sha" --jq '.commit.committer.date')
  age=$(( now - $(date -d "$committed" +%s) ))
  [ "$age" -lt 900 ] && continue
  echo "$(date -u +%FT%TZ) PR #$n ${sha:0:9} review-gate=$state age=${age}s -> dispatch"
  gh workflow run review-gate.yml --repo "$repo" -f pr="$n" >/dev/null
done
