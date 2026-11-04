#!/bin/bash
# selfcheck.sh <issue> <worktree> <stamp>: before a lane's first push of a patch, a cheap model reviews the diff for the usual block reasons.
# A block sends the lane one fix worker (once per lane); afterwards, or on any error, the stamp is marked done so the driver pushes.
n=$1 d=$2 sc=$3
ST=~/.local/state/overnight/selfcheck
trap 'touch $sc.done; rm -f $sc.run' EXIT
p="You are pre-checking a branch before it is pushed for review in xiechimon/cairn. Read-only: do not edit, commit or push.
Run \`git diff origin/main...HEAD\` in this worktree and \`gh issue view $n -R xiechimon/cairn\`. Look only for the reasons PRs usually get blocked here:
1. A real bug in changed lines, or code that cannot run (missing import, wrong API, unhandled path the issue names).
2. New behaviour with no test, or a test that would pass without the change.
3. Loosened gates, allowlists, baselines, thresholds or skipped tests.
4. A migration number that collides with origin/main, or platform-specific code (server must run on macOS and Linux).
5. Lines added by a recently merged PR deleted without the issue asking for it.
6. An acceptance item in the issue (or its acceptance-checklist comment) not met.
Output numbered findings with file:line and one line of reason each, no command logs, then a last line exactly \`VERDICT: pass\` or \`VERDICT: block\`. Block only for findings you can point to."
out=$(cd $d && AI_ROUTE_PREFER=pi AI_ROUTE_PREFER_MODEL=deepseek-v4.1-flash timeout 1500 ai-route run review -C $d "$p" 2>/dev/null)
v=$(grep -oiE '^[^a-z]*VERDICT: *(pass|block)' <<<"$out" | tail -1 | grep -oiE 'pass|block' | tr A-Z a-z)
echo "$(date -u +%FT%TZ) #$n ${v:-none}" >> $ST/log
[ "$v" = block ] || exit 0
[ -e $ST/$n.fixed ] && exit 0
touch $ST/$n.fixed
findings=$(sed -n '/^ *1\./,$p' <<<"$out" | head -c 6000)
EXTRA_NOTE="Pre-push self-check found these problems in this branch. Fix each one test-first, keep the commit message's Closes #$n line, commit on lane/$n, do not push:
$findings" ~/lanes/dispatch-issue.sh $n implement >/dev/null 2>&1
