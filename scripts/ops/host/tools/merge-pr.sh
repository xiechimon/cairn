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
node ~/.cairn/tools/review-gate/review-gate.mjs --check "$pr" >/dev/null 2>&1; prot=$?
case "$(gh pr view "$pr" -R "$R" --json headRefName --jq .headRefName)" in lane/*) prot=0;; esac
if [ $prot = 3 ] && [ "$(gh pr view "$pr" -R "$R" --json author --jq .author.login)" != app/cairnwright ]; then
  labels=$(gh pr view "$pr" -R "$R" --json labels --jq '.labels[].name')
  grep -qx dequeued <<<"$labels" && { echo "PR #$pr was dequeued by Mergify; a human decides before it is queued again" >&2; exit 1; }
  grep -qx review-gate <<<"$labels" || gh pr edit "$pr" -R "$R" --add-label review-gate \
    || { echo "PR #$pr: could not add the review-gate label, so the gate would never post the status Mergify needs" >&2; exit 1; }
  echo "PR #$pr is labelled review-gate; Mergify queues it automatically once the review-gate status and merge-route pass"; exit 0
fi
if [ $prot != 3 ]; then
  gate=$(gh api "repos/$R/commits/$head/statuses?per_page=100" --jq '[.[] | select(.context == "review-gate" and .creator.login == "xiechimon")][0].state // ""')
  [ "$gate" = success ] \
    || { echo "PR #$pr is a lane PR or touches protected paths (or the check failed) and its review-gate status for $head is '${gate:-missing}', not success" >&2; exit 1; }
fi
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
