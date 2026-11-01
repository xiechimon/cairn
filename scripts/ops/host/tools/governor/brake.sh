#!/bin/bash
# Global brake (window starts no earlier than the tiered-orchestration cutover, 2026-10-27T14:00Z): over the last 2h of review-gate runs (8+), if most produced no verdict or most verdicts were BLOCK, new work stops (fixes still run) and an `infra-brake` issue explains why; it releases when the window recovers.
set -uo pipefail
R=xiechimon/cairn F=~/.local/state/overnight/brake
since=$(date -u -d '-2 hours' +%FT%T); floor=2026-10-27T14:00:00; [[ $since < $floor ]] && since=$floor
stats=$(jq -rs --arg s "$since" '[.[]|select(.at>$s and (.action!="carried-over"))] as $r | ($r|length) as $n | ([$r[]|select(.verdict==null)]|length) as $none | ([$r[]|select(.verdict=="block")]|length) as $b | ([$r[]|select(.verdict=="pass")]|length) as $p | "\($n) \($none) \($b) \($p)"' ~/.local/state/review-gate/runs.jsonl 2>/dev/null)
read -r n none b p <<<"$stats"
reason=""
if [ "${n:-0}" -ge 8 ]; then
  [ $((none * 2)) -gt "$n" ] && reason="most review runs in the last 2h produced no verdict ($none of $n): reviewer models or the machine are failing"
  [ -z "$reason" ] && [ $((b + p)) -ge 6 ] && [ $((b * 10)) -gt $(((b + p) * 7)) ] && reason="most review verdicts in the last 2h are BLOCK ($b of $((b + p))): new work is landing broken"
fi
open=$(gh issue list -R $R --label infra-brake --state open --json number --jq '.[0].number // empty' 2>/dev/null)
if [ -n "$reason" ]; then
  [ -e $F ] && [ "$(cat $F)" != "$reason" ] && echo "$reason" > $F
  if [ ! -e $F ]; then
    echo "$reason" > $F
    echo "$(date -u +%H:%M) brake ON: $reason"
    [ -z "$open" ] && gh issue create -R $R -t "brake: new work paused on omarchy" -l infra-brake -l batch:now -l by:cairn -a xiechimon -b "$(printf 'The dispatch brake turned on: %s.\n\nNew tickets are not dispatched while it is on; fix rounds, reviews and merges continue. It turns off by itself when the last 2 hours look healthy again. Look at ~/.local/state/review-gate/runs.jsonl and ai-route status on omarchy for the cause.' "$reason")" >/dev/null 2>&1
  fi
elif [ -e $F ]; then
  rm -f $F; echo "$(date -u +%H:%M) brake OFF"
  [ -n "$open" ] && gh issue close $open -R $R -c "Brake released: last 2h of reviews look healthy ($stats = runs none block pass)." >/dev/null 2>&1
fi
exit 0
