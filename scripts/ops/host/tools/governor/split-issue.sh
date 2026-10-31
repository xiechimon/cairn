#!/bin/bash
# A stronger model (codex first) splits an issue whose PR failed review twice into 2-4 smaller tickets; each is dispatched codex-first.
set -uo pipefail
n=$1 pr=$2 R=xiechimon/cairn W=/mnt/fast/lanes/plan-ro
git -C ~/lanes/cairn fetch -q origin main && git -C $W checkout -q --detach origin/main
out=$(timeout 1800 ai-route run bulk -C $W "Issue #$n in $R was attempted in PR #$pr and blocked by the review gate after two fix rounds. Read \`gh issue view $n -R $R --comments\` (the last comment lists every blocking finding) and the code it touches in this read-only checkout. Split the remaining work into 2 to 4 smaller, independently mergeable tickets, each small enough for one focused PR, ordered so earlier ones do not depend on later ones. Output ONLY JSON: [{\"title\": \"...\", \"body\": \"## Problem\\n...\\n## Plan\\n...\\n## Acceptance\\n- [ ] ...\"}]. English only. Do not edit files or comment on GitHub." 2>/dev/null)
json=$(printf '%s' "$out" | python3 -c 'import sys,re,json
t=sys.stdin.read(); m=re.findall(r"\[\s*\{.*?\}\s*\]", t, re.S)
for c in reversed(m):
    try: d=json.loads(c); assert isinstance(d,list) and d; print(json.dumps(d)); break
    except Exception: pass')
[ -n "$json" ] || { echo "$(date -u +%H:%M) split #$n: no JSON from the model"; exit 0; }
subs=""
for i in $(seq 0 $(( $(jq length <<<"$json") - 1 ))); do
  t=$(jq -r ".[$i].title" <<<"$json"); b=$(jq -r ".[$i].body" <<<"$json")
  s=$(~/.cairn/tools/app-token/as-bot.sh gh issue create -R $R -t "$t" -b "$(printf '%s\n\nPart of #%s (split after PR #%s failed review twice).\n' "$b" "$n" "$pr")" -l ready-for-agent -l batch:now -l by:pi | grep -o '[0-9]*$')
  [ -n "$s" ] || continue; subs="$subs #$s"
  echo "$s" >> ~/.local/state/overnight/mine
  echo "$s" >> ~/.local/state/overnight/pending
done
~/.cairn/tools/app-token/as-bot.sh gh issue comment $n -R $R -b "Split into:$subs. Each was dispatched to a stronger model." >/dev/null 2>&1
echo "$(date -u +%H:%M) split #$n into$subs"
