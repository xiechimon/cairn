#!/bin/bash
set -uo pipefail
BOT=~/.cairn/tools/app-token/as-bot.sh
git fetch -q origin main
GIT_EDITOR=true $BOT git rebase -q origin/main >/dev/null 2>&1 && exit 0
for _ in $(seq 30); do
  u=$(git diff --name-only --diff-filter=U)
  [ -z "$u" ] && { GIT_EDITOR=true $BOT git rebase --continue >/dev/null 2>&1 && exit 0; continue; }
  if [ "$u" != "docs/lessons.md" ]; then echo "conflict outside lessons: $u"; git rebase --abort; exit 1; fi
  sed -i '/^<<<<<<< /d;/^=======$/d;/^>>>>>>> /d' docs/lessons.md
  git add docs/lessons.md
  GIT_EDITOR=true $BOT git rebase --continue >/dev/null 2>&1 && ! git status | grep -q 'rebase in progress' && exit 0
done
echo "rebase did not converge"; git rebase --abort 2>/dev/null; exit 1
