#!/bin/bash
# PRs open longer than 48h get pushed through: a worker on the PR's own branch rebases onto main, fixes the latest review-gate findings and failing required checks, then the branch is re-signed and pushed. Branches owned by ian's codex (codex/*), other Claude threads (claude/*) or Cursor agents (cursor/*) only get a stale-pr issue. Once per PR head, at most 3 per run.
set -uo pipefail
R=xiechimon/cairn ST=~/.local/state/governor; mkdir -p $ST
cut=$(date -u -d '-48 hours' +%FT%TZ); sent=0
gh pr list -R $R --state open --limit 100 --json number,createdAt,headRefName,headRefOid,isDraft --jq ".[]|select(.createdAt<\"$cut\" and (.isDraft|not))|\"\(.number) \(.headRefName) \(.headRefOid)\"" 2>/dev/null |
while read -r pr ref head; do
  [ $sent -ge 3 ] && break
  key=$ST/aged-$pr-${head:0:12}; [ -e $key ] && continue
  kind=other; [[ "$ref" =~ ^lane/[0-9]+$ ]] && kind=lane; [[ "$ref" =~ ^(codex|claude|cursor)/ ]] && kind=foreign
  case "$kind" in
    lane) n=${ref#lane/}; grep -qx "$n" ~/.local/state/overnight/hold && continue; grep -qx "$n" ~/.local/state/overnight/never && continue
      touch $key
      EXTRA_NOTE="PR #$pr has been open for more than 48 hours. Run \`gh pr view $pr -R $R --comments\` and \`gh pr checks $pr -R $R\`: rebase onto origin/main, fix every blocking finding in the latest review-gate comment (one Evidence entry per finding: command run, test red to green) and every failing required check. Commit on lane/$n." AI_ROUTE_PREFER=pi ~/lanes/dispatch-issue.sh "$n" implement >/dev/null 2>&1 && echo "$(date -u +%H:%M) aged: lane PR #$pr re-dispatched" && sent=$((sent+1));;
    foreign)
      touch $key
      gh issue list -R $R --label stale-pr --state open --search "PR #$pr" --json number --jq '.[0].number // empty' | grep -q . || gh issue create -R $R -t "stale PR #$pr: open for more than 48 hours" -l stale-pr -l batch:now -l by:cairn -b "PR #$pr ($ref) has been open for more than 48 hours. Its owner (ian's codex, the Claude thread or the Cursor agent that opened it) should rebase it, fix its review-gate findings and failing checks, or close it. Opened by aged-prs on omarchy." >/dev/null && echo "$(date -u +%H:%M) aged: stale-pr issue for #$pr ($ref)";;
    *)
      touch $key
      d=/mnt/fast/lanes/pr-$pr
      git -C ~/lanes/cairn fetch -q origin "+refs/heads/$ref:refs/remotes/origin/$ref" main || continue
      [ -d $d ] || git -C ~/lanes/cairn worktree add -q -B "pr-$pr" $d "origin/$ref" || continue
      flock -n ~/.local/state/lane-pr-$pr.lock true || continue
      prompt="PR #$pr (branch $ref) in xiechimon/cairn has been open for more than 48 hours. This worktree has its head checked out on local branch pr-$pr. Read AGENTS.md first. Rebase onto origin/main (docs/lessons.md: keep every row from both sides), fix every blocking finding in the latest review-gate comment (\`gh pr view $pr -R $R --comments\`) and every failing required check (\`gh pr checks $pr -R $R\`), with one Evidence entry per finding in the commit message. Do not push."
      (cd $d && setsid nohup flock -n $HOME/.local/state/lane-pr-$pr.lock bash -c "pnpm install --prefer-offline --frozen-lockfile >/dev/null 2>&1; AI_ROUTE_PREFER=pi timeout 5400 ai-route run implement -C $d \"\$0\" && git fetch -q origin main && git merge-base --is-ancestor origin/main HEAD && ~/lanes/sign-commits.sh && ~/.cairn/tools/app-token/as-bot.sh git push -q --no-verify --force-with-lease=$ref:origin/$ref origin HEAD:$ref" "$prompt" >> ~/lanes/logs/pr-$pr.log 2>&1 < /dev/null &)
      echo "$(date -u +%H:%M) aged: worker on branch $ref for PR #$pr" && sent=$((sent+1));;
  esac
done
exit 0
