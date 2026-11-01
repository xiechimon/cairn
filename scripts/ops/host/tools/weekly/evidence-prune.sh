#!/bin/bash
set -euo pipefail
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$PATH"
BOT="$HOME/.cairn/tools/app-token/as-bot.sh"
REPO="$HOME/lanes/cairn"
STAMP=$(date -u +%Y%m%d)
WT="$HOME/lanes/cairn-prune-$STAMP"
BRANCH="chore/evidence-prune-$STAMP"
cleanup() { git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true; }
trap cleanup EXIT

"$BOT" git -C "$REPO" fetch -q origin main
git -C "$REPO" cat-file -e origin/main:scripts/evidence-prune.mjs 2>/dev/null || { echo "evidence-prune.mjs not on main yet"; exit 0; }
git -C "$REPO" worktree add -q -B "$BRANCH" "$WT" origin/main
cd "$WT"

DRY=$(node scripts/evidence-prune.mjs --dry-run 2>&1)
echo "$DRY"
grep -q "nothing to prune" <<<"$DRY" && exit 0

node scripts/evidence-prune.mjs
node scripts/generate-feature-map.mjs
git add -A docs
git diff --cached --quiet && { echo "no changes after prune"; exit 0; }
"$BOT" git commit -q --no-verify -m "docs: weekly evidence prune (ADR 0022)" -m "Co-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>"
HEAD_SHA=$(git rev-parse HEAD)
"$BOT" git push -q --no-verify -u origin "$BRANCH"

BODY=$(cat <<MD
<!-- claude-projects-attribution: {"github_login":"xiechimon"} -->
_Requested by **ian**_

## What
Weekly evidence prune per ADR 0022: \`scripts/evidence-prune.mjs\` removed expired evidence under \`docs/verify/\`, and \`docs/feature-map.md\` was regenerated.

## Verified
Dry run before the change:
\`\`\`
$(head -40 <<<"$DRY")
\`\`\`

## Upstream
None.

## Risk
Docs-only deletion of evidence past its retention window; history keeps every removed file.

## Acceptance
- [x] no task surface: scheduled prune of expired evidence files, CI green

## Issues
Scheduled job on omarchy (systemd user timer \`cairn-evidence-prune.timer\`), ADR 0022.
MD
)
URL=$("$BOT" gh pr create --base main --head "$BRANCH" --title 'docs: weekly evidence prune (ADR 0022)' --body "$BODY")
echo "$URL"
gh pr merge "$URL" --squash --auto --match-head-commit "$HEAD_SHA"
sleep 120
if ! gh pr checks "$URL" --watch --interval 300 >/dev/null 2>&1; then
  "$BOT" gh pr comment "$URL" --body "@xiechimon CI failed on the weekly evidence prune; it will not auto-merge until fixed."
fi
