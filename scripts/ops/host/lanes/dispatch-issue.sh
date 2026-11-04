#!/bin/bash
n=$1 role=$2 shift_hard=${3:-}
~/lanes/test-build-prompt.sh >/dev/null 2>&1 || { echo "#$n not dispatched: worker prompt render test fails (~/lanes/test-build-prompt.sh)"; exit 3; }
grep -qx "$n" ~/.local/state/overnight/never && { echo "#$n is on the never-dispatch list (umbrella, freeze or owner hold)"; exit 3; }
case "${EXTRA_NOTE:-}" in *"main-red"*) ;; *) st=$(gh issue view "$n" -R xiechimon/cairn --json state --jq .state 2>/dev/null); [ "$st" = OPEN ] || { echo "#$n not dispatched: issue state is ${st:-unreadable}"; exit 3; };; esac
other=$(gh pr list -R xiechimon/cairn --state open --limit 100 --json number,headRefName,title --jq ".[]|select(.headRefName != \"lane/$n\")|select(.title|test(\"\\\\($n\\\\)|#$n\\\\b\"))|.number" 2>/dev/null | head -1)
[ -n "$other" ] && { echo "#$n already has someone else's open PR #$other; not dispatching"; exit 3; }
[ -e ~/.local/state/overnight/brake ] && [ -z "${EXTRA_NOTE:-}" ] && { echo "#$n not dispatched: brake is on ($(cat ~/.local/state/overnight/brake))"; exit 3; }
tier=$(~/.cairn/tools/governor/tier.sh $n)
fixing=0; case "${EXTRA_NOTE:-}" in *"Fix round"*|*"self-check found"*|*"main-red"*) fixing=1;; esac
if [ $fixing = 0 ] && [ -z "${DISPATCH_FORCE:-}" ]; then
  [ "$tier" = none ] && { echo "#$n has no tier yet; not dispatching"; exit 3; }
  if [ "$tier" != simple ]; then
    gh issue view $n -R xiechimon/cairn --json comments --jq '.comments[].body' 2>/dev/null | grep -q '<!-- acceptance-checklist v1' || { echo "#$n ($tier) has no acceptance checklist yet; not dispatching"; exit 3; }
  fi
  dep=$(node ~/.cairn/tools/merge-order/deps-open.mjs $n 2>/dev/null) || { echo "#$n waits for open $dep"; exit 3; }
  red=$(gh api repos/xiechimon/cairn/commits/main/check-runs --jq '[.check_runs[]|select(.conclusion=="failure")]|length' 2>/dev/null)
  [ "${red:-0}" -gt 0 ] && { echo "#$n not dispatched: main is red"; exit 3; }
fi
busy=$( { for f in ~/.local/state/lane-*.lock; do fuser "$f" >/dev/null 2>&1 && basename "$f" .lock | sed 's/^lane-//'; done
          ps -eo args= | grep -oE '^python3 [^ ]*ai-route run implement .*-C [^ ]*/cairn-[^ ]+' | sed -E 's/.*cairn-//'; } | sort -u | wc -l)
[ $busy -ge ${LANES_MAX:-6} ] && { echo "#$n not dispatched: $busy/${LANES_MAX:-6} code lanes busy"; exit 3; }
[ -z "${AI_ROUTE_PREFER:-}" ] && export $(~/.cairn/tools/governor/tier.sh env $n implement)
cd ~/lanes/cairn && git fetch -q origin main
d=~/lanes/cairn-$n
[ -d $d ] || git worktree add -q -B lane/$n $d origin/main

[ -n "$(flock -n ~/.local/state/lane-$n.lock true || echo busy)" ] && { echo "lane $n already has a worker; not dispatching"; exit 3; }
(cd $d && AI_ROUTE_PREFER=$AI_ROUTE_PREFER AI_ROUTE_PREFER_MODEL=${AI_ROUTE_PREFER_MODEL:-} setsid nohup flock -n $HOME/.local/state/lane-$n.lock env EXTRA_NOTE="$EXTRA_NOTE" ~/lanes/run-worker.sh $n $role "$shift_hard" $d > ~/lanes/logs/$n.log 2>&1 < /dev/null &)
echo "dispatched #$n ($role $shift_hard)"
