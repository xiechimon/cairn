---
Category: The local `origin/main` ref was stale, so `pnpm prepush` counted hundreds of other people's changes into this diff; even a docs-only push ran the full test suite and failed
Source: PR #1566 (2026-10-23)
Level: 2
Safeguard: `changedPaths()` in `scripts/prepush.mjs` runs `git fetch origin main` first when the base is `origin/main`, falls back to the local ref on failure with a staleness warning; pinned by `scripts/prepush.test.mjs`
Intercepts: 0
Recurrences: 0
Notes: Landed by #1630, level 5 raised to 2; negative control: with local origin/main behind others' merges, the old implementation counted that change into the diff and ran the full checks (test red first), and after the fetch only this branch's changes remained and it turned green
---
