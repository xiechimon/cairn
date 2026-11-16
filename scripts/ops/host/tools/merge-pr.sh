#!/bin/bash
# usage: merge-pr.sh <pr> [--auto]
set -uo pipefail
pr=$1; mode=${2:-}
R=xiechimon/cairn
for issue in $(gh pr view "$pr" -R "$R" --json body,headRefName --jq '"\(.headRefName)\n\(.body)"' | grep -oiE '^lane/[0-9]+|(closes|fixes|resolves) #[0-9]+' | grep -oE '[0-9]+' | sort -u); do
  open=$(node ~/.cairn/tools/merge-order/deps-open.mjs "$issue") || { echo "PR #$pr: issue #$issue still depends on open $open; merge those first" >&2; exit 1; }
done
head=$(gh pr view "$pr" -R "$R" --json headRefOid --jq .headRefOid)
run=(gh pr merge "$pr" -R "$R" --squash --match-head-commit "$head")
if [ "$mode" = --auto ]; then
  out=$("${run[@]}" --auto 2>&1) && exit 0
  grep -qE 'unstable status|clean status' <<<"$out" || { echo "$out" >&2; exit 1; }
fi
"${run[@]}"
