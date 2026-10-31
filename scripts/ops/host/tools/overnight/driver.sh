#!/bin/bash
set -uo pipefail
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$PATH"
BOT=~/.cairn/tools/app-token/as-bot.sh
ST=~/.local/state/overnight
R=xiechimon/cairn
log(){ echo "$(date -u +%H:%M) $*"; }
busy(){ pgrep -f "ai-route run .* -C $1( |$)" >/dev/null; }
exec 9>$ST/lock2; flock -n 9 || exit 0
~/.cairn/tools/rearm-automerge.sh 9>&-

for n in $(cat $ST/mine); do
  d=~/lanes/cairn-$n; b=lane/$n
  [ -d "$d" ] || continue
  grep -qx "$n" ~/.local/state/overnight/never && continue
  [ "$(gh pr list -R $R --head $b --state merged --json number --jq length)" = 0 ] || continue
  [ -d "$d/.git" ] || [ -f "$d/.git" ] || continue
  busy "$d" && continue
  cd "$d" || continue
  if git status | grep -q 'rebase in progress'; then git rebase --abort 2>/dev/null; log "#$n abandoned rebase aborted"; continue; fi
  [ "$(git rev-parse --abbrev-ref HEAD)" = "$b" ] || continue
  git fetch -q origin main "+refs/heads/$b:refs/remotes/origin/$b" 2>/dev/null || git fetch -q origin main
  [ "$(git rev-list --count origin/main..HEAD)" -gt 0 ] || continue
  [ -n "$(git status --porcelain | grep -v '^??')" ] && { log "#$n dirty tree, skip"; continue; }
  git log origin/main..HEAD --format=%B | grep -qi "^closes #$n" || { log "#$n no closing line, skip"; continue; }
  pr=$(gh pr list -R $R --head $b --state open --json number --jq '.[0].number // empty')
  skip_push=0
  if [ -n "$pr" ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$b 2>/dev/null)" ] && [ "$(gh pr view $pr -R $R --json mergeStateStatus --jq .mergeStateStatus)" != DIRTY ]; then skip_push=1; fi
  if [ $skip_push = 0 ] && ! ~/lanes/rebase-main.sh >/dev/null 2>&1; then
    f=$ST/rebase-$n-$(git rev-parse --short HEAD)
    [ -e $f ] && continue; touch $f
    sed "s#__BRANCH__#$b#g" ~/lanes/prompts/rebase-round.txt > /tmp/rr-$n.txt
    AI_ROUTE_PREFER=pi AI_ROUTE_PREFER_MODEL=glm-5.3 setsid nohup bash -c "timeout 5400 ai-route run implement -C $d \"\$(cat /tmp/rr-$n.txt)\"; rc=\$?; if [ \$rc != 0 ]; then echo x >> $f.fail; [ \$(wc -l < $f.fail) -lt 3 ] && rm -f $f; fi" >> ~/lanes/logs/rr-$n.log 2>&1 < /dev/null 9>&- &
    log "#$n rebase conflict -> worker"; continue
  fi
  case "$(node scripts/english-only-gate.mjs 2>&1 | tail -1)" in *": 0 line"*) ;; *) log "#$n english gate red"; continue;; esac
  if [ $skip_push = 0 ] && [ -e $ST/push-paused ] && [ "$(cat $ST/push-paused)" != "$n" ]; then continue; fi
  if [ $skip_push = 0 ]; then
  sc=$ST/selfcheck/$n-$(git diff origin/main...HEAD | git patch-id --stable | cut -c1-12)
  if [ ! -e $sc.done ]; then
    [ -e $sc.run ] || { touch $sc.run; (setsid nohup ~/.cairn/tools/governor/selfcheck.sh $n $d $sc >/dev/null 2>&1 < /dev/null 9>&- &); log "#$n pre-push self-check started"; }
    continue
  fi
  ~/lanes/sign-commits.sh >/dev/null 2>&1 || { log "#$n signing failed"; git rebase --abort 2>/dev/null; continue; }
  $BOT git push -q --no-verify --force-with-lease origin HEAD:$b 2>/dev/null || { log "#$n push failed"; continue; }
  fi
  if [ -z "$pr" ]; then
    subj=$(git log -1 --format=%s); title=$(gh issue view $n -R $R --json title --jq .title)
    body=$(cat <<MD
<!-- claude-projects-attribution: {"github_login":"xiechimon"} -->
_Requested by **ian**_

## What
$(git log origin/main..HEAD --format='- %s')

Implements #$n: $subj

## Verified
Worker report (tail):
\`\`\`
$(tail -40 ~/lanes/logs/$n.log 2>/dev/null | grep -vP '[\x{3000}-\x{9fff}\x{ff00}-\x{ffef}]' | tail -25 | cut -c1-200)
\`\`\`

## Upstream
None.

## Risk
See the issue; CI and, for protected paths, the independent review gate decide the merge.

## Acceptance
- [x] $subj
- [x] Tests for the new behaviour written first (see Verified)

## Issues
Closes #$n
MD
)
    url=$($BOT gh pr create -R $R --base main --head $b --title "$subj" --body "$body" 2>/dev/null) || { log "#$n pr create failed"; continue; }
    pr=${url##*/}; gh api -X POST repos/$R/issues/$pr/assignees -f "assignees[]=xiechimon" >/dev/null 2>&1
    log "#$n opened PR #$pr"
  fi
  grep -qx "$n" $ST/hold && { log "#$n on hold, no auto-merge"; continue; }
  if true; then
    gh pr view $pr -R $R --json comments --jq '.comments[].body' | grep -A1 "review-gate:$(git rev-parse HEAD)" | grep -q 'gate: PASS' || { log "#$n PR #$pr waiting for review gate PASS"; continue; }
  fi
  if out=$(~/.cairn/tools/merge-pr.sh $pr --auto 2>&1); then log "#$n PR #$pr auto-merge on"; else log "#$n PR #$pr auto-merge failed: ${out:0:120}"; fi
done

for pr in $(gh pr list -R $R --state open --author 'app/cairnwright' --json number --jq '.[].number'); do
  j=$(gh pr view $pr -R $R --json headRefName,headRefOid,statusCheckRollup)
  b=$(jq -r .headRefName <<<"$j"); sha=$(jq -r .headRefOid <<<"$j")
  [[ $b == lane/* ]] || continue; n=${b#lane/}; d=~/lanes/cairn-$n
  grep -qx "$n" $ST/mine || continue
  [ -d $d ] || continue; busy $d && continue
  [ "$(jq '[.statusCheckRollup[]?|select(.status!="COMPLETED" and (.name//"")!="")]|length' <<<"$j")" = 0 ] || continue
  fails=$(jq -r '[.statusCheckRollup[]?|select(.conclusion=="FAILURE")|.name]|join(",")' <<<"$j")
  [ -z "$fails" ] && continue
  f=$ST/cifix-$pr-$sha; [ -e $f ] && continue; touch $f
  url=$(jq -r '[.statusCheckRollup[]?|select(.conclusion=="FAILURE")][0].detailsUrl' <<<"$j")
  errs=$(gh run view -R $R --job ${url##*/} --log-failed 2>/dev/null | cut -f3 | cut -c30- | grep -E 'FAIL|Error|error|Expected|Received|✗|×' | grep -v '^\s*$' | head -40)
  cat > /tmp/cifix-$n.txt <<P
CI is red on PR #$pr (branch $b, GitHub issue #$n) in this worktree of xiechimon/cairn. Read AGENTS.md first. Failing checks: $fails.
Failure excerpt:
\`\`\`
$errs
\`\`\`
Find the cause (reproduce locally; heavy checks through \`flock /tmp/cairn-heavy.lock\`). If the failure comes from this branch, fix it test-first; if it is a flake or comes from main, say so with evidence. pr-evidence failures mean the PR body lacks required sections or \`- [x]\` acceptance items: report that instead of changing code. Rebase on origin/main (docs/lessons.md: keep all rows), keep a single \`Closes #$n\` line, commit on $b. Do not push. No new code comments; English only.
P
  setsid nohup bash -c "timeout 5400 ai-route run implement -C $d \"\$(cat /tmp/cifix-$n.txt)\"; rc=\$?; if [ \$rc != 0 ]; then echo x >> $f.fail; [ \$(wc -l < $f.fail) -lt 3 ] && rm -f $f; fi" >> ~/lanes/logs/cifix-$n.log 2>&1 < /dev/null 9>&- &
  log "PR #$pr ($fails) -> fix worker"
done
