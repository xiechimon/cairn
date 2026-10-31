#!/bin/bash
# Issues scheduled now/next (or ONLY_N) without a plan get one: a model reads the issue and the repo and writes "## Plan" (with "### Prior art" for feature-sized work); the script adds "### Overlap" from open PRs touching the same files. At most $MAX per run.
set -uo pipefail
R=xiechimon/cairn MAX=${MAX:-3} ST=~/.local/state/plan W=/mnt/fast/lanes/plan-ro; mkdir -p $ST
cd ~/lanes/cairn && git fetch -q origin main && { [ -d $W ] || git worktree add -q --detach $W origin/main; } && git -C $W checkout -q --detach origin/main
HAS_PLAN='## Plan|## 计划|## 方案|## 实施|## 做法|## Steps|## 步骤|plan:auto'
if [ -n "${ONLY_N:-}" ]; then list=$ONLY_N; else
  list=$(gh issue list -R $R --state open --limit 200 --json number,body,labels \
    --jq ".[]|select([.labels[].name]|(index(\"batch:now\") or index(\"batch:next\")) and (index(\"waits-ian\")|not))|select(.body|test(\"$HAS_PLAN\";\"i\")|not)|.number")
fi
count=0
for n in $list; do
  grep -qx "$n" ~/.local/state/overnight/never && continue
  [ $count -ge "$MAX" ] && break
  [ -z "${ONLY_N:-}" ] && [ -e $ST/$n ] && continue
  touch $ST/$n; count=$((count+1))
  out=$(timeout 1500 ai-route run bulk -C $W "Write an implementation plan for GitHub issue #$n in xiechimon/cairn. Run \`gh issue view $n -R $R\` and read the code it touches in this checkout (read-only: do not edit, commit or comment). Search only inside this checkout. Output ONLY a markdown section that starts with the line '## Plan' and contains: the files and functions to change (real paths that exist), the failing test to write first, numbered steps, risks, and how to verify. If the issue adds a feature or a new module (not a small fix), include a '### Prior art' subsection: 2-4 existing libraries or comparable open-source projects found with \`gh search repos <terms> --limit 5\` or that you know, each with a link, and one line deciding reuse vs build and why. English only, at most 50 lines." 2>/dev/null)
  plan=$(printf '%s\n' "$out" | sed -n '/^## Plan/,$p')
  if [ -z "$plan" ]; then echo "$(date -u +%H:%M) plan: no plan produced for #$n"; continue; fi
  paths=$(printf '%s\n' "$plan" | grep -oE '[A-Za-z0-9_.-]+(/[A-Za-z0-9_.@-]+)+\.[a-z]{1,5}' | sort -u)
  overlap=$(gh pr list -R $R --state open --limit 100 --json number,title,files --jq '.[]|"\(.number)\t\(.title)\t\([.files[].path]|join(" "))"' 2>/dev/null |
    while IFS=$'\t' read -r pr title files; do hit=$(for p in $paths; do [[ " $files " == *" $p "* ]] && echo -n "\`$p\` "; done); [ -n "$hit" ] && echo "- #$pr $title: $hit"; done)
  [ -z "$overlap" ] && overlap="- none"
  body=$(gh issue view $n -R $R --json body --jq .body)
  printf '%s\n\n%s\n\n### Overlap (open PRs touching the same files)\n%s\n\n<!-- plan:auto -->\n' "$body" "$plan" "$overlap" | ~/.cairn/tools/app-token/as-bot.sh gh issue edit $n -R $R --body-file - >/dev/null && echo "$(date -u +%H:%M) plan: added to #$n"
done
exit 0
