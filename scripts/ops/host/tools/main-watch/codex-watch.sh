#!/bin/bash
# codex quota: alert issue when 5h or weekly use passes 80%; when a top-up shows (plan changes or weekly use drops 20+ points), open a 7-day sprint and dispatch the codex plan list codex-first.
set -uo pipefail
R=xiechimon/cairn ST=~/.local/state/main-watch; mkdir -p $ST
line=$(timeout 150 ai-route status 2>/dev/null | grep '^codex (')
[ -n "$line" ] || exit 0
plan=$(sed -E 's/^codex \(([^)]*)\).*/\1/' <<<"$line"); short=$(sed -nE 's/.* 5h ([0-9]+)%.*/\1/p' <<<"$line"); week=$(sed -nE 's/.* week ([0-9]+)%.*/\1/p' <<<"$line")
echo "$(date -u +%FT%H:%MZ) plan=$plan short=$short week=$week" >> $ST/codex.log
prev=$(tail -2 $ST/codex.log | head -1); pplan=$(grep -oE 'plan=[^ ]+' <<<"$prev" | cut -d= -f2); pweek=$(grep -oE 'week=[0-9]+' <<<"$prev" | cut -d= -f2)
open=$(gh issue list -R $R --label infra-quota --state open --json number --jq '.[0].number // empty' 2>/dev/null)
if { [ "${short:-0}" -ge 80 ] || [ "${week:-0}" -ge 80 ]; } && [ -z "$open" ]; then
  gh issue create -R $R -t "codex quota above 80% (5h ${short}%, week ${week}%)" -l infra-quota -l by:cairn -a xiechimon -b "codex ($plan) is at ${short}% of its 5-hour window and ${week}% of its week. Implement falls back to pi models and review to glm-5.3 when codex runs out. Closed automatically when both are below 80%." >/dev/null 2>&1
elif [ "${short:-100}" -lt 80 ] && [ "${week:-100}" -lt 80 ] && [ -n "$open" ]; then
  gh issue close $open -R $R -c "codex back under 80%: 5h ${short}%, week ${week}%." >/dev/null 2>&1
fi
if [ -s ~/.local/state/overnight/codex-plan ] && { { [ -n "$pplan" ] && [ "$plan" != "$pplan" ]; } || { [ -n "$pweek" ] && [ $((pweek - week)) -ge 20 ]; } || [ -e $ST/codex-go ]; }; then
  echo $(( $(date +%s) + 7*86400 )) > ~/.local/state/ai-route/sprint-until
  touch $ST/codex-active
  batch=8
elif [ -e $ST/codex-active ] && [ -s ~/.local/state/overnight/codex-plan ] && [ "$(ls ~/.local/state/ai-route/host-mac-*.pid 2>/dev/null | wc -l)" -lt 12 ]; then
  batch=2
else
  batch=0
fi
if [ $batch -gt 0 ]; then
  for n in $(head -$batch ~/.local/state/overnight/codex-plan); do
    grep -qx "$n" ~/.local/state/overnight/mine || echo "$n" >> ~/.local/state/overnight/mine
    AI_ROUTE_PREFER=codex ~/lanes/dispatch-issue.sh "$n" implement --hard >/dev/null 2>&1 && sed -i "/^$n$/d" ~/.local/state/overnight/codex-plan && echo "$(date -u +%H:%M) codex-plan: dispatched #$n"
  done
  rm -f $ST/codex-go
fi
exit 0
