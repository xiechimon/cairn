#!/bin/bash
# run-worker.sh <issue> <role> <shift_hard|""> <worktree>: plan if needed, build the prompt, run the worker, and record how it exited.
n=$1 role=$2 shift_hard=$3 d=$4
start=$(date +%s); rc=0
finish(){ secs=$(( $(date +%s) - start )); last=$(grep -v '^\s*$' ~/lanes/logs/$n.log 2>/dev/null | tail -1 | cut -c1-200)
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$n" "$rc" "$secs" "$last" >> ~/.local/state/overnight/worker-exits.log; }
trap finish EXIT
gh issue view $n -R xiechimon/cairn --json body --jq .body | grep -qiE '## Plan|## 计划|## 方案|## 实施|## 做法|## Steps|## 步骤|plan:auto' || ONLY_N=$n MAX=1 PLAN_ANY=1 ~/.cairn/tools/plan/plan-issues.sh
~/lanes/build-prompt.sh $n
size=$(wc -c < /tmp/issue-$n.txt)
[ "$size" -gt 50000 ] && { echo "prompt for #$n is $size bytes (over 50KB); not starting"; rc=4; exit 4; }
pnpm install --prefer-offline --frozen-lockfile >/dev/null 2>&1
timeout 7200 ai-route run $role $shift_hard -C $d "$(cat /tmp/issue-$n.txt)"; rc=$?
exit $rc
