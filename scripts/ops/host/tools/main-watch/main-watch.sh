#!/bin/bash
# Every red check on the newest finished main commit becomes a `main-red` issue (one per check), a fix lane for CI checks, and is closed once that check is green again.
~/.cairn/tools/main-watch/tmp-clean.sh
~/.cairn/tools/main-watch/gh-health.sh
~/.cairn/tools/main-watch/codex-watch.sh
~/.cairn/tools/governor/brake.sh
~/.cairn/tools/governor/lane-sentinel.sh
~/.cairn/tools/governor/lane-health.sh
~/.cairn/tools/governor/block-governor.sh
~/.cairn/tools/governor/aged-prs.sh
~/.cairn/tools/main-watch/model-health.sh
~/.cairn/tools/merge-order/queue.sh
~/.cairn/tools/merge-order/stale-prs.sh
~/.cairn/tools/merge-order/lanes-retry.sh
set -uo pipefail
R=xiechimon/cairn ST=~/.local/state/main-watch; mkdir -p $ST
log(){ echo "$(date -u +%FT%H:%MZ) $*"; }
found=
for sha in $(gh api "repos/$R/commits?sha=main&per_page=6" --jq '.[].sha'); do
  runs=$(gh api "repos/$R/commits/$sha/check-runs?per_page=100" --jq '[.check_runs[]|{n:.name,c:(.conclusion // "pending"),u:.details_url,app:.app.slug}]')
  stat=$(gh api "repos/$R/commits/$sha/status" --jq '[.statuses[]|{n:.context,c:.state,u:.target_url,app:"status"}]')
  all=$(jq -n --argjson a "$runs" --argjson b "$stat" '$a+$b')
  jq -e 'any(.[]; .c=="pending" or .c=="in_progress" or .c=="queued")' <<<"$all" >/dev/null && continue
  found=1; break
done
[ -n "$found" ] || exit 0
short=${sha:0:8}
red=$(jq -r '.[]|select(.c=="failure" or .c=="error" or .c=="timed_out" or .c=="action_required")|"\(.n)\t\(.u)\t\(.app)"' <<<"$all")
open=$(gh issue list -R $R --label main-red --state open --limit 50 --json number,title --jq '.[]|"\(.number)\t\(.title)"')
while IFS=$'\t' read -r num title; do
  [ -n "$num" ] || continue
  chk=${title#main red: }; chk=${chk% on *}
  grep -qF "$chk"$'\t' <<<"$red" && continue
  gh issue close $num -R $R -c "Green again on main at $short." >/dev/null && log "closed #$num ($chk green at $short)"
done <<<"$open"
while IFS=$'\t' read -r chk url app; do
  [ -n "$chk" ] || continue
  key=$(echo "$sha $chk" | md5sum | cut -c1-12); [ -e $ST/$key ] && continue
  existing=$(awk -F'\t' -v c="main red: $chk on" 'index($2,c)==1{print $1; exit}' <<<"$open")
  tail=""; job=$(grep -o 'job/[0-9]*' <<<"$url" | cut -d/ -f2)
  [ -n "$job" ] && tail=$(gh run view --job $job -R $R --log-failed 2>/dev/null | cut -f3- | grep -v '^\s*$' | tail -40 | LC_ALL=C sed 's/[^[:print:]\t]//g')
  body=$(printf 'Check `%s` failed on main commit %s.\n\nDetails: %s\n\n```\n%s\n```\n\nOpened by main-watch on omarchy; closed automatically when the check is green on a later main commit.' "$chk" "$sha" "$url" "$tail")
  if [ -n "$existing" ]; then
    gh issue comment $existing -R $R -b "$body" >/dev/null && log "commented #$existing ($chk at $short)"
  else
    who=by:cairn; [ "$app" = github-actions ] && who=by:pi
    n=$(gh issue create -R $R -t "main red: $chk on $short" -b "$body" -l main-red -l batch:now -l $who -a xiechimon | grep -o '[0-9]*$')
    log "opened #$n ($chk at $short)"
    if [ "$app" = github-actions ] && [ -n "$n" ]; then
      echo hard > ~/.local/state/overnight/tier/$n; EXTRA_NOTE="main-red fix" AI_ROUTE_PREFER=codex LANES_MAX=99 ~/lanes/dispatch-issue.sh $n implement >/dev/null 2>&1 && echo $n >> ~/.local/state/overnight/mine && log "dispatched fix lane for #$n"
    fi
  fi
  touch $ST/$key
done <<<"$red"
(cd ~/.cairn/tools/review-gate && node gate-audit.mjs)
