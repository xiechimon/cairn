#!/bin/bash
# Workers that exit within 60s, or the same exit error on 2+ lanes in the last 2h, open (or comment on) one `infra-lanes` issue.
set -uo pipefail
R=xiechimon/cairn L=~/.local/state/overnight/worker-exits.log ST=~/.local/state/governor/lane-health; mkdir -p $ST
[ -s $L ] || exit 0
since=$(date -u -d '-2 hours' +%FT%TZ); seen=$ST/seen; touch $seen
recent=$(awk -F'\t' -v s="$since" '$1>=s' $L)
fast=$(awk -F'\t' '$4<60' <<<"$recent")
sig(){ sed -E 's/#?[0-9]{3,}/N/g; s/[0-9a-f]{8,}/H/g' <<<"$1"; }
shared=$(awk -F'\t' '$3!=0{print}' <<<"$recent" | while IFS=$'\t' read -r ts n rc secs last; do printf '%s\t%s\n' "$(sig "$last")" "$n"; done | sort -u | awk -F'\t' '{c[$1]++; l[$1]=l[$1]" #"$2} END{for(k in c) if(c[k]>=2) print k"\t"l[k]}')
msg=""
while IFS=$'\t' read -r ts n rc secs last; do
  [ -n "$ts" ] || continue; k="fast $ts $n"; grep -qxF "$k" $seen && continue; echo "$k" >> $seen
  msg+="- worker for #$n exited after ${secs}s (rc $rc): \`$last\`"$'\n'
done <<<"$fast"
while IFS=$'\t' read -r s lanes; do
  [ -n "$s" ] || continue; k="shared $(date -u +%F) $s"; grep -qxF "$k" $seen && continue; echo "$k" >> $seen
  msg+="- the same exit error on lanes$lanes: \`$s\`"$'\n'
done <<<"$shared"
[ -n "$msg" ] || exit 0
open=$(gh issue list -R $R --label infra-lanes --state open --json number --jq '.[0].number // empty' 2>/dev/null)
body=$(printf 'Lane workers are failing on omarchy:\n\n%s\nSee ~/lanes/logs/<n>.log and ~/.local/state/overnight/worker-exits.log on omarchy.' "$msg")
if [ -n "$open" ]; then gh issue comment $open -R $R -b "$body" >/dev/null; else open=$(gh issue create -R $R -t "infra: lane workers failing on omarchy" -l infra-lanes -l batch:now -l by:cairn -a xiechimon -b "$body" | grep -o '[0-9]*$'); fi
echo "$(date -u +%H:%M) lane-health: reported to #$open"
