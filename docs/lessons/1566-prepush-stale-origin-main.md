---
Category: The local `origin/main` ref was stale, so `pnpm prepush` counted hundreds of other people's changes into this diff; a docs-only push also ran the full test suite and failed
Source: PR #1566 (2026-10-23)
Level: 2
Safeguard: `changedPaths()` in `scripts/prepush.mjs` runs `git fetch origin main` first when the base is `origin/main`, falls back to the local ref on failure and warns it may be stale; pinned by `scripts/prepush.test.mjs`
Intercepts: 0
Recurrences: 0
Notes: landed with #1630, level raised 5 to 2; negative control: with local origin/main stopped before someone else's merge, the old implementation counted that change into the diff and ran the full checks (test went red first); after the fetch only this branch's changes remain and it turns green
---
