#!/bin/bash
# usage: merge-pr.sh <pr> [--auto]
# Bot-opened PRs (one signed commit: author Cairnwright, Co-authored-by kept) merge by rebase so the commit keeps its author.
# Human-opened PRs keep GitHub's default squash: author is the PR opener, commit co-authors are kept. Never override author or body.
set -uo pipefail
pr=$1; mode=${2:-}
R=xiechimon/cairn
for issue in $(gh pr view "$pr" -R "$R" --json body,headRefName --jq '"\(.headRefName)\n\(.body)"' | grep -oiE '^lane/[0-9]+|(closes|fixes|resolves) #[0-9]+' | grep -oE '[0-9]+' | sort -u); do
  open=$(node ~/.cairn/tools/merge-order/deps-open.mjs "$issue") || { echo "PR #$pr: issue #$issue still depends on open $open; merge those first" >&2; exit 1; }
done
head=$(gh pr view "$pr" -R "$R" --json headRefOid --jq .headRefOid)
node ~/.cairn/tools/review-gate/review-gate.mjs --check "$pr" >/dev/null 2>&1; prot=$?
case "$(gh pr view "$pr" -R "$R" --json headRefName --jq .headRefName)" in lane/*) prot=0;; esac
if [ $prot != 3 ]; then
  gh pr view "$pr" -R "$R" --json comments --jq '.comments[].body' | grep -A1 "review-gate:$head" | grep -q 'gate: PASS' \
    || { echo "PR #$pr is a lane PR or touches protected paths (or the check failed) and has no review-gate PASS for $head" >&2; exit 1; }
fi
opener=$(gh pr view "$pr" -R "$R" --json author --jq .author.login)
if [ "$opener" = "app/cairnwright" ]; then
  commits=$(gh pr view "$pr" -R "$R" --json commits --jq '.commits|length')
  [ "$commits" = 1 ] || { echo "PR #$pr has $commits commits; squash the lane with ~/lanes/sign-commits.sh first" >&2; exit 1; }
  author=$(gh pr view "$pr" -R "$R" --json commits --jq '.commits[0].authors[0].email')
  [ "$author" = "348051526+cairnwright@users.noreply.github.com" ] || { echo "PR #$pr commit author is $author, not Cairnwright; re-sign with ~/lanes/sign-commits.sh" >&2; exit 1; }
  run=(~/.cairn/tools/app-token/as-bot.sh gh pr merge "$pr" -R "$R" --rebase --match-head-commit "$head")
else
  run=(gh pr merge "$pr" -R "$R" --squash)
fi
if [ "$mode" = --auto ]; then
  out=$("${run[@]}" --auto 2>&1) && exit 0
  grep -qE 'unstable status|clean status' <<<"$out" || { echo "$out" >&2; exit 1; }
fi
"${run[@]}"
