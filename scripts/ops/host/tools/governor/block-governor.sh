#!/bin/bash
# Review-gate BLOCKs on lane PRs: rounds 1..fixRoundsMax get a fix worker that must answer every finding with evidence;
# round 1 is fixed by glm, round 2 by codex; a BLOCK after the last round closes the PR, copies every finding into the issue, and the issue is split again.
set -uo pipefail
R=xiechimon/cairn ST=~/.local/state/governor; mkdir -p $ST
MAX=$(git -C ~/lanes/cairn show origin/main:packages/shared/src/records/merge-gate.ts 2>/dev/null | sed -nE 's/.*fixRoundsMax: *([0-9]+).*/\1/p' | head -1); MAX=${MAX:-2}
log(){ echo "$(date -u +%H:%M) governor: $*"; }
gh pr list -R $R --state open --limit 100 --json number,headRefName,headRefOid,isDraft --jq '.[]|select((.isDraft|not) and (.headRefName|startswith("lane/")))|"\(.number) \(.headRefName) \(.headRefOid)"' 2>/dev/null |
while read -r pr ref head; do
  n=${ref#lane/}; [[ "$n" =~ ^[0-9]+$ ]] || continue
  grep -qx "$n" ~/.local/state/overnight/mine || continue
  grep -qx "$n" ~/.local/state/overnight/hold && continue
  bodies=$(gh pr view $pr -R $R --json comments --jq '[.comments[].body|select(test("<!-- review-gate:[0-9a-f]{40} -->"))]' 2>/dev/null) || continue
  blocks=$(jq '[.[]|select(test("Independent review gate: BLOCK"))]|length' <<<"$bodies")
  latest=$(jq -r --arg h "$head" '[.[]|select(contains("review-gate:"+$h))][-1] // ""' <<<"$bodies")
  grep -q "Independent review gate: BLOCK" <<<"$latest" || continue
  if [ "$blocks" -le "$MAX" ]; then
    [ -e $ST/fix-$pr-${head:0:12} ] && continue
    flock -n ~/.local/state/lane-$n.lock true || continue
    touch $ST/fix-$pr-${head:0:12}
    note="Fix round $blocks of $MAX for PR #$pr (after round $MAX a PR that is still blocked is closed and the issue is split). Read the latest review-gate comment: \`gh pr view $pr -R $R --comments\`. For EVERY blocking finding, in order: reproduce it with a failing test or command, fix it, and show the same test or command passing. Put an 'Evidence' section at the end of the commit message with one entry per finding: the finding (file:line), the command you ran, and the test that went from red to green. Do not touch unrelated files. Rebase onto origin/main if it conflicts. Commit on lane/$n."
    fx=fix1; [ "$blocks" -ge 2 ] && fx=fix2
    EXTRA_NOTE="$note" LANES_MAX=99 env $(~/.cairn/tools/governor/tier.sh env "$n" $fx) ~/lanes/dispatch-issue.sh "$n" implement >/dev/null 2>&1 && log "PR #$pr round $blocks/$MAX fix dispatched (lane $n)"
  else
    [ -e $ST/split-$pr ] && continue
    touch $ST/split-$pr
    findings=$(jq -r '[.[]|select(test("Independent review gate: BLOCK"))]|to_entries|map("### Round \(.key)\n\n" + (.value|split("\n")|map(select(test("^[0-9]+\\.|blocking";"i")))|join("\n")))|join("\n\n")' <<<"$bodies" | head -c 50000)
    ~/.cairn/tools/app-token/as-bot.sh gh issue comment $n -R $R -b "$(printf 'PR #%s was blocked by the review gate after %s fix rounds (fixRoundsMax) and is closed. Every blocking finding so far:\n\n%s\n\nThis issue is being split into smaller tickets by a stronger model.' "$pr" "$MAX" "$findings")" >/dev/null 2>&1
    ~/.cairn/tools/app-token/as-bot.sh gh pr close $pr -R $R -c "Closed after $MAX fix rounds still blocked by the review gate (fixRoundsMax: $MAX). Findings were copied to #$n, which is being split into smaller tickets." >/dev/null 2>&1
    sed -i "/^$n$/d" ~/.local/state/overnight/mine
    log "PR #$pr closed after $blocks blocks; splitting #$n"
    (setsid nohup ~/.cairn/tools/governor/split-issue.sh "$n" "$pr" >> ~/.local/state/governor/split.log 2>&1 < /dev/null &)
  fi
done
exit 0
