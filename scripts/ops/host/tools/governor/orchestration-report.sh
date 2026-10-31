#!/bin/bash
# orchestration-report.sh [since-ISO]: first-pass rate, mean review rounds, lane CI failure rate for lane PRs since the tiered-orchestration cutover.
since=${1:-2026-10-27T14:00:00Z}
R=xiechimon/cairn
prs=$(gh pr list -R $R --state all --limit 300 --search "created:>=${since%%T*}" --json number,headRefName,createdAt,state,statusCheckRollup --jq "[.[]|select((.headRefName|startswith(\"lane/\")) and .createdAt>=\"$since\")]")
jq -r --slurpfile runs <(jq -c 'select(.verdict!=null and .action!="carried-over")' ~/.local/state/review-gate/runs.jsonl) --arg since "$since" '
  ($runs|map(select(.at>=$since))) as $r
  | [.[]|.number] as $lane
  | [$lane[]|. as $n|[$r[]|select(.pr==$n)]|select(length>0)] as $rev
  | ([$rev[]|select(.[0].verdict=="pass")]|length) as $first
  | [.[]|select(.state=="MERGED")|.number] as $merged
  | [$merged[]|. as $n|[$r[]|select(.pr==$n)]|length|select(.>0)] as $rounds
  | ([.[]|select([.statusCheckRollup[]?|select(.conclusion=="FAILURE")]|length>0)]|length) as $red
  | "lane PRs since \($since): \(length)",
    "first-pass rate: \($first)/\($rev|length)\(if ($rev|length)>0 then " = \($first*100/($rev|length)|floor)%" else "" end) (target >=70%)",
    "mean review rounds per merged PR: \(if ($rounds|length)>0 then (($rounds|add)/($rounds|length)*100|round/100) else "n/a" end) over \($rounds|length) merged (target <=1.3)",
    "lane PRs with a red check on the latest head: \($red)/\(length)\(if length>0 then " = \($red*100/length|floor)%" else "" end) (target <=10%)"' <<<"$prs"
