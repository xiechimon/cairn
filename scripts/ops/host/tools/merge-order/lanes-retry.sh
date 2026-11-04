#!/bin/bash
# Pending tickets are dispatched in order while code lanes are free (dispatch-issue enforces tier, checklist, lane cap and green main).
# Lanes whose worker ended without producing a commit (no model, quota, crash) and have no PR get dispatched again; at most 4 per run, 3 tries per lane.
set -uo pipefail
R=xiechimon/cairn ST=~/.local/state/merge-order; mkdir -p $ST
prs=$(gh pr list -R $R --state all --limit 300 --json headRefName --jq '.[].headRefName' 2>/dev/null) || exit 0
sent=0
for n in $(cat ~/.local/state/overnight/mine); do
  [ $sent -ge 4 ] && break
  grep -qx "$n" ~/.local/state/overnight/hold && continue
  grep -qx "lane/$n" <<<"$prs" && continue
  d=~/lanes/cairn-$n; [ -d $d ] || continue
  flock -n ~/.local/state/lane-$n.lock true || continue
  [ -n "$(git -C $d log origin/main..HEAD --oneline 2>/dev/null)" ] && continue
  log=~/lanes/logs/$n.log; [ -f $log ] || continue
  [ $(( $(date +%s) - $(stat -c %Y $log) )) -lt 1800 ] && continue
  ok=$(gh issue view $n -R $R --json state,labels --jq 'select(.state=="OPEN")|[.labels[].name]|select((index("batch:now") or index("batch:next")) and (index("waits-ian")|not) and (index("batch:later")|not))|length' 2>/dev/null)
  [ -n "$ok" ] || continue
  tries=$(cat $ST/retry-$n 2>/dev/null || echo 0); [ $tries -ge 3 ] && continue
  echo $((tries+1)) > $ST/retry-$n
  out=$(~/lanes/dispatch-issue.sh $n implement 2>&1)
  case "$out" in dispatched*) echo "$(date -u +%H:%M) lanes-retry: re-dispatched #$n (try $((tries+1)))"; sent=$((sent+1)) ;; *) echo $tries > $ST/retry-$n ;; esac
done
[ -e ~/.local/state/overnight/brake ] && exit 0
[ -e ~/.local/state/overnight/pending.paused ] && exit 0
sentp=0
for n in $(cat ~/.local/state/overnight/pending 2>/dev/null); do
  [ $sentp -ge 6 ] && break
  node ~/.cairn/tools/merge-order/deps-open.mjs "$n" >/dev/null 2>&1 || continue
  parent=$(gh issue view "$n" -R $R --json body --jq .body 2>/dev/null | grep -oE '^Part of #[0-9]+' | grep -oE '[0-9]+' | head -1)
  note=""; [ -f ~/.local/state/overnight/notes/$n.txt ] && note="$(cat ~/.local/state/overnight/notes/$n.txt)"
  [ -n "$parent" ] && note="$note Split from #$parent after its PR failed review twice. Read \`gh issue view $parent -R $R --comments\` for every earlier blocking finding and do not repeat them. If this worktree already has partial work for this ticket, continue from it."
  out=$(EXTRA_NOTE="$note" ~/lanes/dispatch-issue.sh "$n" implement 2>&1)
  case "$out" in
    dispatched*) sed -i "/^$n$/d" ~/.local/state/overnight/pending; grep -qx "$n" ~/.local/state/overnight/mine || echo "$n" >> ~/.local/state/overnight/mine
                 echo "$(date -u +%H:%M) pending: dispatched #$n ($(~/.cairn/tools/governor/tier.sh $n))"; sentp=$((sentp+1)) ;;
    *"code lanes busy"*|*"main is red"*) break ;;
  esac
done
exit 0
