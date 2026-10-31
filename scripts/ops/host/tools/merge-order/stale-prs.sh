#!/bin/bash
# A PR whose head has not changed for 24h is stuck: lanes owned here get a fix worker with the PR's blockers; anything else gets a `stale-pr` issue. Once per PR head.
set -uo pipefail
R=xiechimon/cairn ST=~/.local/state/merge-order; mkdir -p $ST
now=$(date +%s)
gh pr list -R $R --state open --limit 100 --json number,isDraft,headRefName,headRefOid,commits,title \
  --jq '.[]|select(.isDraft|not)|"\(.number) \(.headRefName) \(.headRefOid) \(.commits[-1].committedDate)"' 2>/dev/null |
while read -r pr ref sha at; do
  age=$(( now - $(date -d "$at" +%s) ))
  [ $age -lt 86400 ] && continue
  [ -e $ST/stale-$pr-${sha:0:12} ] && continue
  lane=${ref#lane/}
  if [ "$lane" != "$ref" ] && grep -qx "$lane" ~/.local/state/overnight/hold; then continue; fi
  touch $ST/stale-$pr-${sha:0:12}
  if [ "$lane" != "$ref" ] && grep -qx "$lane" ~/.local/state/overnight/mine && [ -d ~/lanes/cairn-$lane ]; then
    note="This lane already has PR #$pr with no new commit for over 24 hours. Before anything else run \`gh pr view $pr -R $R --comments\` and \`gh pr checks $pr -R $R\`: fix every blocking finding in the latest review-gate comment, every failing required check, and rebase onto origin/main if it conflicts. Commit the fixes on lane/$lane."
    EXTRA_NOTE="$note" ~/lanes/dispatch-issue.sh "$lane" implement >/dev/null 2>&1 && echo "$(date -u +%H:%M) stale: re-dispatched lane $lane for PR #$pr"
  else
    gh issue create -R $R -t "stale PR #$pr: no new commit for 24h" -l stale-pr -l batch:now -l by:cairn \
      -b "PR #$pr ($ref) has had no new commit since $at. Its owner (thread or agent) should fix the blockers (review-gate findings, failing checks, conflicts) or close it. Opened by stale-prs on omarchy." >/dev/null 2>&1 && echo "$(date -u +%H:%M) stale: opened issue for PR #$pr"
  fi
done
exit 0
