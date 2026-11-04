#!/bin/bash
# Weekly: bucket the review gate's blocking findings from the last 7 days; any bucket seen 2+ times becomes an issue asking for a lint or CI check that catches it before review.
set -uo pipefail
R=xiechimon/cairn
since=$(date -u -d '-7 days' +%FT%T)
files=$(jq -r --arg s "$since" 'select(.at>$s and .verdict=="block")|"\(.pr) \(.raw)"' ~/.local/state/review-gate/runs.jsonl 2>/dev/null)
declare -A cnt ex
while read -r pr f; do
  [ -f "$f" ] || continue
  text=$(grep -iE "blocking" "$f" | grep -viE "Block only for|severity \(blocking" | head -5)
  for pair in "migration:migration|drizzle|_journal" "gate-loosening:known-red|allowlist|exempt|loosen|threshold|skip(s|ped)? (the |a )?test|weaken" "missing-test:no test|not tested|untested|missing test|test only covers|stays inside" "broken-path:does not exist|cannot resolve|resolves to|not found in the PR" "auth:authenticat|token|credential" "platform:macos|linux|platform-specific|windows" "eval-scoring:headline|score|coverage|baseline"; do
    k=${pair%%:*}; re=${pair#*:}
    if grep -qiE "$re" <<<"$text"; then cnt[$k]=$(( ${cnt[$k]:-0} + 1 )); [[ "${ex[$k]:-}" == *"#$pr"* ]] || ex[$k]="${ex[$k]:-} #$pr"; fi
  done
done <<<"$files"
body=""
for k in "${!cnt[@]}"; do [ "${cnt[$k]}" -ge 2 ] && body+="- **$k**: ${cnt[$k]} blocking findings (PRs:${ex[$k]})"$'\n'; done
[ -z "$body" ] && { echo "$(date -u +%F) weekly-blocks: nothing recurring"; exit 0; }
gh issue create -R $R -t "recurring review-gate block reasons, week of $(date -u +%F)" -l ready-for-agent -l batch:next -l by:codex -b "$(printf 'Block reasons that came up twice or more in the last 7 days. Each recurring reason should become a lint rule or CI check so it is caught before review instead of costing a review round.\n\n%s\nFor each: add the check (scripts/ or .github/workflows/), with a failing fixture that reproduces one of the listed PRs'"'"' findings.' "$body")" | tail -1
