#!/bin/bash
# usage: merge-pr.sh <pr> [--auto]
set -uo pipefail
pr=$1; mode=${2:-}
R=xiechimon/cairn
for issue in $(gh pr view "$pr" -R "$R" --json body,headRefName --jq '"\(.headRefName)\n\(.body)"' | grep -oiE '^lane/[0-9]+|(closes|fixes|resolves) #[0-9]+' | grep -oE '[0-9]+' | sort -u); do
  open=$(node ~/.cairn/tools/merge-order/deps-open.mjs "$issue") || { echo "PR #$pr: issue #$issue still depends on open $open; merge those first" >&2; exit 1; }
done
head=$(gh pr view "$pr" -R "$R" --json headRefOid --jq .headRefOid)
check_of() {
  gh api "repos/$R/commits/$head/check-runs?check_name=$1&filter=latest&per_page=100" \
    --jq '[.check_runs[] | select(.app.slug == "github-actions")] | sort_by(.id) | last | if . == null then "missing" elif .status != "completed" then .status else .conclusion end'
}
route=$(check_of merge-route)
case "$(gh pr view "$pr" -R "$R" --json headRefName --jq .headRefName)" in lane/*) route=direct;; esac
case "$route" in
  success|direct) ;;
  failure) echo "PR #$pr: its merge-route check for $head failed, so the router could not judge this head; fix that check, it is not a route" >&2; exit 1;;
  *) echo "PR #$pr: its merge-route check for $head is '$route'; wait for CI" >&2; exit 1;;
esac
if [ "$route" = success ]; then
  labels=$(gh pr view "$pr" -R "$R" --json labels --jq '.labels[].name') \
    || { echo "PR #$pr: could not read its labels, so a Mergify dequeue cannot be ruled out; leaving it" >&2; exit 1; }
  grep -qx dequeued <<<"$labels" && { echo "PR #$pr was dequeued by Mergify; a human decides before it is queued again" >&2; exit 1; }
  echo "PR #$pr may enter the merge queue; Mergify queues it automatically once its checks pass"; exit 0
fi
run=(gh pr merge "$pr" -R "$R" --squash --match-head-commit "$head")
if [ "$mode" = --auto ]; then
  out=$("${run[@]}" --auto 2>&1) && exit 0
  grep -qE 'unstable status|clean status' <<<"$out" || { echo "$out" >&2; exit 1; }
fi
"${run[@]}"
