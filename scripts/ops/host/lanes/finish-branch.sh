#!/bin/bash
d=$1 b=$2
cd "$d" || exit 1
git status | grep -q 'rebase in progress' && { echo "$b: mid-rebase"; exit 1; }
[ -n "$(git status --porcelain | grep -v '^??')" ] && { echo "$b: dirty tree"; exit 1; }
[ "$(git rev-parse --abbrev-ref HEAD)" = "$b" ] || git checkout -q -B "$b"
~/lanes/rebase-main.sh || { echo "$b: rebase conflict"; exit 1; }
g=$(node scripts/english-only-gate.mjs 2>&1 | tail -1); case "$g" in *": 0 line"*) ;; *) echo "$b: $g"; exit 1;; esac
~/lanes/sign-commits.sh || { echo "$b: signing failed"; git rebase --abort 2>/dev/null; exit 1; }
~/.cairn/tools/app-token/as-bot.sh git push -q --no-verify --force-with-lease origin "HEAD:$b" 2>&1 | tail -1
echo "$b: pushed $(git log --oneline -1 | cut -c1-70)"
