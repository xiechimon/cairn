#!/bin/bash
# The same failing test on 2+ lane PRs is a main problem: open one fix ticket for codex and pause pushes from every other lane until it closes.
set -uo pipefail
R=xiechimon/cairn ST=~/.local/state/governor/sentinel P=~/.local/state/overnight/push-paused; mkdir -p $ST
log(){ echo "$(date -u +%H:%M) sentinel: $*"; }
if [ -e $P ]; then
  fx=$(cat $P); [ "$(gh issue view $fx -R $R --json state --jq .state 2>/dev/null)" = CLOSED ] && { rm -f $P; log "#$fx closed; lane pushes resume"; }
  exit 0
fi
gh pr list -R $R --state open --limit 100 --json number,headRefName,headRefOid --jq '.[]|select(.headRefName|startswith("lane/"))|"\(.number) \(.headRefOid)"' 2>/dev/null |
while read -r pr sha; do
  f=$ST/$pr-${sha:0:12}; [ -e $f ] && { cat $f; continue; }
  : > $f
  for job in $(gh pr view $pr -R $R --json statusCheckRollup --jq '.statusCheckRollup[]|select(.conclusion=="FAILURE")|.detailsUrl' 2>/dev/null | grep -o 'job/[0-9]*' | cut -d/ -f2); do
    gh run view --job $job -R $R --log-failed 2>/dev/null | cut -f3- | LC_ALL=C sed -E 's/\x1b\[[0-9;]*m//g; s/^[0-9T:.-]+Z //' |
      grep -oE '[A-Za-z0-9_./-]+\.(test|spec)\.[jt]sx?(:[0-9:]+)? +(›|>) +[^›>]+' | sed -E 's/:[0-9]+:[0-9]+ / /; s/ +$//; s/ \([0-9]+ ?m?s\)$//' | sort -u | sed "s/^/$pr\t/" >> $f
  done
  cat $f
done > $ST/current
hit=$(cut -f2 $ST/current | sort | uniq -c | awk '$1>=2' | sort -rn | head -1 | sed -E 's/^ *[0-9]+ //')
[ -n "$hit" ] || exit 0
key=$(echo "$hit" | md5sum | cut -c1-12); [ -e $ST/opened-$key ] && exit 0
prs=$(awk -F'\t' -v t="$hit" '$2==t{printf "#%s ", $1}' $ST/current)
n=$(gh issue create -R $R -t "main health: $hit fails on several lanes" -l main-red -l batch:now -l by:codex -a xiechimon -b "$(printf 'The test `%s` fails on lane PRs %sat the same time, so the cause is most likely on main or in shared test setup, not in one branch.\n\nFix it test-first on main. Pushes from other lanes are paused until this issue closes.\n\nOpened by the lane sentinel on omarchy.' "$hit" "$prs")" | grep -o '[0-9]*$')
[ -n "$n" ] || exit 0
touch $ST/opened-$key; echo $n > $P; echo hard > ~/.local/state/overnight/tier/$n; echo $n >> ~/.local/state/overnight/mine
log "#$n opened for '$hit' ($prs); lane pushes paused"
EXTRA_NOTE="main-red fix: the same test fails on lanes $prs." AI_ROUTE_PREFER=codex LANES_MAX=99 ~/lanes/dispatch-issue.sh $n implement >/dev/null 2>&1 && log "#$n dispatched to codex"
