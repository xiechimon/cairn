#!/bin/bash
set -uo pipefail
pr=$1; mode=${2:-}
R=${REVIEW_GATE_REPO:-xiechimon/cairn}
deps=${REVIEW_GATE_DEPS:-$HOME/.cairn/tools/merge-order/deps-open.mjs}
gate=${REVIEW_GATE_SCRIPT:-$HOME/.cairn/tools/review-gate/review-gate.mjs}
bot=${REVIEW_GATE_BOT:-$HOME/.cairn/tools/app-token/as-bot.sh}
for issue in $(gh pr view "$pr" -R "$R" --json body,headRefName --jq '"\(.headRefName)\n\(.body)"' | grep -oiE '^lane/[0-9]+|(closes|fixes|resolves) #[0-9]+' | grep -oE '[0-9]+' | sort -u); do
  open=$(node "$deps" "$issue") || { echo "PR #$pr: issue #$issue still depends on open $open; merge those first" >&2; exit 1; }
done
node "$gate" --check "$pr" >/dev/null 2>&1; prot=$?
case "$(gh pr view "$pr" -R "$R" --json headRefName --jq .headRefName)" in lane/*) prot=0;; esac
if [ $prot != 3 ]; then
  head=$(gh pr view "$pr" -R "$R" --json headRefOid --jq .headRefOid)
  gh pr view "$pr" -R "$R" --json comments --jq '.comments[].body' | grep -A1 "review-gate:$head" | grep -q 'gate: PASS' \
    || { echo "PR #$pr is a lane PR or touches protected paths (or the check failed) and has no review-gate PASS for $head" >&2; exit 1; }
fi
opener=$(gh pr view "$pr" -R "$R" --json author --jq .author.login)
if [ "$opener" = "app/cairnwright" ]; then
  commits=$(gh pr view "$pr" -R "$R" --json commits --jq '.commits|length')
  [ "$commits" = 1 ] || { echo "PR #$pr has $commits commits; squash the lane with ~/lanes/sign-commits.sh first" >&2; exit 1; }
  author=$(gh pr view "$pr" -R "$R" --json commits --jq '.commits[0].authors[0].email')
  [ "$author" = "348051526+cairnwright@users.noreply.github.com" ] || { echo "PR #$pr commit author is $author, not Cairnwright; re-sign with ~/lanes/sign-commits.sh" >&2; exit 1; }
  run=("$bot" gh pr merge "$pr" -R "$R" --rebase)
else
  run=(gh pr merge "$pr" -R "$R" --squash)
fi
if [ "$mode" = --auto ]; then
  out=$("${run[@]}" --auto 2>&1) && exit 0
  grep -qE 'unstable status|clean status' <<<"$out" || { echo "$out" >&2; exit 1; }
fi
"${run[@]}"
