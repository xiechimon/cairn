#!/bin/bash
set -euo pipefail
name=$1
git fetch -q origin main
git rebase --abort 2>/dev/null || true
~/.cairn/tools/app-token/as-bot.sh git rebase -q -X theirs origin/main
git rm -rq apps/server/drizzle
git checkout origin/main -- apps/server/drizzle
git commit -qm "chore: take main's migration folder before regenerating" --no-verify
(cd apps/server && npx drizzle-kit generate --name "$name" >/dev/null)
new=$(git status --porcelain apps/server/drizzle | awk '{print $2}')
sql=$(ls apps/server/drizzle/*_"$name".sql)
echo "generated: $sql"; cat "$sql"
git add apps/server/drizzle
~/.cairn/tools/app-token/as-bot.sh git commit -qm "chore: regenerate migration $name on top of main" --no-verify
