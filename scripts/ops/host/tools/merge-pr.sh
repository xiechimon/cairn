#!/bin/bash
# usage: merge-pr.sh <pr> [--auto]
# Bot-opened PRs (one signed commit: author Cairnwright, or cairnwright[bot] with Cairn-Thread and Co-authored-by trailers) merge by rebase so the commit keeps its author.
set -uo pipefail
pr=$1; mode=${2:-}
R=xiechimon/cairn
ACCEPTED_BOT_AUTHORS="Cairnwright cairnwright[bot]"
signed_bot_commit() {
  case "$1" in
    348051526+cairnwright@users.noreply.github.com) return 0;;
    347615582+cairnwright\[bot\]@users.noreply.github.com)
      grep -q '^Cairn-Thread: ' <<<"$2" && grep -q '^Co-authored-by: xiechimon' <<<"$2";;
    *) return 1;;
  esac
}
for issue in $(gh pr view "$pr" -R "$R" --json body,headRefName --jq '"\(.headRefName)\n\(.body)"' | grep -oiE '^lane/[0-9]+|(closes|fixes|resolves) #[0-9]+' | grep -oE '[0-9]+' | sort -u); do
  open=$(node ~/.cairn/tools/merge-order/deps-open.mjs "$issue") || { echo "PR #$pr: issue #$issue still depends on open $open; merge those first" >&2; exit 1; }
done
head=$(gh pr view "$pr" -R "$R" --json headRefOid --jq .headRefOid)
held_labels=$(gh pr view "$pr" -R "$R" --json labels --jq '.labels[].name') \
  || { echo "PR #$pr: could not read its labels, so a coordinator-hold cannot be ruled out; not merging" >&2; exit 1; }
grep -qx coordinator-hold <<<"$held_labels" \
  && { echo "PR #$pr carries coordinator-hold: the coordinator asked for changes; it merges only after the author says ready and the label is removed" >&2; exit 1; }
check_of() {
  gh api "repos/$R/commits/$head/check-runs?check_name=$1&filter=latest&per_page=100" \
    --jq '[.check_runs[] | select(.app.slug == "github-actions")] | sort_by(.id) | last | if . == null then "missing" elif .status != "completed" then .status else .conclusion end'
}
route=$(check_of merge-route)
case "$(gh pr view "$pr" -R "$R" --json headRefName --jq .headRefName)" in lane/*) route=owner;; esac
case "$route" in success|failure|owner) ;; *) echo "PR #$pr: its merge-route check for $head is '$route'; wait for CI" >&2; exit 1;; esac
if [ "$route" = success ] && [ "$(gh pr view "$pr" -R "$R" --json author --jq .author.login)" != app/cairnwright ]; then
  grep -qx dequeued <<<"$held_labels" && { echo "PR #$pr was dequeued by Mergify; a human decides before it is queued again" >&2; exit 1; }
  echo "PR #$pr may enter the merge queue; Mergify queues it automatically once the review-gate check passes"; exit 0
fi
gate=$(check_of review-gate)
[ "$gate" = success ] \
  || { echo "PR #$pr: its review-gate check for $head is '${gate:-missing}', not success" >&2; exit 1; }
opener=$(gh pr view "$pr" -R "$R" --json author --jq .author.login)
if [ "$opener" = "app/cairnwright" ]; then
  commits=$(gh pr view "$pr" -R "$R" --json commits --jq '.commits|length')
  [ "$commits" = 1 ] || { echo "PR #$pr has $commits commits; squash the lane with ~/lanes/sign-commits.sh first" >&2; exit 1; }
  author=$(gh pr view "$pr" -R "$R" --json commits --jq '.commits[0].authors[0].email')
  message=$(gh pr view "$pr" -R "$R" --json commits --jq '.commits[0].messageBody')
  signed_bot_commit "$author" "$message" || { echo "PR #$pr commit author is $author; accepted: $ACCEPTED_BOT_AUTHORS (cairnwright[bot] also needs Cairn-Thread and Co-authored-by: xiechimon trailers); re-sign with ~/lanes/sign-commits.sh" >&2; exit 1; }
  run=(gh pr merge "$pr" -R "$R" --rebase --match-head-commit "$head")
else
  run=(gh pr merge "$pr" -R "$R" --squash)
fi
if [ "$mode" = --auto ]; then
  out=$("${run[@]}" --auto 2>&1) && exit 0
  grep -qE 'unstable status|clean status' <<<"$out" || { echo "$out" >&2; exit 1; }
fi
"${run[@]}"
